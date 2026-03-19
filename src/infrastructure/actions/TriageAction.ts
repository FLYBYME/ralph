import { z } from 'zod';
import { IAction, ActionParams, ActionResult } from './types.js';
import { WorkerManager } from '../llm/WorkerManager.js';
import { ProviderRegistry } from '../llm/ProviderRegistry.js';
import { TaskResolver } from '../storage/TaskResolver.js';

const TriageSchema = z.object({
  category: z.enum(["bug", "enhancement", "question", "documentation", "other"]),
  confidence: z.number().optional(),
  reasoning: z.string()
});

type TriageResult = z.infer<typeof TriageSchema>;

/**
 * TriageAction
 * High-level entry point to categorize an issue using LLM.
 */
export class TriageAction implements IAction {
  public readonly actionId = 'triage';

  constructor(
    private readonly workerManager: WorkerManager,
    private readonly providerRegistry: ProviderRegistry,
    private readonly taskResolver: TaskResolver
  ) {}

  public async execute(params: ActionParams): Promise<ActionResult> {
    const { projectId, externalId, input } = params;

    try {
      const resolved = await this.taskResolver.resolve(projectId, externalId);
      const title = resolved.title;
      const body = input || resolved.body || '';

      const systemPrompt = `You are a senior software engineer performing GitHub issue triage. Analyze the issue and classify it.

## FINAL OUTPUT FORMAT
You MUST respond strictly with a JSON object matching this exact structure:
{
  "category": "<one of: bug, enhancement, question, documentation, other>",
  "confidence": <float between 0.0 and 1.0>,
  "reasoning": "<string explaining your classification>"
}`;
      const userPrompt = `Issue Title: "${title}"\n\nIssue Body:\n${body}`;

      const provider = this.providerRegistry.getActiveProvider();
      const model = this.providerRegistry.getActiveModel();

      const payload = {
        systemPrompt,
        userPrompt,
        contextFiles: [],
        responseFormat: {
          schema: TriageSchema,
          name: "triage"
        }
      };

      const response = await this.workerManager.dispatch<TriageResult>(payload, provider, model);
      const result = response.parsed;

      if (!result) {
        throw new Error("Triage failed: No parsed response from provider.");
      }

      return {
        success: true,
        taskId: '',
        message: `Triage complete: ${result.category} (${Math.round((result.confidence || 0) * 100)}% confidence)`,
        data: result as any
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
