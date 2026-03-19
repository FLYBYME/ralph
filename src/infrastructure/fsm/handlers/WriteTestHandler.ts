import { StateContext, TaskRecord, FsmStep, ProjectRecord } from '../../storage/types.js';
import { StepResult, StepStatus } from '../types.js';
import { IStepHandler } from './IStepHandler.js';
import { WorkerManager } from '../../llm/WorkerManager.js';
import { PromptBuilder } from '../../llm/PromptBuilder.js';
import { DiskTooling } from '../../storage/DiskTooling.js';
import { SpecialistExecutor } from '../../llm/SpecialistExecutor.js';
import { LedgerStorageEngine } from '../../storage/LedgerStorageEngine.js';
import { ProviderRegistry } from '../../llm/ProviderRegistry.js';

export class WriteTestHandler implements IStepHandler {
  constructor(
    _workerManager: WorkerManager,
    _providerRegistry: ProviderRegistry,
    _promptBuilder: PromptBuilder,
    _diskTooling: DiskTooling,
    private readonly specialistExecutor: SpecialistExecutor
  ) {}

  public canExecute(context: StateContext): boolean {
    return context.currentStep === FsmStep.WRITE_TESTS;
  }

  public async execute(task: TaskRecord, project: ProjectRecord, _storageEngine: LedgerStorageEngine): Promise<StepResult> {
    console.log(`[WriteTestHandler] Ralph is writing reproduction tests for task ${task.id}...`);

    const prompt = `You are practicing strict Test-Driven Development. 
Your objective is: ${task.objective.originalPrompt}. 

## Instructions
- Modify existing test files or create new ones to include a FAILING test that reproduces this issue. 
- DO NOT modify the application source code (implementation files).
- Your only goal is to prove the bug exists or that the new feature is not yet implemented.
- Use your tools to explore the codebase and identify where the tests should go.
- Exit once you have successfully written the failing tests.

## Output Format
Brief summary of the tests written. Do NOT output file content in your final answer.`;

    const result = await this.specialistExecutor.execute('gemini', prompt, {
      cwd: project.absolutePath,
      taskId: task.id,
      activity: 'TDD: Writing reproduction tests'
    });

    if (!result.success) {
        return {
            status: StepStatus.FAILED,
            stateUpdates: {
                execution: { ...task.context.execution, lastErrorLog: result.stderr }
            },
            humanMessage: `❌ Failed to write reproduction tests: ${result.stderr}`,
            nextStepOverride: null
        };
    }

    return {
        status: StepStatus.SUCCESS,
        stateUpdates: {
            execution: { 
                ...task.context.execution, 
                specialistOutput: (task.context.execution.specialistOutput || '') + `\n\n### TDD: Reproduction Tests Written\n${result.output}`
            }
        },
        humanMessage: `✅ Reproduction tests written successfully. Ralph will now verify they fail as expected.`,
        nextStepOverride: FsmStep.VERIFY_FAIL
    };
  }
}
