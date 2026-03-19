import { IAction, ActionParams, ActionResult } from './types.js';
import { LedgerStorageEngine } from '../storage/LedgerStorageEngine.js';
import { LocalEventBus } from '../bus/LocalEventBus.js';

/**
 * AuditAction
 * Action for proactive maintenance tasks initiated by the Janitor daemon.
 */
export class AuditAction implements IAction {
  public readonly actionId = 'audit';

  constructor(
    private readonly storageEngine: LedgerStorageEngine,
    private readonly eventBus: LocalEventBus
  ) {}

  public async execute(params: ActionParams): Promise<ActionResult> {
    const { projectId, input, title = 'Maintenance Audit', useTDD } = params;

    if (!projectId) {
      return { success: false, taskId: '', message: 'projectId is required' };
    }

    try {
      const taskRecord = await this.storageEngine.createTask(
        projectId,
        title,
        input || 'Perform automated maintenance audit.',
        false, // Not urgent
        ['janitor', 'maintenance'],
        [],
        undefined,
        useTDD
      );

      // Append initial Janitor notes
      if (params.data) {
          await this.storageEngine.mutateTaskRecord(taskRecord.id, async (record) => {
              record.context.investigation.notes = typeof params.data === 'string' ? params.data : JSON.stringify(params.data, null, 2);
          });
      }

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
        message: `Janitor task created: ${taskRecord.id}`
      };
    } catch (error) {
      return {
        success: false,
        taskId: '',
        message: `Failed to initialize audit action: ${error instanceof Error ? error.message : String(error)}`
      };
    }
  }
}
