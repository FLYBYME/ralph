import { StateContext, TaskRecord, ProjectRecord } from '../../storage/types.js';
import { StepResult } from '../types.js';
import { LedgerStorageEngine } from '../../storage/LedgerStorageEngine.js';

/**
 * Every step of the FSM is isolated into its own handler class contract.
 */
export interface IStepHandler {
  /**
   * Validates that the memory has everything needed to run this step.
   */
  canExecute(context: StateContext): boolean;

  /**
   * The actual work. Returns a result that tells the machine how to update state.
   */
  execute(task: TaskRecord, project: ProjectRecord, storageEngine: LedgerStorageEngine): Promise<StepResult>;
}
