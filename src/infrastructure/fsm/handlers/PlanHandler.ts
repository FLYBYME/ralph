import { z } from 'zod';
import { StateContext, TaskRecord, FsmStep, ProjectRecord } from '../../storage/types.js';
import { StepResult, StepStatus } from '../types.js';
import { IStepHandler } from './IStepHandler.js';
import { WorkerManager } from '../../llm/WorkerManager.js';
import { WorkerPayload } from '../../llm/types.js';
import { PromptBuilder } from '../../llm/PromptBuilder.js';
import { DiskTooling } from '../../storage/DiskTooling.js';
import { LedgerStorageEngine } from '../../storage/LedgerStorageEngine.js';
import { ProviderRegistry } from '../../llm/ProviderRegistry.js';

type Plan = {
  root_cause_analysis: string;
  sub_tasks: {
    id: string;
    worker: string;
    instructions: string;
    target_files: string[];
    depends_on: string[];
  }[];
};

export class PlanHandler implements IStepHandler {
  constructor(
    private readonly workerManager: WorkerManager,
    private readonly providerRegistry: ProviderRegistry,
    _promptBuilder: PromptBuilder,
    _diskTooling: DiskTooling
  ) {}

  public canExecute(context: StateContext): boolean {
    return context.currentStep === FsmStep.PLAN;
  }

  public async execute(task: TaskRecord, _project: ProjectRecord, storageEngine: LedgerStorageEngine): Promise<StepResult> {
    const settings = await storageEngine.getSettings();
    const now = new Date().toISOString();
    
    // Combine quota locks and explicit disabled flags
    const unavailableWorkers = (settings.quotaLocks || [])
        .filter(lock => lock.disabledUntil > now)
        .map(lock => lock.specialist);
    
    if (settings.workerGeminiEnabled === false && !unavailableWorkers.includes('gemini')) unavailableWorkers.push('gemini');
    if (settings.workerCopilotEnabled === false && !unavailableWorkers.includes('copilot')) unavailableWorkers.push('copilot');
    if (settings.workerOpencodeEnabled === false && !unavailableWorkers.includes('opencode')) unavailableWorkers.push('opencode');

    const allWorkers = ['gemini', 'copilot', 'opencode'];
    const activeWorkers = allWorkers.filter(w => !unavailableWorkers.includes(w));
    const workerEnumOptions = activeWorkers.length > 0 ? activeWorkers as [string, ...string[]] : ['gemini'] as [string, ...string[]];

    const DynamicPlanSchema = z.object({
      root_cause_analysis: z.string(),
      sub_tasks: z.array(z.object({
        id: z.string(),
        worker: z.enum(workerEnumOptions),
        instructions: z.string(),
        target_files: z.array(z.string()),
        depends_on: z.array(z.string())
      }))
    });

    const selectedWorker = task.context.execution?.selectedWorker || 'gemini';
    const investigationNotes = task.context.investigation.notes || "No investigation notes.";

    const systemPrompt = `You are "Ralph", a Lead AI Software Manager. Your objective is to decompose the main task into a discrete dependency graph of sub-tasks.
    
## Guidelines:
- **Root Cause Analysis**: Explain *why* you are choosing this approach.
- **Sub-Tasks**: Break the work into independent units of work.
- **Specialists**: Choose 'gemini' for complex logic/state, 'copilot' for boilerplate/tests, and 'opencode' for shell/cleanup.
${unavailableWorkers.length > 0 ? `- **UNAVAILABLE WORKERS**: Do NOT use ${unavailableWorkers.join(', ')} as they are disabled in settings or out of quota.` : ''}
- **Dependencies**: Use 'depends_on' to ensure task_2 only starts after task_1 fixes the core bug.
- **Target Files**: Be specific about which files each sub-task touches (max 3 per sub-task).

## FINAL OUTPUT FORMAT
You MUST respond strictly with a JSON object matching this exact structure:
{
  "root_cause_analysis": "<string explaining the approach>",
  "sub_tasks": [
    {
      "id": "task_1",
      "worker": "<MUST be exactly one of: ${workerEnumOptions.join(', ')}>",
      "instructions": "<string detailing what the worker must do>",
      "target_files": ["<string file paths>"],
      "depends_on": ["<array of preceding task IDs, or empty array if none>"]
    }
  ]
}`;

    const userPrompt = `## Main Objective
**${task.objective.title}**
${task.objective.originalPrompt || '(no description)'}

## Investigation Findings
${investigationNotes}`;

    const payload: Omit<WorkerPayload, 'model'> = {
        systemPrompt,
        userPrompt,
        contextFiles: [],
        responseFormat: {
          schema: DynamicPlanSchema,
          name: "plan"
        }
    };

    const provider = this.providerRegistry.getActiveProvider();
    const model = this.providerRegistry.getActiveModel();

    let plan: Plan;
    try {
      const response = await this.workerManager.dispatch<Plan>(payload, provider, model);
      if (!response.parsed) {
        throw new Error("No parsed response from provider.");
      }
      plan = response.parsed;
    } catch (e) {
      console.warn("[PlanHandler] Structured output failed. Yielding/Failing.", e);
      return {
          status: StepStatus.FATAL,
          stateUpdates: {},
          humanMessage: `⚠️ Ralph failed to generate a valid plan: ${e instanceof Error ? e.message : String(e)}`,
          nextStepOverride: null
      };
    }

    return {
      status: StepStatus.SUCCESS,
      stateUpdates: {
        planning: {
          rootCauseAnalysis: plan.root_cause_analysis,
          subTasks: plan.sub_tasks.map((t: any) => ({
              ...t,
              targetFiles: t.target_files,
              dependsOn: t.depends_on,
              status: 'OPEN'
          })),
          proposedSteps: [], 
          targetFiles: Array.from(new Set(plan.sub_tasks.flatMap((t: any) => t.target_files))),
          requiredTools: []
        },
        execution: {
            ...task.context.execution,
            geminiPrompt: plan.sub_tasks[0]?.instructions || investigationNotes,
            selectedWorker: (plan.sub_tasks[0]?.worker as any) || selectedWorker
        }
      },
      humanMessage: "Ralph has created a strategy and is waiting for your approval.",
      nextStepOverride: FsmStep.AWAITING_REVIEW
    };
  }
}
