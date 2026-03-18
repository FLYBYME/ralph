import { StateContext, TaskRecord, FsmStep, ProjectRecord } from '../../storage/types.js';
import { StepResult, StepStatus } from '../types.js';
import { IStepHandler } from './IStepHandler.js';
import { WorkerManager } from '../../llm/WorkerManager.js';
import { ILlmProvider, WorkerPayload } from '../../llm/types.js';
import { PromptBuilder } from '../../llm/PromptBuilder.js';
import { DiskTooling } from '../../storage/DiskTooling.js';
import { LedgerStorageEngine } from '../../storage/LedgerStorageEngine.js';

export class PlanHandler implements IStepHandler {
  constructor(
    private readonly workerManager: WorkerManager,
    private readonly provider: ILlmProvider,
    _promptBuilder: PromptBuilder,
    _diskTooling: DiskTooling
  ) {}

  public canExecute(context: StateContext): boolean {
    return context.currentStep === FsmStep.PLAN;
  }

  public async execute(task: TaskRecord, _project: ProjectRecord, storageEngine: LedgerStorageEngine): Promise<StepResult> {
    const settings = await storageEngine.getSettings();
    const selectedWorker = task.context.execution?.selectedWorker || 'gemini';
    const investigationNotes = task.context.investigation.notes || "No investigation notes.";

    const systemPrompt = `You are "Ralph", a Lead AI Software Architect. Based on the investigation, generate a precise implementation plan payload for a senior specialist.
    
## Guidelines:
- **Selected Worker**: Choose 'gemini' for general complex logic, 'copilot' for boilerplate, and 'opencode' for shell tasks.
- **Instructions**: Be extremely specific. Include exact function names to modify or create.
- **Files**: Maximum 6 files.`;

    const userPrompt = `## Task
**${task.objective.title}**
${task.objective.originalPrompt || '(no description)'}

## Investigation Notes
${investigationNotes}

Respond with a JSON object in this format:
{
  "root_cause_analysis": "string",
  "selected_worker": "gemini" | "copilot" | "opencode",
  "instructions": "string",
  "test_plan": "string",
  "exact_files_to_include": ["string"]
}`;

    const schema = {
        type: "object",
        properties: {
            root_cause_analysis: { type: "string" },
            selected_worker: { type: "string", enum: ["gemini", "copilot", "opencode"] },
            instructions: { type: "string" },
            test_plan: { type: "string" },
            exact_files_to_include: { type: "array", items: { type: "string" } }
        },
        required: ["selected_worker", "instructions", "exact_files_to_include"]
    };

    const payload: Omit<WorkerPayload, 'model'> = {
        systemPrompt,
        userPrompt,
        contextFiles: [],
        expectedOutputSchema: schema
    };

    const response = await this.workerManager.dispatch(payload, this.provider, settings.ollamaModel);
    
    let plan: any = null;
    try {
        if (response.rawText) {
            plan = JSON.parse(response.rawText);
        }
    } catch (e) {
        console.warn("[PlanHandler] Failed to parse plan JSON.", e);
        // Fallback to basic plan if JSON fails
        plan = { selected_worker: selectedWorker, instructions: investigationNotes, exact_files_to_include: [] };
    }

    return {
      status: StepStatus.SUCCESS,
      stateUpdates: {
        planning: {
          proposedSteps: [], // Could be expanded from plan.instructions
          targetFiles: plan.exact_files_to_include || [],
          requiredTools: [],
          planSummary: plan.root_cause_analysis || "Plan generated."
        },
        execution: {
            ...task.context.execution,
            geminiPrompt: plan.instructions,
            selectedWorker: plan.selected_worker || selectedWorker
        }
      },
      humanMessage: "Ralph has created a strategy and is waiting for your approval.",
      nextStepOverride: FsmStep.AWAITING_REVIEW
    };
  }
}
