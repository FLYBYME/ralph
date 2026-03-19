import { LedgerStorageEngine } from '../storage/LedgerStorageEngine.js';
import { LocalEventBus } from '../bus/LocalEventBus.js';
import { WorkerManager } from '../llm/WorkerManager.js';
import { ProviderRegistry } from '../llm/ProviderRegistry.js';
import { PromptBuilder, JudgeScorecardSchema } from '../llm/PromptBuilder.js';
import { DockerRunner } from '../remote/DockerRunner.js';
import { EvalResult, FsmStep } from '../storage/types.js';
import * as path from 'path';
import * as fs from 'fs/promises';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';

export interface EvalScenario {
  id: string;
  title: string;
  description: string;
  projectId: string; // Template project to copy from
  objective: string;
  useTDD: boolean;
  expectedFiles: string[];
}

type Scorecard = z.infer<typeof JudgeScorecardSchema>;

/**
 * EvalManager
 * Responsibility: Orchestrates the asynchronous evaluation pipeline.
 * Monitors FSM events, grades finished tasks, and cleans up.
 */
export class EvalManager {
  private activeEvals: Map<string, EvalResult> = new Map();

  constructor(
    private readonly storageEngine: LedgerStorageEngine,
    private readonly eventBus: LocalEventBus,
    private readonly workerManager: WorkerManager,
    private readonly providerRegistry: ProviderRegistry,
    private readonly promptBuilder: PromptBuilder
  ) {
    this.setupListeners();
  }

  private setupListeners() {
    this.eventBus.subscribe('FSM_TRANSITION', async (event) => {
      if (event.type !== 'FSM_TRANSITION') return;
      
      const evalResult = [...this.activeEvals.values()].find(r => r.taskId === event.taskId);
      if (!evalResult) return;

      evalResult.fsmSteps.push(event.newState);
      await this.storageEngine.commitEvalResult(evalResult);

      // Check for completion or terminal failure
      if (event.newState === 'FINALIZE' || event.newState === 'AWAITING_REVIEW') {
          // Task has finished its automated flow or hit a wall
          const task = await this.storageEngine.getTaskRecord(event.taskId);
          if (task.status === 'COMPLETED' || task.status === 'AWAITING_REVIEW' || task.status === 'FAILED') {
              await this.gradeEval(evalResult.id);
          }
      }
    });
  }

  public async startEval(scenario: EvalScenario): Promise<string> {
    const evalId = randomUUID();
    const startTime = new Date().toISOString();

    // 1. Setup Sandbox Workspace
    const templateProject = await this.storageEngine.getProject(scenario.projectId);
    if (!templateProject) throw new Error(`Template project ${scenario.projectId} not found.`);

    const evalWorkspacePath = path.join(process.cwd(), 'data', 'workspaces', 'evals', evalId);
    await fs.mkdir(evalWorkspacePath, { recursive: true });
    
    // Copy project files to sandbox
    await fs.cp(templateProject.absolutePath, evalWorkspacePath, { recursive: true });

    // 2. Register Ephemeral Project
    const project = await this.storageEngine.addProject(
        `${templateProject.name}-eval-${evalId.slice(0,8)}`,
        evalWorkspacePath, 
        templateProject.defaultBranch,
        true, // Local only for evals
        undefined,
        templateProject.ciCommands,
        true // isEval: true
    );

    // 3. Inject Eval Task
    const task = await this.storageEngine.createTask(
        project.id,
        `EVAL: ${scenario.title}`,
        scenario.objective,
        false, // urgent
        ['evaluation', scenario.id],
        [],
        undefined,
        scenario.useTDD,
        true // isEval: true
    );

    const result: EvalResult = {
        id: evalId,
        scenarioId: scenario.id,
        taskId: task.id,
        status: 'RUNNING',
        startTime,
        fsmSteps: [FsmStep.INVESTIGATE]
    };

    this.activeEvals.set(evalId, result);
    await this.storageEngine.commitEvalResult(result);

    return evalId;
  }

  private async gradeEval(evalId: string): Promise<void> {
    const result = this.activeEvals.get(evalId);
    if (!result) return;

    try {
        const task = await this.storageEngine.getTaskRecord(result.taskId);
        const project = await this.storageEngine.getProject(task.projectId);
        if (!project) throw new Error('Project not found during grading');

        // 1. Final Test Run
        const dockerRunner = new DockerRunner();
        const logPath = path.join(process.cwd(), 'data', 'logs', `eval-grade-${evalId}.log`);
        const command = project.ciCommands.join(' && ');
        
        await dockerRunner.runWorkflow(project.absolutePath, task.id, logPath, ['sh', '-c', command]);
        const conclusion = await dockerRunner.getStatus(task.id);
        const testsPassed = conclusion === 'success';

        // 2. LLM as a Judge
        const judgeProvider = this.providerRegistry.getActiveProvider();
        const judgeModel = this.providerRegistry.getActiveModel();
        
        const payload = this.promptBuilder.buildJudgePrompt(task, testsPassed, result.fsmSteps, judgeModel);

        let scorecard: Scorecard;
        try {
          const response = await this.workerManager.dispatch<Scorecard>(payload, judgeProvider, judgeModel);
          if (!response.parsed) {
            throw new Error("No parsed response from judge.");
          }
          scorecard = response.parsed;
        } catch (e) {
          console.error('Failed to get judge scorecard', e);
          scorecard = { 
            score: 0, 
            feedback: `Grading failed: ${e instanceof Error ? e.message : String(e)}`, 
            status: 'FAILED' 
          };
        }

        // 3. Finalize Result
        result.status = scorecard.status;
        result.score = scorecard.score;
        result.feedback = scorecard.feedback;
        result.endTime = new Date().toISOString();
        result.judgeModel = judgeModel;

        await this.storageEngine.commitEvalResult(result);

        // 4. Cleanup
        await this.cleanup(evalId);

    } catch (error) {
        result.status = 'ERROR';
        result.feedback = `Grading failed: ${error}`;
        result.endTime = new Date().toISOString();
        await this.storageEngine.commitEvalResult(result);
    } finally {
        this.activeEvals.delete(evalId);
    }
  }

  private async cleanup(evalId: string): Promise<void> {
    const result = await this.storageEngine.getEvalResult(evalId);
    if (!result) return;

    // Delete ephemeral task and project from ledger
    try {
        const task = await this.storageEngine.getTaskRecord(result.taskId);
        await this.storageEngine.deleteTask(task.id);
        
        // Find and delete ephemeral project
        await this.storageEngine.mutateLedger(async (ledger) => {
            ledger.projects = ledger.projects.filter(p => p.id !== task.projectId);
        });
    } catch (e) {
        console.warn(`Cleanup failed for eval ${evalId}:`, e);
    }
  }
}
