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
    const planning = task.context.planning;
    const subTasks = planning.subTasks || [];

    if (subTasks.length === 0) {
        // Fallback or early exit if no subtasks
        return {
            status: StepStatus.SUCCESS,
            stateUpdates: {},
            humanMessage: "No sub-tasks defined. Skipping execution.",
            nextStepOverride: null
        };
    }

    // Identify next available tasks (dependencies met and not completed)
    const completedIds = subTasks.filter(t => t.status === 'COMPLETED').map(t => t.id);
    const availableTasks = subTasks.filter(t => 
        t.status !== 'COMPLETED' && 
        t.dependsOn.every(depId => completedIds.includes(depId))
    );

    const allFinished = subTasks.every(t => t.status === 'COMPLETED');

    if (allFinished) {
        // All tasks are completed!
        return {
            status: StepStatus.SUCCESS,
            stateUpdates: {
                execution: {
                    ...task.context.execution,
                    specialistOutput: subTasks.map(t => `### Task: ${t.id} [${t.worker}]\n${t.result}`).join('\n\n')
                }
            },
            humanMessage: `🚀 **Swarm Execution Complete.** All ${subTasks.length} sub-tasks have been applied successfully.`,
            nextStepOverride: null
        };
    }

    if (availableTasks.length === 0) {
        // We have unfinished tasks but none are available (deadlock or waiting)
        const failedTasks = subTasks.filter(t => t.status === 'FAILED');
        if (failedTasks.length > 0) {
             return {
                status: StepStatus.FAILED,
                stateUpdates: {},
                humanMessage: `Execution stalled. The following sub-tasks failed: ${failedTasks.map(t => t.id).join(', ')}`,
                nextStepOverride: FsmStep.PLAN
            };
        }
        
        return {
            status: StepStatus.FAILED,
            stateUpdates: {},
            humanMessage: "Execution stalled due to unmet dependencies or deadlock in the plan graph.",
            nextStepOverride: FsmStep.PLAN
        };
    }

    // For now, let's process the first available task (sequential Foreman)
    const currentTask = availableTasks[0]!;
    let specialist: WorkerSpecialist = (currentTask.worker as WorkerSpecialist) || 'gemini';
    const settings = await storageEngine.getSettings();

    // Determine actually enabled workers
    const enabledWorkers: WorkerSpecialist[] = [];
    if (settings.workerGeminiEnabled !== false) enabledWorkers.push('gemini');
    if (settings.workerCopilotEnabled !== false) enabledWorkers.push('copilot');
    if (settings.workerOpencodeEnabled !== false) enabledWorkers.push('opencode');

    // Specialists Lock-out check
    const now = new Date().toISOString();
    const activeLocks = (settings.quotaLocks || []).filter(lock => lock.disabledUntil > now);
    const lockedWorkers = activeLocks.map(l => l.specialist);

    const isAvailable = (s: WorkerSpecialist) => enabledWorkers.includes(s) && !lockedWorkers.includes(s);

    if (!isAvailable(specialist)) {
        const fallback = enabledWorkers.find(s => isAvailable(s));
        if (fallback) {
            console.log(`[ExecuteHandler] Specialist ${specialist} is unavailable (disabled or locked). Falling back to ${fallback} for sub-task ${currentTask.id}.`);
            specialist = fallback;
        } else {
             return {
                status: StepStatus.YIELD,
                stateUpdates: {},
                humanMessage: `No specialists are currently available (all disabled or locked). Waiting to resume sub-task ${currentTask.id}.`,
                nextStepOverride: FsmStep.EXECUTE
            };
        }
    }

    console.log(`[ExecuteHandler] Foreman: Executing sub-task ${currentTask.id} using ${specialist}...`);

    const prompt = `You are a specialist sub-agent. Your role: ${specialist}.
Task Objective: ${currentTask.instructions}
Target Files: ${currentTask.targetFiles.join(', ')}

## Instructions
- Explore and modify files using tools.
- Do not narrate.
- Exit once done.

## Output Format
Brief summary of changes made. Do NOT output files.`;

    const result = await this.specialistExecutor.execute(specialist, prompt, {
      cwd: project.absolutePath,
      taskId: task.id,
      activity: `Foreman: Running sub-task ${currentTask.id} (${currentTask.instructions})`,
      timeoutMs: settings.specialistTimeoutMs
    });

    // Update the record for this sub-task
    const updatedSubTasks = subTasks.map(t => {
        if (t.id === currentTask.id) {
            return {
                ...t,
                status: result.success ? ('COMPLETED' as const) : ('FAILED' as const),
                result: result.success ? result.output : result.stderr
            };
        }
        return t;
    });

    if (!result.success) {
        // Quota check (reuse existing logic but adapted for Foreman yield)
        if (result.stderr.includes('QUOTA_EXHAUSTED') || result.stderr.includes('Rate limit')) {
             return {
                status: StepStatus.YIELD,
                stateUpdates: {
                    planning: { ...planning, subTasks: updatedSubTasks }
                },
                humanMessage: `⚠️ Sub-task ${currentTask.id} hit a rate limit. Yielding control.`,
                nextStepOverride: FsmStep.EXECUTE
            };
        }

        return {
            status: StepStatus.FAILED,
            stateUpdates: {
                planning: { ...planning, subTasks: updatedSubTasks },
                execution: { ...task.context.execution, lastErrorLog: result.stderr }
            },
            humanMessage: `❌ Sub-task ${currentTask.id} failed: ${result.stderr}`,
            nextStepOverride: null // Let the sequential loop decide if it should retry or plan
        };
    }

    // Success for this sub-task - loop back to EXECUTE to pick the next one
    return {
        status: StepStatus.YIELD, // Yield so we can update the ledger and pick the next task in the next tick
        stateUpdates: {
            planning: { ...planning, subTasks: updatedSubTasks },
            execution: { 
                ...task.context.execution, 
                activeWorkerId: specialist,
                specialistOutput: (task.context.execution.specialistOutput || '') + `\n\n### Task ${currentTask.id} Done.\n${result.output}`
            }
        },
        humanMessage: `✅ Sub-task ${currentTask.id} complete. Foreman moving to next available task...`,
        nextStepOverride: FsmStep.EXECUTE
    };
  }
}
