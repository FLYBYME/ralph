import { StateContext, TaskRecord, FsmStep, ProjectRecord } from '../../storage/types.js';
import { StepResult, StepStatus } from '../types.js';
import { IStepHandler } from './IStepHandler.js';
import { WorkerManager } from '../../llm/WorkerManager.js';
import { PromptBuilder } from '../../llm/PromptBuilder.js';
import { DiskTooling } from '../../storage/DiskTooling.js';
import { createToolRegistry } from '../../llm/ToolRegistry.js';
import { LedgerStorageEngine } from '../../storage/LedgerStorageEngine.js';

import { ProviderRegistry } from '../../llm/ProviderRegistry.js';

export class InvestigateHandler implements IStepHandler {
  constructor(
    private readonly workerManager: WorkerManager,
    private readonly providerRegistry: ProviderRegistry,
    _promptBuilder: PromptBuilder,
    _diskTooling: DiskTooling
  ) {}

  public canExecute(context: StateContext): boolean {
    return context.currentStep === FsmStep.INVESTIGATE;
  }

  public async execute(task: TaskRecord, project: ProjectRecord, storageEngine: LedgerStorageEngine): Promise<StepResult> {
    const registry = createToolRegistry({
      repoPath: project.absolutePath,
      workerManager: this.workerManager,
      workerProvider: this.providerRegistry.getActiveProvider(),
      storageEngine: storageEngine
    });

    // Legacy-style investigation prompts adapted for WorkerPayload
    const systemPrompt = `You are "Ralph", an autonomous AI code investigator. Your ONLY job is to explore a repository and figure out which files are relevant to a task.
    
## CRITICAL RULES
1. Do NOT write code. Do NOT propose changes yet.
2. YOU MUST USE TOOLS to explore the codebase. Do not guess file paths. Use 'listDirectory' to look around first.
3. Think step-by-step. Look for the core logic, but also check for related tests, types, or configuration files.
4. Once you have exhausted your search and found the exact files to change, ONLY THEN should you call the 'concludeInvestigation' tool to finish.

## FINAL OUTPUT FORMAT
You MUST call the 'concludeInvestigation' tool to end this phase. Your report parameter should be formatted as:
1. **Root Cause Hypothesis**: What is actually causing the issue?
2. **Relevant Files**: Exact paths to the files that need changing, and why.
3. **Action Plan**: What specific functions or lines matter, and what needs to change at a high level.`;

    const userPrompt = `## Task
**${task.objective.title}**

${task.objective.originalPrompt || '(no description)'}

IMPORTANT: You must start by calling the 'listDirectory' tool to see what is in the repository. Do not guess.`;

    const provider = this.providerRegistry.getActiveProvider();
    const model = this.providerRegistry.getActiveModel();
    const settings = await storageEngine.getSettings();

    const result = await this.workerManager.reactDispatch({
        model,
        systemPrompt,
        initialPrompt: userPrompt,
        provider,
        tools: registry,
        maxIterations: settings.maxReActTurns || 20,
        taskId: task.id
    });

    if (result.status === 'concluded') {
        return {
            status: StepStatus.SUCCESS,
            stateUpdates: {
                investigation: {
                    discoveredFiles: [],
                    searchQueriesRun: [],
                    architecturalSummary: result.finalAnswer,
                    notes: result.finalAnswer
                }
            },
            humanMessage: result.finalAnswer,
            nextStepOverride: null
        };
    }

    return {
      status: StepStatus.SUCCESS,
      stateUpdates: {
        investigation: {
          discoveredFiles: [], 
          searchQueriesRun: [],
          architecturalSummary: result.finalAnswer || "Investigation completed.",
          notes: result.finalAnswer || ''
        }
      },
      humanMessage: "Ralph has finished investigating the codebase.",
      nextStepOverride: null
    };
  }
}
