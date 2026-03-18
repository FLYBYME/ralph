import crypto from 'node:crypto';
import { LedgerStorageEngine } from '../storage/LedgerStorageEngine.js';
import { TaskQueue, YieldReason } from '../queue/TaskQueue.js';
import { LocalEventBus } from '../bus/LocalEventBus.js';
import { FiniteStateMachine } from '../fsm/FiniteStateMachine.js';
import { StepResult, StepStatus } from '../fsm/types.js';
import { ContextAnalyzer } from '../fsm/ContextAnalyzer.js';
import { createLogger, Logger } from '../logging/Logger.js';

export interface IWorkerManager {
  killAllProcesses(): Promise<void>;
}

/**
 * DaemonOrchestrator
 * Responsibility: The infinite heartbeat loop.
 * Manages lifecycle, signal handling, and enforces tick rate.
 */
export class DaemonOrchestrator {
  private isRunning: boolean = false;
  private tickIntervalMs: number = 1000;
  private tickCount: number = 0;
  private logger: Logger;

  constructor(
    private readonly storageEngine: LedgerStorageEngine,
    private readonly taskQueue: TaskQueue,
    private readonly eventBus: LocalEventBus,
    private readonly fsm: FiniteStateMachine,
    private readonly workerManager: IWorkerManager,
    private readonly contextAnalyzer?: ContextAnalyzer
  ) {
    this.logger = createLogger('orchestrator', eventBus);
  }

  /**
   * Initializes the engine and runs the Zombie Recovery Routine.
   */
  public async boot(): Promise<void> {
    this.logger.info('Booting Ralph...');
    
    // 1. Bootstrap storage
    await this.storageEngine.bootstrapEnvironment();

    // 2. Zombie Recovery Routine
    await this.runZombieRecovery();

    // 3. Register Signal Traps
    process.on('SIGINT', () => this.shutdown('SIGINT'));
    process.on('SIGTERM', () => this.shutdown('SIGTERM'));

    // 4. Start Heartbeat
    this.isRunning = true;
    this.logger.info(`Heartbeat started (${this.tickIntervalMs}ms)`);
    this.heartbeat();
  }

  /**
   * Gracefully shuts down the daemon.
   */
  public async shutdown(signal: string): Promise<void> {
    this.logger.warn(`Shutting down (Signal: ${signal})...`);
    this.isRunning = false;

    // 1. Kill LLM child processes
    await this.workerManager.killAllProcesses();

    this.logger.info('Ralph has been halted safely.');
    process.exit(0);
  }

  /**
   * The infinite heartbeat. Loops until isRunning is false.
   */
  private async heartbeat(): Promise<void> {
    while (this.isRunning) {
        try {
            this.tickCount++;
            await this.tick();
        } catch (error) {
            this.logger.error(`Fatal tick error: ${error}`);
        }

        // Enforce tick rate
        if (this.isRunning) {
            await new Promise(resolve => setTimeout(resolve, this.tickIntervalMs));
        }
    }
  }

  /**
   * The single unit of time.
   */
  public async tick(): Promise<void> {
    const task = await this.taskQueue.getNextActiveTask();
    
    if (!task) {
        // Quiet mode: only log every 10 idle ticks
        if (this.tickCount % 10 === 0) {
            this.logger.debug('IDLE - No active tasks in queue.');
        }
        return;
    }

    this.logger.info(`⚙️ TICK ${this.tickCount} | Task: ${task.id.slice(0, 8)} | Status: ${task.status}`, task.id);

    try {
        // Load the full task record
        let taskRecord;
        try {
            taskRecord = await this.storageEngine.getTaskRecord(task.id);
        } catch (recordError) {
            this.logger.warn(`Task record for ${task.id} missing on disk. Removing from ledger summary.`, task.id);
            await this.storageEngine.mutateLedger(async (ledger) => {
                ledger.tasks = ledger.tasks.filter(t => t.id !== task.id);
            });
            return;
        }

        const oldStep = taskRecord.context.currentStep;

        // Load project info
        const ledger = await this.storageEngine.getLedger();
        const project = ledger.projects.find(p => p.id === taskRecord.projectId);
        
        if (!project) {
            throw new Error(`Project ${taskRecord.projectId} not found in ledger for task ${task.id}`);
        }

        // 3. Human-in-the-Loop Context Analysis
        if (this.contextAnalyzer) {
            const analysis = await this.contextAnalyzer.analyzeContext(taskRecord, project);
            if (analysis.interrupted) {
                this.logger.warn('✋ INTERRUPT detected. Pivot triggered.', task.id);
                await this.storageEngine.commitTaskRecord(taskRecord);
                
                await this.storageEngine.mutateLedger(async (ledger) => {
                    const summary = ledger.tasks.find(t => t.id === task.id);
                    if (summary && summary.status !== taskRecord.status) {
                        summary.status = taskRecord.status;
                    }
                });
                return;
            }
        }

        // 4. Enforce max iterations from settings
        const settings = await this.storageEngine.getSettings();
        if (taskRecord.context.execution.attemptCount >= settings.maxIterations) {
            this.logger.error(`Max iterations reached (${settings.maxIterations}). Pausing task.`, task.id);
            taskRecord.status = 'PAUSED';
            taskRecord.thread.messages.push({
                id: crypto.randomUUID(),
                author: 'SYSTEM',
                intent: 'ERROR',
                body: `Automated execution reached the maximum allowed iterations (${settings.maxIterations}). Task paused for human intervention.`,
                timestamp: new Date().toISOString()
            });
            await this.storageEngine.commitTaskRecord(taskRecord);
            
            // Sync status to Ledger summary
            await this.storageEngine.mutateLedger(async (ledger) => {
                const summary = ledger.tasks.find(t => t.id === task.id);
                if (summary) {
                    summary.status = 'PAUSED';
                }
            });
            return;
        }

        // Execute exactly one step of the FSM
        this.logger.info(`▶️ Executing ${oldStep}... (Iteration: ${taskRecord.context.execution.attemptCount + 1}/${settings.maxIterations})`, task.id);
        
        // Increment attempt count
        taskRecord.context.execution.attemptCount++;

        const result: StepResult = await this.fsm.processTick(taskRecord, project, this.storageEngine);
        this.logger.info(`🏁 ${oldStep} finished with status: ${result.status}`, task.id);
        
        // Apply transitions (memory merges, state advances)
        this.fsm.applyTransition(taskRecord, result);

        // Commit updated state to disk
        await this.storageEngine.commitTaskRecord(taskRecord);

        // 1. Sync status back to the master Ledger (projection)
        await this.storageEngine.mutateLedger(async (ledger) => {
          const summary = ledger.tasks.find(t => t.id === task.id);
          if (summary && summary.status !== taskRecord.status) {
              summary.status = taskRecord.status;
          }
        });

        // 2. Handle Yielding
        if (result.status === StepStatus.YIELD) {
            let reason = taskRecord.status === 'AWAITING_REVIEW' ? YieldReason.AWAITING_REVIEW : YieldReason.RESOURCE_BUSY;
            let resumeAfterMs = 0;

            if (result.humanMessage?.includes('Rate Limit Hit') && result.humanMessage.includes('wait approximately')) {
                reason = YieldReason.RATE_LIMIT;
                const match = result.humanMessage.match(/wait approximately (\d+)h(?:(\d+)m)?(?:(\d+)s)?/);
                if (match) {
                    const hours = parseInt(match[1] || '0', 10);
                    const minutes = parseInt(match[2] || '0', 10);
                    const seconds = parseInt(match[3] || '0', 10);
                    resumeAfterMs = ((hours * 60 * 60) + (minutes * 60) + seconds + 300) * 1000;
                    this.logger.warn(`⏳ Task slept for ${Math.round(resumeAfterMs/1000/60)} minutes due to rate limit.`, task.id);
                }
            }

            this.logger.info(`⏸️ Task yielded (Reason: ${reason})`, task.id);
            await this.taskQueue.yieldTask(task.id, reason, resumeAfterMs);
        }

        // Broadcast result via EventBus
        this.eventBus.publish({
            type: 'FSM_TRANSITION',
            taskId: task.id,
            timestamp: new Date().toISOString(),
            oldState: oldStep,
            newState: taskRecord.context.currentStep
        });
    } catch (error) {
        this.logger.error(`FSM execution failure for task ${task.id}: ${error}`, task.id);
    }
  }

  /**
   * Zombie Recovery Routine
   * Scans for IN_PROGRESS tasks that don't have an active lock.
   */
  private async runZombieRecovery(): Promise<void> {
    await this.storageEngine.mutateLedger(async (ledger) => {
        const inProgressTasks = ledger.tasks.filter(t => t.status === 'IN_PROGRESS');

        for (const taskSummary of inProgressTasks) {
            // Task-specific lock for recovery
            const canAcquire = await this.storageEngine.acquireLock(taskSummary.id, 5000);
            
            if (canAcquire) {
                this.logger.warn(`Zombie recovery: Task ${taskSummary.id} found IN_PROGRESS but no active lock. Reverting to OPEN.`, taskSummary.id);
                
                taskSummary.status = 'OPEN';
                
                try {
                    await this.storageEngine.mutateTaskRecord(taskSummary.id, async (taskRecord) => {
                        taskRecord.status = 'OPEN';
                        taskRecord.thread.messages.push({
                            id: crypto.randomUUID(),
                            author: 'SYSTEM',
                            intent: 'STATUS_UPDATE',
                            body: '[Zombie Recovery] Task was found in an inconsistent state (IN_PROGRESS without lock). It has been reverted to OPEN for resume.',
                            timestamp: new Date().toISOString()
                        });
                    });
                } catch (err) {
                    this.logger.error(`Failed to execute zombie recovery mutation for task ${taskSummary.id}: ${err}`, taskSummary.id);
                }

                await this.storageEngine.releaseLock(taskSummary.id);
            } else {
                this.logger.info(`Task ${taskSummary.id} is IN_PROGRESS and has an active lock. Skipping recovery.`, taskSummary.id);
            }
        }
    });
  }
}
