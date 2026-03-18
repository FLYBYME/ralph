import { StateContext, TaskRecord, FsmStep, ProjectRecord } from '../../storage/types.js';
import { StepResult, StepStatus } from '../types.js';
import { IStepHandler } from './IStepHandler.js';
import { WorkerManager } from '../../llm/WorkerManager.js';
import { ILlmProvider } from '../../llm/types.js';
import { PromptBuilder } from '../../llm/PromptBuilder.js';
import { DiskTooling } from '../../storage/DiskTooling.js';
import { SpecialistExecutor, WorkerSpecialist } from '../../llm/SpecialistExecutor.js';
import { LedgerStorageEngine } from '../../storage/LedgerStorageEngine.js';

export class ExecuteHandler implements IStepHandler {
  constructor(
    _workerManager: WorkerManager,
    _provider: ILlmProvider,
    _promptBuilder: PromptBuilder,
    _diskTooling: DiskTooling,
    private readonly specialistExecutor: SpecialistExecutor
  ) {}

  public canExecute(context: StateContext): boolean {
    return context.currentStep === FsmStep.EXECUTE;
  }

  public async execute(task: TaskRecord, project: ProjectRecord, _storageEngine: LedgerStorageEngine): Promise<StepResult> {
    const nextAttempt = (task.context.execution.attemptCount || 0) + 1;
    if (nextAttempt > 3) {
      return {
        status: StepStatus.FATAL,
        stateUpdates: { execution: { ...task.context.execution, attemptCount: nextAttempt, lastErrorLog: "Maximum attempts reached." } },
        humanMessage: "Ralph has failed to execute the code after 3 attempts.",
        nextStepOverride: null
      };
    }

    const specialist: WorkerSpecialist = task.context.execution.selectedWorker || 'gemini';
    const instructions = task.context.execution.geminiPrompt || task.objective.title;

    const prompt = `You are an expert engineer working in a local terminal.

Your task is:
${instructions}

## Instructions
- You have full access to the current directory.
- Explore the files, understand the architecture, and modify the code directly on disk to complete the task.
- Do not narrate your actions; simply perform the modifications and exit.
- If you need to run commands (like tests or build), you can assume standard tools are available.

## Output Format
1. Start with a brief explanation of the changes you made and why.
2. List the files you modified.

Do NOT output the file contents in your response. The files should be modified on disk.`;

    const result = await this.specialistExecutor.execute(specialist, prompt, {
      cwd: project.absolutePath,
      taskId: task.id,
      activity: `Implementing changes for task ${task.id}`
    });

    if (!result.success) {
      // Check for Gemini Quota Exhaustion
      const quotaMatch = result.stderr.match(/QUOTA_EXHAUSTED[\s\S]*?reset after (\d+[hms]+(?:[0-9]+[hms]+)*)/i) || 
                         result.stderr.match(/exhausted your capacity.*reset after (\d+[hms]+(?:[0-9]+[hms]+)*)/i);
      
      if (quotaMatch && quotaMatch[1]) {
        const waitTimeStr = quotaMatch[1];
        return {
          status: StepStatus.YIELD,
          stateUpdates: { 
              execution: { 
                  ...task.context.execution, 
                  attemptCount: nextAttempt, // Don't burn attempts on quota limits
                  lastErrorLog: `Quota exhausted. Waiting ${waitTimeStr}.` 
              } 
          },
          humanMessage: `⚠️ **Rate Limit Hit:** ${specialist} quota exhausted. Must wait approximately ${waitTimeStr} before resuming. Task is paused.`,
          nextStepOverride: FsmStep.EXECUTE // Stay on execute for when it resumes
        };
      }

      return {
        status: StepStatus.FAILED,
        stateUpdates: { 
            execution: { 
                ...task.context.execution, 
                attemptCount: nextAttempt, 
                lastErrorLog: result.stderr 
            } 
        },
        humanMessage: `${specialist} failed: ${result.stderr}`,
        nextStepOverride: FsmStep.PLAN
      };
    }

    return {
      status: StepStatus.SUCCESS,
      stateUpdates: { 
          execution: { 
              ...task.context.execution, 
              attemptCount: nextAttempt, 
              activeWorkerId: specialist,
              specialistOutput: result.output
          } 
      },
      humanMessage: `Ralph has applied the code changes using ${specialist}.\n\nNotes:\n${result.output.slice(0, 1000)}`,
      nextStepOverride: null
    };
  }
}
