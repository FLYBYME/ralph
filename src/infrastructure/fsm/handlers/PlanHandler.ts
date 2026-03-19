import { StateContext, TaskRecord, FsmStep, ProjectRecord } from '../../storage/types.js';
import { StepResult, StepStatus } from '../types.js';
import { IStepHandler } from './IStepHandler.js';
import { WorkerManager } from '../../llm/WorkerManager.js';
import { WorkerPayload } from '../../llm/types.js';
import { PromptBuilder } from '../../llm/PromptBuilder.js';
import { DiskTooling } from '../../storage/DiskTooling.js';
import { LedgerStorageEngine } from '../../storage/LedgerStorageEngine.js';
import { ProviderRegistry } from '../../llm/ProviderRegistry.js';

export class PlanHandler implements IStepHandler {
  constructor(
    private readonly workerManager: WorkerManager,
    private readonly providerRegistry: ProviderRegistry,
    _promptBuilder: PromptBuilder,
    _diskTooling: DiskTooling
  ) {}

  public canExecute(context: StateContext): boolean {
    return context.currentStep === FsmStep.PLAN;
  }

  public async execute(task: TaskRecord, _project: ProjectRecord, storageEngine: LedgerStorageEngine): Promise<StepResult> {
    const settings = await storageEngine.getSettings();
    const now = new Date().toISOString();
    const lockedSpecialists = (settings.quotaLocks || [])
        .filter(lock => lock.disabledUntil > now)
        .map(lock => lock.specialist);

    const selectedWorker = task.context.execution?.selectedWorker || 'gemini';
    const investigationNotes = task.context.investigation.notes || "No investigation notes.";

    const systemPrompt = `You are "Ralph", a Lead AI Software Manager. Your objective is to decompose the main task into a discrete dependency graph of sub-tasks.
    
## Guidelines:
- **Root Cause Analysis**: Explain *why* you are choosing this approach.
- **Sub-Tasks**: Break the work into independent units of work.
- **Specialists**: Choose 'gemini' for complex logic/state, 'copilot' for boilerplate/tests, and 'opencode' for shell/cleanup.
${lockedSpecialists.length > 0 ? `- **UNAVAILABLE WORKERS**: Do NOT use ${lockedSpecialists.join(', ')} as they are out of quota.` : ''}
- **Dependencies**: Use 'depends_on' to ensure task_2 only starts after task_1 fixes the core bug.
- **Target Files**: Be specific about which files each sub-task touches (max 3 per sub-task).`;

    const userPrompt = `## Main Objective
**${task.objective.title}**
${task.objective.originalPrompt || '(no description)'}

## Investigation Findings
${investigationNotes}

Respond with a JSON object in this format:
{
  "root_cause_analysis": "string",
  "sub_tasks": [
    {
      "id": "task_1",
      "worker": "gemini" | "copilot" | "opencode",
      "instructions": "string",
      "target_files": ["string"],
      "depends_on": []
    }
  ]
}`;

    const schema = {
        type: "object",
        properties: {
            root_cause_analysis: { type: "string" },
            sub_tasks: {
                type: "array",
                items: {
                    type: "object",
                    properties: {
                        id: { type: "string" },
                        worker: { type: "string", enum: ["gemini", "copilot", "opencode"] },
                        instructions: { type: "string" },
                        target_files: { type: "array", items: { type: "string" } },
                        depends_on: { type: "array", items: { type: "string" } }
                    },
                    required: ["id", "worker", "instructions", "target_files", "depends_on"]
                }
            }
        },
        required: ["root_cause_analysis", "sub_tasks"]
    };

    const payload: Omit<WorkerPayload, 'model'> = {
        systemPrompt,
        userPrompt,
        contextFiles: [],
        expectedOutputSchema: schema
    };

    const provider = this.providerRegistry.getActiveProvider();
    const model = this.providerRegistry.getActiveModel();

    const response = await this.workerManager.dispatch(payload, provider, model);
    
    let plan: any = null;
    try {
        if (response.rawText) {
            const clean = response.rawText.replace(/```json\n|```/g, '').trim();
            plan = JSON.parse(clean);
        }
    } catch (e) {
        console.warn("[PlanHandler] Failed to parse plan JSON. Falling back.", e);
        plan = { 
            root_cause_analysis: "Plan generation failed. Defaulting to monolithic execution.", 
            sub_tasks: [{
                id: "task_0",
                worker: selectedWorker,
                instructions: investigationNotes,
                target_files: [],
                depends_on: []
            }]
        };
    }

    return {
      status: StepStatus.SUCCESS,
      stateUpdates: {
        planning: {
          rootCauseAnalysis: plan.root_cause_analysis,
          subTasks: plan.sub_tasks.map((t: any) => ({
              ...t,
              targetFiles: t.target_files,
              dependsOn: t.depends_on,
              status: 'OPEN'
          })),
          proposedSteps: [], 
          targetFiles: Array.from(new Set(plan.sub_tasks.flatMap((t: any) => t.target_files))),
          requiredTools: []
        },
        execution: {
            ...task.context.execution,
            geminiPrompt: plan.sub_tasks[0]?.instructions || investigationNotes,
            selectedWorker: plan.sub_tasks[0]?.worker || selectedWorker
        }
      },
      humanMessage: "Ralph has created a strategy and is waiting for your approval.",
      nextStepOverride: FsmStep.AWAITING_REVIEW
    };
  }
}
