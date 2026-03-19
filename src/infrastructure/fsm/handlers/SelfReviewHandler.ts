import { StateContext, TaskRecord, FsmStep, ProjectRecord } from '../../storage/types.js';
import { StepResult, StepStatus } from '../types.js';
import { IStepHandler } from './IStepHandler.js';
import { WorkerManager } from '../../llm/WorkerManager.js';
import { ProviderRegistry } from '../../llm/ProviderRegistry.js';
import { PromptBuilder } from '../../llm/PromptBuilder.js';
import { IRemoteProvider } from '../../remote/types.js';

/**
 * SelfReviewHandler
 * Responsibility: Ralph reviews the specialist's git diff and generates a commit message.
 */
export class SelfReviewHandler implements IStepHandler {
  constructor(
    private readonly workerManager: WorkerManager,
    private readonly providerRegistry: ProviderRegistry,
    private readonly promptBuilder: PromptBuilder,
    private readonly remoteProvider: IRemoteProvider
  ) {}

  public canExecute(context: StateContext): boolean {
    return context.currentStep === FsmStep.SELF_REVIEW;
  }

  public async execute(task: TaskRecord, project: ProjectRecord): Promise<StepResult> {
    try {
        // 1. Get the current diff for this task
        const [owner, repo] = project.name.split('/');
        const diff = await this.remoteProvider.getDiff(owner || '', repo || project.name, task.id);

        if (!diff.trim()) {
            return {
                status: StepStatus.FAILED,
                stateUpdates: {},
                humanMessage: "Ralph could not find any changes to review. Git diff is empty.",
                nextStepOverride: FsmStep.INVESTIGATE
            };
        }

        // 2. Perform LLM Self-Review
        const model = this.providerRegistry.getActiveModel();
        const provider = this.providerRegistry.getActiveProvider();
        const payload = this.promptBuilder.buildSelfReviewPrompt(task, diff, model);
        const response = await this.workerManager.dispatch(payload, provider, model);

        let review: any = null;
        try {
            if (response.rawText) {
                // Strip markdown JSON block if present (common LLM failure mode)
                const cleanJson = response.rawText.replace(/```json\n|```/g, '').trim();
                review = JSON.parse(cleanJson);
            }
        } catch (e) {
            console.error("[SelfReviewHandler] Failed to parse review JSON result:", e);
        }

        if (!review) {
            return {
                status: StepStatus.FAILED,
                stateUpdates: {},
                humanMessage: "Ralph failed to generate a valid self-review result. Retrying.",
                nextStepOverride: null
            };
        }

        // 3. Update memory with Ralph's internal analysis and the generated commit message
        const stateUpdates = {
            review: {
                selfReviewNotes: review.notes,
                proposedCommitMessage: review.commit_message,
                diffSummary: review.diff_summary
            }
        };

        if (review.is_satisfactory) {
            return {
                status: StepStatus.SUCCESS,
                stateUpdates,
                humanMessage: `📝 **Ralph's Self-Review:**\n\n**Commit Message:** ${review.commit_message}\n\n**Analysis:** ${review.notes}`,
                nextStepOverride: null
            };
        } else {
             // If not satisfactory, go back to investigation to fix issues
             return {
                status: StepStatus.FAILED,
                stateUpdates,
                humanMessage: `❌ **Self-Review Failed Verification:** ${review.notes}\n\nReturning to investigation fix the issues.`,
                nextStepOverride: FsmStep.INVESTIGATE
            };
        }

    } catch (error) {
        console.error(`[SelfReviewHandler] Error: ${error}`);
        return {
          status: StepStatus.FAILED,
          stateUpdates: {},
          humanMessage: `⚠️ Self-review execution crashed: ${error}`,
          nextStepOverride: null
        };
    }
  }
}
