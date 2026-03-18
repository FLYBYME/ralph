import { IAction, ActionParams, ActionResult } from './types.js';
import { LedgerStorageEngine } from '../storage/LedgerStorageEngine.js';
import { LocalEventBus } from '../bus/LocalEventBus.js';
import { TaskResolver } from '../storage/TaskResolver.js';

/**
 * SolveAction
 * High-level entry point to start an autonomous solving loop.
 */
export class SolveAction implements IAction {
  public readonly actionId = 'solve';

  constructor(
    private readonly storageEngine: LedgerStorageEngine,
    private readonly eventBus: LocalEventBus,
    private readonly taskResolver: TaskResolver
  ) {}

  /**
   * Orchestrates the creation of a new solving task.
   */
  public async execute(params: ActionParams): Promise<ActionResult> {
    const { projectId, externalId, input, urgent } = params;

    if (!projectId) {
      return { success: false, taskId: '', message: 'projectId is required' };
    }

    try {
      // 1. Resolve task context (fetches title/body from remote if needed)
      const resolved = await this.taskResolver.resolve(projectId, externalId);
      
      // 2. Determine final prompt/objective
      const finalPrompt = input || resolved.body || 'Please investigate and solve this task.';
      
      // 3. Create the task in the ledger and storage
      const taskRecord = await this.storageEngine.createTask(
        projectId,
        resolved.title,
        finalPrompt,
        urgent ?? false
      );

      // 4. Broadcast intent via EventBus
      this.eventBus.publish({
        type: 'FSM_TRANSITION',
        taskId: taskRecord.id,
        timestamp: new Date().toISOString(),
        oldState: 'NONE',
        newState: taskRecord.context.currentStep
      });

      return {
        success: true,
        taskId: taskRecord.id,
        message: `Task created and enqueued: ${taskRecord.id}`
      };
    } catch (error) {
      console.error('[SolveAction] Failed to execute:', error);
      return {
        success: false,
        taskId: '',
        message: `Failed to initialize solve action: ${error instanceof Error ? error.message : String(error)}`
      };
    }
  }
}
