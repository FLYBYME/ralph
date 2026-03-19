import OpenAI from 'openai';
import { zodResponseFormat } from 'openai/helpers/zod';
import { ILlmProvider, WorkerPayload, WorkerResponse, ToolCall } from '../types.js';
import { colors, color, dim } from '../../../utils/colors.js';

/**
 * OpenAIProvider
 * Concrete implementation for OpenAI (or OpenAI-compatible) APIs.
 */
export class OpenAIProvider implements ILlmProvider {
  public providerId = 'openai';
  public maxContextTokens = 128000; // Default for gpt-4o

  private client: OpenAI;

  constructor(apiKey: string, baseURL?: string, instanceId: string = 'openai') {
    this.providerId = instanceId;
    this.client = new OpenAI({
      apiKey,
      baseURL: baseURL || 'https://api.openai.com/v1',
    });
  }

  /**
   * Ping the OpenAI API to verify connectivity.
   */
  public async ping(): Promise<boolean> {
    try {
      // A simple models list call to verify the API key and connection
      await this.client.models.list();
      return true;
    } catch (err) {
      console.error(`${color(`[${this.providerId}]`, colors.red)} Cannot reach API at ${this.client.baseURL}. (${String(err)})`);
      return false;
    }
  }

  public async generateResponse(payload: WorkerPayload, model?: string): Promise<WorkerResponse> {
    const startTime = Date.now();
    const targetModel = model || payload.model || 'gpt-4o';

    const messages: any[] = payload.messages?.map(m => {
      if (m.tool_calls) {
        return {
          ...m,
          tool_calls: m.tool_calls.map((tc: any) => ({
            ...tc,
            function: {
              ...tc.function,
              arguments: typeof tc.function.arguments === 'string'
                ? tc.function.arguments
                : JSON.stringify(tc.function.arguments)
            }
          }))
        };
      }
      return m;
    }) || [
      { role: 'system', content: payload.systemPrompt },
      { role: 'user', content: payload.userPrompt }
    ];

    if (!payload.messages && payload.contextFiles.length > 0 && messages[1]) {
      const contextStr = payload.contextFiles.map(f => `File: ${f.path}\nContent:\n${f.content}`).join('\n\n');
      messages[1].content += `\n\nContext Files:\n${contextStr}`;
    }

    try {
      const displayPrompt = payload.messages ? `[ReAct Turn ${Math.floor(payload.messages.length / 2)}]` : payload.userPrompt;
      console.log(`${color(`[${this.providerId}]`, colors.yellow)} Prompt (${targetModel}): ${dim(displayPrompt.slice(0, 500))}${displayPrompt.length > 500 ? '...' : ''}`);

      let response;
      let content = '';
      let parsed = undefined;
      let tool_calls: ToolCall[] | undefined = undefined;

      // RULE ENFORCEMENT: Only one or the other
      if (payload.responseFormat) {
          // STRUCTURED OUTPUT MODE (NO TOOLS)
          console.log(`${color(`[${this.providerId}]`, colors.magenta)} Executing Structured Output (Tools Stripped)`);
          const parseResponse = await this.client.chat.completions.parse({
              model: targetModel,
              messages,
              response_format: zodResponseFormat(payload.responseFormat.schema, payload.responseFormat.name),
              temperature: 0,
          });
          
          const choice = parseResponse.choices[0];
          content = choice?.message.content || '';
          parsed = choice?.message.parsed;
          response = parseResponse;
      } else {
          // STANDARD MODE (WITH TOOLS)
          const createResponse = await this.client.chat.completions.create({
              model: targetModel,
              messages,
              ...(payload.expectedOutputSchema ? { response_format: { type: 'json_object' } } : {}),
              tools: payload.tools?.map(t => ({
                  type: 'function',
                  function: {
                      name: t.function.name!,
                      description: t.function.description,
                      parameters: t.function.parameters as any
                  }
              })) as any,
              temperature: 0,
          });

          const choice = createResponse.choices[0];
          content = choice?.message.content || '';
          tool_calls = choice?.message.tool_calls?.map((tc: any) => ({
              id: tc.id,
              function: {
                  name: tc.function.name,
                  arguments: typeof tc.function.arguments === 'string' 
                    ? JSON.parse(tc.function.arguments) 
                    : tc.function.arguments
              }
          })) as ToolCall[] | undefined;
          response = createResponse;
      }

      console.log(`${color(`[${this.providerId}]`, colors.green)} Response: ${content.slice(0, 500)}${content.length > 500 ? '...' : ''}`);

      if (response.usage) {
        console.log(`${color(`[${this.providerId}]`, colors.magenta)} Usage: ${response.usage.prompt_tokens} prompt tokens, ${response.usage.completion_tokens} completion tokens`);
      }

      return {
        rawText: content,
        parsed,
        tool_calls,
        usage: {
          promptTokens: response.usage?.prompt_tokens ?? 0,
          completionTokens: response.usage?.completion_tokens ?? 0
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
    const targetModel = model || payload.model || 'gpt-4o';

    const messages: any[] = payload.messages?.map(m => {
      if (m.tool_calls) {
        return {
          ...m,
          tool_calls: m.tool_calls.map((tc: any) => ({
            ...tc,
            function: {
              ...tc.function,
              arguments: typeof tc.function.arguments === 'string'
                ? tc.function.arguments
                : JSON.stringify(tc.function.arguments)
            }
          }))
        };
      }
      return m;
    }) || [
      { role: 'system', content: payload.systemPrompt },
      { role: 'user', content: payload.userPrompt }
    ];

    if (!payload.messages && payload.contextFiles.length > 0 && messages[1]) {
      const contextStr = payload.contextFiles.map(f => `File: ${f.path}\nContent:\n${f.content}`).join('\n\n');
      messages[1].content += `\n\nContext Files:\n${contextStr}`;
    }

    const stream = await this.client.chat.completions.create({
      model: targetModel,
      messages,
      stream: true,
      tools: payload.tools?.map(t => ({
        type: 'function',
        function: {
          name: t.function.name!,
          description: t.function.description,
          parameters: t.function.parameters as any
        }
      })) as any,
      temperature: 0,
    });

    for await (const chunk of stream) {
      const choice = chunk.choices[0];
      if (choice?.delta.content || choice?.delta.tool_calls) {
        yield {
          rawText: choice.delta.content || '',
          tool_calls: choice.delta.tool_calls?.map((tc: any) => ({
            id: tc.id,
            function: {
              name: tc.function?.name || '',
              arguments: tc.function?.arguments // In stream, this is a string chunk. 
                                              // We pass it as-is (risky but compatible with raw yields)
                                              // unless we want to buffer it here.
            }
          })) as any[] | undefined,
          usage: {
            promptTokens: 0,
            completionTokens: 0
          },
          durationMs: Date.now() - startTime
        };
      }
    }
  }
}
