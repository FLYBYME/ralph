
import { LedgerStorageEngine } from '../storage/LedgerStorageEngine.js';
import { TaskSummary } from '../storage/types.js';
import { colors, color } from '../../utils/colors.js';

export enum YieldReason {
  RATE_LIMIT = 'RATE_LIMIT',
  AWAITING_REVIEW = 'AWAITING_REVIEW',
  RESOURCE_BUSY = 'RESOURCE_BUSY'
}

/**
 * TaskQueue
 * Responsibility: Replaces naive loop.
 * Knows when to prioritize or back off based on local resources and human input.
 */
export class TaskQueue {
  constructor(private readonly storageEngine: LedgerStorageEngine) { }

  /**
   * Reads LocalLedger and selects the next task to process based on a strict hierarchy.
   */
  public async getNextActiveTask(): Promise<TaskSummary | null> {
    const ledger = await this.storageEngine.getLedger();
    const tasks = ledger.tasks;
    const now = new Date().toISOString();

    // 1. Filter out locked/blocked tasks
    const eligibleTasks = tasks.filter((task) => {
      const isProcessable = task.status === 'OPEN' || task.status === 'IN_PROGRESS' || (task.status === 'AWAITING_REVIEW' && task.humanInputReceived);
      const isNotLocked = !task.resumeAfter || task.resumeAfter <= now;
      return isProcessable && isNotLocked;
    });

    if (eligibleTasks.length === 0) return null;

    // 2. Sorting based on hierarchy
    eligibleTasks.sort((a, b) => {
      const getScore = (t: TaskSummary) => {
        let score = 0;
        if (t.humanInputReceived) score += 1000;
        if (t.urgent) score += 100;
        return score;
      };

      const scoreA = getScore(a);
      const scoreB = getScore(b);

      if (scoreA !== scoreB) return scoreB - scoreA;
      return a.id.localeCompare(b.id);
    });

    const selected = eligibleTasks[0] ?? null;
    if (selected) {
        console.log(`${color('[queue]', colors.dim)} Selected Task: ${color(selected.id.slice(0, 8), colors.yellow)} (Score: ${selected.humanInputReceived ? '1000+' : selected.urgent ? '100+' : '0'})`);
    }
    
    return selected;
  }

  /**
   * Parks a task, preventing it from being picked up until resumeAfterMs has elapsed.
   */
  public async yieldTask(taskId: string, reason: YieldReason, resumeAfterMs?: number): Promise<void> {
    await this.storageEngine.mutateLedger(async (ledger) => {
      const taskIndex = ledger.tasks.findIndex(t => t.id === taskId);
      if (taskIndex === -1) throw new Error(`Task ${taskId} not found in ledger`);
      
      const task = ledger.tasks[taskIndex]!;
      if (resumeAfterMs) {
        task.resumeAfter = new Date(Date.now() + resumeAfterMs).toISOString();
      }

      if (reason === YieldReason.AWAITING_REVIEW) {
        task.status = 'AWAITING_REVIEW';
        task.humanInputReceived = false;
        
        // Sync to TaskRecord (The absolute source of truth)
        try {
            await this.storageEngine.mutateTaskRecord(taskId, async (record) => {
              record.status = 'AWAITING_REVIEW';
            });
        } catch (err) {
            console.error(`[TaskQueue] Critical: Could not update status in TaskRecord for ${taskId}`, err);
        }
      }
    });
  }
}
