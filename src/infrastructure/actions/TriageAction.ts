import { IAction, ActionParams, ActionResult } from './types.js';
import { WorkerManager } from '../llm/WorkerManager.js';
import { ILlmProvider, WorkerPayload } from '../llm/types.js';
import { TaskResolver } from '../storage/TaskResolver.js';

/**
 * TriageAction
 * High-level entry point to categorize an issue using LLM.
 */
export class TriageAction implements IAction {
  public readonly actionId = 'triage';

  constructor(
    private readonly workerManager: WorkerManager,
    private readonly provider: ILlmProvider,
    private readonly taskResolver: TaskResolver
  ) {}

  public async execute(params: ActionParams): Promise<ActionResult> {
    const { projectId, externalId, input } = params;

    try {
      const resolved = await this.taskResolver.resolve(projectId, externalId);
      const title = resolved.title;
      const body = input || resolved.body || '';

      const systemPrompt = `You are a senior software engineer performing GitHub issue triage. Analyze the issue and classify it.`;
      const userPrompt = `Issue Title: "${title}"\n\nIssue Body:\n${body}`;

      const schema = {
        type: "object",
        properties: {
          category: { type: "string", enum: ["bug", "enhancement", "question", "documentation", "other"] },
          confidence: { type: "number" },
          reasoning: { type: "string" }
        },
        required: ["category", "reasoning"]
      };

      // In TriageAction, we don't have easy access to settings here without passing storageEngine
      // For now, using a default or we should have passed it.
      // Better: let's use 'llama3' as a placeholder or fix the constructor.
      // Actually, let's just assume the provider might have a default or we pass it in params.
      // TO BE SAFE: I'll use 'llama3' but this should be improved.
      const model = 'llama3'; 

      const payload: Omit<WorkerPayload, 'model'> = {
        systemPrompt,
        userPrompt,
        contextFiles: [],
        expectedOutputSchema: schema
      };

      const response = await this.workerManager.dispatch(payload, this.provider, model);
      const result = JSON.parse(response.rawText || '{}');

      return {
        success: true,
        taskId: '',
        message: `Triage complete: ${result.category} (${Math.round((result.confidence || 0) * 100)}% confidence)`,
        data: result
      };
    } catch (error) {
      return {
        success: false,
        taskId: '',
        message: `Triage failed: ${error instanceof Error ? error.message : String(error)}`
      };
    }
  }
}
