import { TaskRecord, FsmStep, StateContext, ProjectRecord } from '../storage/types.js';
import { StepResult, StepStatus } from './types.js';
import { IStepHandler } from './handlers/IStepHandler.js';
import { InvestigateHandler } from './handlers/InvestigateHandler.js';
import { PlanHandler } from './handlers/PlanHandler.js';
import { ExecuteHandler } from './handlers/ExecuteHandler.js';
import { VerifyHandler } from './handlers/VerifyHandler.js';
import { ReviewHandler } from './handlers/ReviewHandler.js';
import { SelfReviewHandler } from './handlers/SelfReviewHandler.js';
import { WriteTestHandler } from './handlers/WriteTestHandler.js';
import { VerifyFailHandler } from './handlers/VerifyFailHandler.js';
import { WorkerManager } from '../llm/WorkerManager.js';
import { ProviderRegistry } from '../llm/ProviderRegistry.js';
import { PromptBuilder } from '../llm/PromptBuilder.js';
import { DiskTooling } from '../storage/DiskTooling.js';
import { SpecialistExecutor } from '../llm/SpecialistExecutor.js';
import { LedgerStorageEngine } from '../storage/LedgerStorageEngine.js';
import { IRemoteProvider } from '../remote/types.js';
import { FinalizeHandler } from './handlers/FinalizeHandler.js';
import * as crypto from 'node:crypto';

/**
 * FiniteStateMachine
 * Responsibility: The brain that binds handlers into a coherent flow.
 */
export class FiniteStateMachine {
  private handlers: Map<FsmStep, IStepHandler> = new Map();

  constructor(
    workerManager: WorkerManager,
    providerRegistry: ProviderRegistry,
    promptBuilder: PromptBuilder,
    diskTooling: DiskTooling,
    specialistExecutor: SpecialistExecutor,
    remoteProvider: IRemoteProvider
  ) {
    this.handlers.set(FsmStep.INVESTIGATE, new InvestigateHandler(workerManager, providerRegistry, promptBuilder, diskTooling));
    this.handlers.set(FsmStep.PLAN, new PlanHandler(workerManager, providerRegistry, promptBuilder, diskTooling));
    this.handlers.set(FsmStep.WRITE_TESTS, new WriteTestHandler(workerManager, providerRegistry, promptBuilder, diskTooling, specialistExecutor));
    this.handlers.set(FsmStep.VERIFY_FAIL, new VerifyFailHandler(workerManager, providerRegistry, promptBuilder, diskTooling));
    this.handlers.set(FsmStep.EXECUTE, new ExecuteHandler(workerManager, providerRegistry, promptBuilder, diskTooling, specialistExecutor));
    this.handlers.set(FsmStep.VERIFY, new VerifyHandler(workerManager, providerRegistry, promptBuilder, diskTooling));
    this.handlers.set(FsmStep.SELF_REVIEW, new SelfReviewHandler(workerManager, providerRegistry, promptBuilder, remoteProvider));
    this.handlers.set(FsmStep.AWAITING_REVIEW, new ReviewHandler());
    this.handlers.set(FsmStep.FINALIZE, new FinalizeHandler(remoteProvider));
  }

  /**
   * Routes the task to the correct handler based on its current currentStep.
   */
  public async processTick(task: TaskRecord, project: ProjectRecord, storageEngine: LedgerStorageEngine): Promise<StepResult> {
    const currentStep = task.context.currentStep || FsmStep.INVESTIGATE;
    const handler = this.handlers.get(currentStep);

    if (!handler) {
      throw new Error(`No handler registered for FsmStep: ${currentStep}`);
    }

    if (!handler.canExecute(task.context)) {
      throw new Error(`Handler for ${currentStep} refused to execute based on context memory validation.`);
    }

    // Injecting project context here since some handlers need project paths
    return await handler.execute(task, project, storageEngine);
  }


  /**
   * Applies the step result to the task's memory, updates status, and advances currentStep.
   */
  public applyTransition(task: TaskRecord, result: StepResult): void {
    // 1. Merge incremental memory updates (append-aware)
    this.mergeMemory(task.context, result.stateUpdates);

    // 2. Determine Next Step
    if (result.nextStepOverride) {
      // Prioritize explicit overrides (e.g. goto AWAITING_REVIEW on SUCCESS, or retry EXECUTE on FAILED)
      task.context.currentStep = result.nextStepOverride;
    } else if (result.status === StepStatus.SUCCESS) {
      // Default sequential advancement
      task.context.currentStep = this.getNextStep(task.context.currentStep || FsmStep.INVESTIGATE, task);
    } else if (result.status === StepStatus.FATAL) {
      // On FATAL failures, move to AWAITING_REVIEW to stop the loop
      task.context.currentStep = FsmStep.AWAITING_REVIEW;
    }
    // Note: On StepStatus.FAILED without override, currentStep remains the same (retry loop)

    // 3. Record human communication in task thread
    if (result.humanMessage) {
      task.thread.messages.push({
        id: crypto.randomUUID(),
        author: 'RALPH',
        intent: 'STATUS_UPDATE',
        body: result.humanMessage,
        timestamp: new Date().toISOString()
      });
    }

    // 4. High-level status synchronization
    if (task.context.currentStep === FsmStep.AWAITING_REVIEW) {
      task.status = 'AWAITING_REVIEW';
    }
  }

  private mergeMemory(context: StateContext, updates: Partial<StateContext>): void {
    // Deep-ish merge for the root fields
    if (updates.investigation) {
      context.investigation = { ...context.investigation, ...updates.investigation };
    }
    if (updates.planning) {
      context.planning = { ...context.planning, ...updates.planning };
    }
    if (updates.execution) {
      context.execution = { ...context.execution, ...updates.execution };
    }
    if (updates.verification) {
      context.verification = { ...context.verification, ...updates.verification };
    }
    if (updates.review) {
      context.review = { ...context.review, ...updates.review };
    }
    // currentStep is updated at transition time by applyTransition
  }

  private getNextStep(current: FsmStep, task: TaskRecord): FsmStep {
    const useTDD = task.objective.useTDD;

    const standardSequence = [
      FsmStep.INVESTIGATE,
      FsmStep.PLAN,
      FsmStep.EXECUTE,
      FsmStep.VERIFY,
      FsmStep.SELF_REVIEW,
      FsmStep.AWAITING_REVIEW,
      FsmStep.FINALIZE
    ];

    const tddSequence = [
      FsmStep.INVESTIGATE,
      FsmStep.PLAN,
      FsmStep.WRITE_TESTS,
      FsmStep.VERIFY_FAIL,
      FsmStep.EXECUTE,
      FsmStep.VERIFY,
      FsmStep.SELF_REVIEW,
      FsmStep.AWAITING_REVIEW,
      FsmStep.FINALIZE
    ];

    const sequence = useTDD ? tddSequence : standardSequence;
    const index = sequence.indexOf(current);
    if (index === -1 || index === sequence.length - 1) {
      return current; // Terminal state or unknown
    }
    return sequence[index + 1] ?? current;
  }
}
