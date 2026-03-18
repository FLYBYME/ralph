import { FsmStep, StateContext } from '../storage/types.js';

export enum StepStatus {
  SUCCESS = 'SUCCESS',
  FAILED = 'FAILED',
  YIELD = 'YIELD',
  FATAL = 'FATAL'
}

/**
 * StepResult
 * Structured payload returned by an FSM step handler.
 */
export interface StepResult {
  status: StepStatus;
  stateUpdates: Partial<StateContext>;
  humanMessage: string | null;
  nextStepOverride: FsmStep | null;
}
