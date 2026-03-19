import { StateContext, TaskRecord, FsmStep, ProjectRecord } from '../../storage/types.js';
import { StepResult, StepStatus } from '../types.js';
import { IStepHandler } from './IStepHandler.js';
import { GitRunner } from '../../remote/GitRunner.js';
import { LedgerStorageEngine } from '../../storage/LedgerStorageEngine.js';
import { IRemoteProvider } from '../../remote/types.js';

/**
 * FinalizeHandler
 * Responsibility: Stages, commits, pushes, and opens a PR after user approval.
 */
export class FinalizeHandler implements IStepHandler {
  constructor(private readonly remoteProvider: IRemoteProvider) {}

  public canExecute(context: StateContext): boolean {
    return context.currentStep === FsmStep.FINALIZE;
  }

  public async execute(task: TaskRecord, project: ProjectRecord, _storageEngine: LedgerStorageEngine): Promise<StepResult> {
    const git = new GitRunner(project.absolutePath);
    const taskIdShort = task.id.split('-')[0];
    
    try {
        // 1. Ensure we are on a task-specific branch (Isolate from main)
        let currentBranch = await git.getCurrentBranch();
        if (currentBranch === project.defaultBranch) {
            const newBranch = `ralph/task-${taskIdShort}`;
            try {
                await git.createBranch(newBranch, project.defaultBranch);
                currentBranch = newBranch;
                console.log(`[FinalizeHandler] Created and checked out branch ${newBranch}`);
            } catch (branchErr) {
                console.warn(`[FinalizeHandler] Failed to create branch, continuing on current: ${branchErr}`);
            }
        }

        // 2. Stage changes
        const targetFiles = (task.context.planning.targetFiles && task.context.planning.targetFiles.length > 0) 
            ? task.context.planning.targetFiles 
            : ['.'];
        
        await git.gitAdd(targetFiles);

        // 3. Commit with a structured message
        const commitMsg = `Ralph: ${task.objective.title} (Task: ${task.id})`;
        const commitResult = await git.gitCommit(commitMsg);

        // 4. Push to remote origin
        let pushStatus = "";
        try {
            await git.pushBranch(currentBranch);
            pushStatus = ` and pushed to branch **${currentBranch}**`;
        } catch (pushErr) {
            console.warn(`[FinalizeHandler] Push failed/skipped: ${pushErr}`);
            pushStatus = ` (Note: Local commit only, push skipped)`;
        }

        // 5. Create Pull Request if applicable
        let prStatus = "";
        if (!project.isLocalOnly && project.name.includes('/')) {
            try {
                const [owner, repo] = project.name.split('/');
                const pr = await this.remoteProvider.createPullRequest(
                    owner!,
                    repo!,
                    currentBranch,
                    project.defaultBranch || 'main',
                    task.objective.title,
                    `## Ralph Task: ${task.objective.title}\n\n${task.objective.originalPrompt}\n\n---\n*Created automatically by Ralph (Task ${task.id})*`
                );
                prStatus = `\n\n🎉 **Pull Request Created:** [PR #${pr.number}](${pr.url})`;
            } catch (prErr) {
                console.warn(`[FinalizeHandler] PR creation failed: ${prErr}`);
                prStatus = `\n\n⚠️ **Note:** Could not open Pull Request: ${prErr instanceof Error ? prErr.message : String(prErr)}`;
            }
        }

        // 6. Final transition to COMPLETED
        task.status = 'COMPLETED';

        return {
          status: StepStatus.SUCCESS,
          stateUpdates: {},
          humanMessage: `🚀 **Task Finalized!** Ralph has committed the approved changes${pushStatus}.${prStatus}\n\n**Commit Details:**\n\`\`\`\n${commitResult}\n\`\`\``,
          nextStepOverride: null
        };

    } catch (error) {
        console.error(`[FinalizeHandler] Finalization failed: ${error}`);
        return {
          status: StepStatus.FAILED,
          stateUpdates: {},
          humanMessage: `❌ **Finalization Failed:** An error occurred: ${error}`,
          nextStepOverride: FsmStep.AWAITING_REVIEW
        };
    }
  }
}
