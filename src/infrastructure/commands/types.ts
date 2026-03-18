import { TaskRecord, ProjectRecord } from '../storage/types.js';
import { LedgerStorageEngine } from '../storage/LedgerStorageEngine.js';
import { LocalEventBus } from '../bus/LocalEventBus.js';
import { WorkerManager } from '../llm/WorkerManager.js';
import { ILlmProvider } from '../llm/types.js';

/**
 * CommandContext
 * Provides all resources a command might need to execute.
 */
export interface CommandContext {
  task: TaskRecord;
  project: ProjectRecord;
  sender: string;
  timestamp: string;
  storageEngine: LedgerStorageEngine;
  eventBus: LocalEventBus;
  workerManager: WorkerManager;
  llmProvider: ILlmProvider;
}

/**
 * Command Contract
 */
export interface Command {
  name: string;
  aliases?: string[];
  description: string;
  adminOnly: boolean;
  execute(ctx: CommandContext, args: string): Promise<void>;
}
