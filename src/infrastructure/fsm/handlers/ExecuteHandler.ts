import { StateContext, TaskRecord, FsmStep, ProjectRecord } from '../../storage/types.js';
import { StepResult, StepStatus } from '../types.js';
import { IStepHandler } from './IStepHandler.js';
import { WorkerManager } from '../../llm/WorkerManager.js';
import { PromptBuilder } from '../../llm/PromptBuilder.js';
import { DiskTooling } from '../../storage/DiskTooling.js';
import { SpecialistExecutor, WorkerSpecialist } from '../../llm/SpecialistExecutor.js';
import { LedgerStorageEngine } from '../../storage/LedgerStorageEngine.js';

import { ProviderRegistry } from '../../llm/ProviderRegistry.js';

export class ExecuteHandler implements IStepHandler {
  constructor(
    _workerManager: WorkerManager,
    _providerRegistry: ProviderRegistry,
    _promptBuilder: PromptBuilder,
    _diskTooling: DiskTooling,
    private readonly specialistExecutor: SpecialistExecutor
  ) {}

  public canExecute(context: StateContext): boolean {
    return context.currentStep === FsmStep.EXECUTE;
  }

  public async execute(task: TaskRecord, project: ProjectRecord, storageEngine: LedgerStorageEngine): Promise<StepResult> {
    const settings = await storageEngine.getSettings();
    let specialist: WorkerSpecialist = task.context.execution.selectedWorker || 'gemini';
    const instructions = task.context.execution.geminiPrompt || task.objective.title;

    // Check for existing locks
    const now = new Date().toISOString();
    const activeLocks = (settings.quotaLocks || []).filter(lock => lock.disabledUntil > now);
    
    if (activeLocks.some(lock => lock.specialist === specialist)) {
        console.log(`[ExecuteHandler] Specialist ${specialist} is currently locked out. Searching for alternative...`);
        const available: WorkerSpecialist[] = ['gemini', 'copilot', 'opencode'];
        const fallback = available.find(s => !activeLocks.some(lock => lock.specialist === s));
        if (fallback) {
            console.log(`[ExecuteHandler] Falling back to ${fallback}.`);
            specialist = fallback;
        } else {
            return {
                status: StepStatus.FATAL,
                stateUpdates: {},
                humanMessage: "All specialist workers are currently locked out due to quota limits.",
                nextStepOverride: null
            };
        }
    }

    console.log(`[ExecuteHandler] Dispatching work to ${specialist} (TaskId: ${task.id})...`);

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
        const hMatch = waitTimeStr.match(/(\d+)h/);
        const mMatch = waitTimeStr.match(/(\d+)m/);
        const sMatch = waitTimeStr.match(/(\d+)s/);
        const hVal = hMatch ? parseInt(hMatch[1] || '0') : 0;
        const mVal = mMatch ? parseInt(mMatch[1] || '0') : 0;
        const sVal = sMatch ? parseInt(sMatch[1] || '0') : 0;
        const ms = (hVal * 3600 + mVal * 60 + sVal + 60) * 1000;
        const until = new Date(Date.now() + ms).toISOString();
        const currentLocks = settings.quotaLocks || [];

        await storageEngine.updateSettings({
            quotaLocks: [...currentLocks.filter(l => l.specialist !== 'gemini'), { specialist: 'gemini', reason: 'Quota Exhausted', disabledUntil: until }]
        });
        
        return {
          status: StepStatus.YIELD,
          stateUpdates: { 
              execution: { 
                  ...task.context.execution, 
                  lastErrorLog: `Quota exhausted. Lock set until ${until}` 
              } 
          },
          humanMessage: `⚠️ **Rate Limit Hit:** ${specialist} quota exhausted. Persistent lock set until ${until}.`,
          nextStepOverride: FsmStep.EXECUTE
        };
      }

      // Check for Copilot Quota
      if (result.stderr.includes('You have no quota') || result.stderr.includes('402')) {
          console.log(`[ExecuteHandler] Copilot quota hit. Locking until end of month.`);
          const now = new Date();
          const endOfMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59).toISOString();
          const currentLocks = settings.quotaLocks || [];
          try {
              await storageEngine.updateSettings({
                quotaLocks: [...currentLocks.filter(l => l.specialist !== 'copilot'), { specialist: 'copilot', reason: 'Out of Quota (402)', disabledUntil: endOfMonth }]
              });
          } catch (e) {
              console.error(`[ExecuteHandler] Failed to set Copilot quota lock: ${e}`);
          }
      }

      return {
        status: StepStatus.FAILED,
        stateUpdates: { 
            execution: { 
                ...task.context.execution, 
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
              activeWorkerId: specialist,
              specialistOutput: result.output
          } 
      },
      humanMessage: `Ralph has applied the code changes using ${specialist}.\n\nNotes:\n${result.output.slice(0, 1000)}`,
      nextStepOverride: null
    };
  }
}
