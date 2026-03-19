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

export class VerifyHandler implements IStepHandler {
  constructor(
    _workerManager: WorkerManager,
    _providerRegistry: ProviderRegistry,
    _promptBuilder: PromptBuilder,
    _diskTooling: DiskTooling
  ) {}

  public canExecute(context: StateContext): boolean {
    return context.currentStep === FsmStep.VERIFY;
  }

  public async execute(task: TaskRecord, project: ProjectRecord, _storageEngine: LedgerStorageEngine): Promise<StepResult> {
    
    if (!project.ciCommands || project.ciCommands.length === 0) {
        return {
          status: StepStatus.SUCCESS,
          stateUpdates: { verification: { ...task.context.verification, lintPassed: true, testOutput: "No CI commands configured. Skipped." } },
          humanMessage: "Ralph has skipped verification (no CI commands configured).",
          nextStepOverride: null
        };
    }

    const dockerRunner = new DockerRunner();
    const logPath = path.join(process.cwd(), 'data', 'logs', `ci-${task.id}.log`);
    
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

        if (!testsPassed) {
          return {
            status: StepStatus.FAILED,
            stateUpdates: { verification: { ...task.context.verification, lintPassed: false, testOutput: logs.slice(-2000) } },
            humanMessage: `Verification failed.\n\nLogs:\n${logs.slice(-1000)}\n\nRe-executing.`,
            nextStepOverride: FsmStep.EXECUTE
          };
        }

        return {
          status: StepStatus.SUCCESS,
          stateUpdates: { verification: { ...task.context.verification, lintPassed: true, testOutput: logs.slice(-2000) } },
          humanMessage: "Ralph has successfully verified the changes.",
          nextStepOverride: null
        };

    } catch (error) {
         return {
            status: StepStatus.FATAL,
            stateUpdates: { verification: { ...task.context.verification, lintPassed: false, testOutput: String(error) } },
            humanMessage: `Verification process crashed: ${error}`,
            nextStepOverride: FsmStep.EXECUTE
          };
    }
  }
}
