import { StateContext, TaskRecord, FsmStep, ProjectRecord } from '../../storage/types.js';
import { StepResult, StepStatus } from '../types.js';
import { IStepHandler } from './IStepHandler.js';

/**
 * ReviewHandler
 * Responsibility: Pauses the FSM until human intervention is detected.
 */
export class ReviewHandler implements IStepHandler {
  public canExecute(context: StateContext): boolean {
    return context.currentStep === FsmStep.AWAITING_REVIEW;
  }

  public async execute(_task: TaskRecord, _project: ProjectRecord): Promise<StepResult> {
    // This handler immediately returns a YIELD status.
    // The FSM will pause until a HumanInterventionReceivedEvent is detected.
    return {
      status: StepStatus.YIELD,
      stateUpdates: {}, // Memory stays frozen until yield resolved
      humanMessage: "Ralph has finished work and is waiting for your review.",
      nextStepOverride: null
    };
  }
}
