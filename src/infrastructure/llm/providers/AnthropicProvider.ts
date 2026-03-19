import Anthropic from '@anthropic-ai/sdk';
import { ILlmProvider, WorkerPayload, WorkerResponse, ToolCall } from '../types.js';
import { colors, color, dim } from '../../../utils/colors.js';

/**
 * AnthropicProvider
 * Concrete implementation for the Anthropic API (Claude).
 */
export class AnthropicProvider implements ILlmProvider {
  public providerId: string;
  public maxContextTokens = 200000; // Default for Claude 3

  private client: Anthropic;

  constructor(instanceId: string, apiKey: string, baseURL?: string) {
    this.providerId = instanceId;
    this.client = new Anthropic({
      apiKey,
      baseURL: baseURL || 'https://api.anthropic.com/v1',
    });
  }

  /**
   * Ping the Anthropic API to verify connectivity.
   */
  public async ping(): Promise<boolean> {
    try {
      // Just a simple request to check connectivity
      await this.client.messages.create({
        model: 'claude-3-haiku-20240307',
        max_tokens: 1,
        messages: [{ role: 'user', content: 'ping' }],
      });
      return true;
    } catch (err) {
      console.error(`${color(`[${this.providerId}]`, colors.red)} Cannot reach API. (${String(err)})`);
      return false;
    }
  }

  public async generateResponse(payload: WorkerPayload, model?: string): Promise<WorkerResponse> {
    const startTime = Date.now();
    const targetModel = model || payload.model || 'claude-3-5-sonnet-20240620';

    const messages: any[] = payload.messages || [
      { role: 'user', content: payload.userPrompt }
    ];

    if (!payload.messages && payload.contextFiles.length > 0) {
      const contextStr = payload.contextFiles.map(f => `File: ${f.path}\nContent:\n${f.content}`).join('\n\n');
      messages[0].content += `\n\nContext Files:\n${contextStr}`;
    }

    try {
      const displayPrompt = payload.messages ? `[ReAct Turn ${Math.floor(payload.messages.length / 2)}]` : payload.userPrompt;
      console.log(`${color(`[${this.providerId}]`, colors.yellow)} Prompt (${targetModel}): ${dim(displayPrompt.slice(0, 500))}${displayPrompt.length > 500 ? '...' : ''}`);

      const response = await this.client.messages.create({
        model: targetModel,
        system: payload.systemPrompt,
        messages,
        max_tokens: 4096,
        tools: payload.tools?.map(t => ({
          name: t.function.name!,
          description: t.function.description!,
          input_schema: t.function.parameters as any
        })) as any,
        temperature: 0,
      });

      const content = response.content.filter(c => c.type === 'text').map(c => (c as any).text).join('\n');
      const tool_calls = response.content
        .filter(c => c.type === 'tool_use')
        .map((c: any) => ({
          function: {
            name: c.name,
            arguments: c.input
          }
        })) as ToolCall[];

      console.log(`${color(`[${this.providerId}]`, colors.green)} Response: ${content.slice(0, 500)}${content.length > 500 ? '...' : ''}`);

      let parsed = undefined;
      if (payload.responseFormat) {
        try {
          const clean = content.replace(/```json\n|```/g, '').trim();
          const json = JSON.parse(clean);
          parsed = payload.responseFormat.schema.parse(json);
        } catch (e) {
          console.error(`${color(`[${this.providerId}]`, colors.red)} Schema validation failed: ${e}`);
          throw new Error(`Structured output validation failed: ${e instanceof Error ? e.message : String(e)}`);
        }
      }

      if (response.usage) {
        console.log(`${color(`[${this.providerId}]`, colors.magenta)} Usage: ${response.usage.input_tokens} input tokens, ${response.usage.output_tokens} output tokens`);
      }

      return {
        rawText: content,
        parsed,
        tool_calls: tool_calls.length > 0 ? tool_calls : undefined,
        usage: {
          promptTokens: response.usage.input_tokens,
          completionTokens: response.usage.output_tokens
        },
        durationMs: Date.now() - startTime
      };

    } catch (error) {
      console.error(`${color(`[${this.providerId}]`, colors.red)} Chat failed: ${error}`);
      throw error;
    }
  }

  public async *streamResponse(payload: WorkerPayload, model?: string): AsyncGenerator<WorkerResponse> {
    const startTime = Date.now();
    const targetModel = model || payload.model || 'claude-3-5-sonnet-20240620';

    const messages: any[] = payload.messages || [
      { role: 'user', content: payload.userPrompt }
    ];

    if (!payload.messages && payload.contextFiles.length > 0) {
      const contextStr = payload.contextFiles.map(f => `File: ${f.path}\nContent:\n${f.content}`).join('\n\n');
      messages[0].content += `\n\nContext Files:\n${contextStr}`;
    }

    const stream = await this.client.messages.stream({
      model: targetModel,
      system: payload.systemPrompt,
      messages,
      max_tokens: 4096,
      tools: payload.tools?.map(t => ({
          name: t.function.name!,
          description: t.function.description!,
          input_schema: t.function.parameters as any
      })) as any,
      temperature: 0,
    });

    for await (const event of stream) {
        if (event.type === 'content_block_delta' && event.delta.type === 'text_delta') {
            yield {
                rawText: event.delta.text,
                usage: { promptTokens: 0, completionTokens: 0 },
                durationMs: Date.now() - startTime
            };
        }
    }
  }
}
