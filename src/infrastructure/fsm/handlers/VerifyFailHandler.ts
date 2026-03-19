import { StateContext, TaskRecord, FsmStep, ProjectRecord } from '../../storage/types.js';
import { StepResult, StepStatus } from '../types.js';
import { IStepHandler } from './IStepHandler.js';
import { WorkerManager } from '../../llm/WorkerManager.js';
import { PromptBuilder } from '../../llm/PromptBuilder.js';
import { DiskTooling } from '../../storage/DiskTooling.js';
import { LedgerStorageEngine } from '../../storage/LedgerStorageEngine.js';
import { DockerRunner } from '../../remote/DockerRunner.js';
import * as path from 'path';
import { ProviderRegistry } from '../../llm/ProviderRegistry.js';

export class VerifyFailHandler implements IStepHandler {
  constructor(
    _workerManager: WorkerManager,
    _providerRegistry: ProviderRegistry,
    _promptBuilder: PromptBuilder,
    _diskTooling: DiskTooling
  ) {}

  public canExecute(context: StateContext): boolean {
    return context.currentStep === FsmStep.VERIFY_FAIL;
  }

  public async execute(task: TaskRecord, project: ProjectRecord, _storageEngine: LedgerStorageEngine): Promise<StepResult> {
    console.log(`[VerifyFailHandler] Ralph is verifying that tests fail for task ${task.id}...`);

    if (!project.ciCommands || project.ciCommands.length === 0) {
        return {
          status: StepStatus.FAILED,
          stateUpdates: {},
          humanMessage: "Cannot perform TDD verification without CI commands. Please configure them for the project.",
          nextStepOverride: FsmStep.INVESTIGATE
        };
    }

    const dockerRunner = new DockerRunner();
    const logPath = path.join(process.cwd(), 'data', 'logs', `ci-tdd-fail-${task.id}.log`);
    
    const commandToRun = project.ciCommands.join(' && ');

    try {
        await dockerRunner.runWorkflow(project.absolutePath, task.id, logPath, ['sh', '-c', commandToRun]);
        
        const conclusion = await dockerRunner.getStatus(task.id);
        const testsPassed = conclusion === 'success';
        
        // Try to read logs
        let logs = '';
        try {
            const fs = await import('node:fs/promises');
            logs = await fs.readFile(logPath, 'utf8');
        } catch {
            logs = 'Failed to read logs.';
        }

        if (testsPassed) {
          return {
            status: StepStatus.FAILED,
            stateUpdates: { verification: { ...task.context.verification, lintPassed: true, testOutput: logs.slice(-2000) } },
            humanMessage: `The tests passed, but they were expected to FAIL to prove the bug exists. Ralph will try to write a better reproduction test.`,
            nextStepOverride: FsmStep.WRITE_TESTS
          };
        }

        return {
          status: StepStatus.SUCCESS,
          stateUpdates: { verification: { ...task.context.verification, lintPassed: false, testOutput: logs.slice(-2000) } },
          humanMessage: "Ralph has successfully verified that the reproduction tests fail as expected. Now he can proceed to fix the issue.",
          nextStepOverride: FsmStep.EXECUTE
        };

    } catch (error) {
         return {
            status: StepStatus.FAILED,
            stateUpdates: { verification: { ...task.context.verification, testOutput: String(error) } },
            humanMessage: `TDD verification process crashed: ${error}`,
            nextStepOverride: FsmStep.WRITE_TESTS
          };
    }
  }
}
