import { Ollama, ChatRequest, Message } from 'ollama';
import { ILlmProvider, WorkerPayload, WorkerResponse, ToolCall } from '../types.js';
import { colors, color, dim } from '../../../utils/colors.js';

/**
 * OllamaProvider
 * Concrete implementation for local Llama-3 (or others).
 */
export class OllamaProvider implements ILlmProvider {
  public providerId = 'ollama-local';
  public maxContextTokens = 8192; // Default for local models

  private client: Ollama;
  private readonly host: string;

  constructor(host: string = 'http://localhost:11434') {
    this.host = host;
    this.client = new Ollama({ host });
  }

  /**
   * Ping the Ollama server and verify the target model is available.
   */
  public async ping(model: string = 'llama3'): Promise<boolean> {
    try {
      const tags = await this.client.list();
      const modelNames = tags.models.map((m) => m.name);
      
      // Ollama model names may include a tag suffix (e.g., "llama3:latest")
      return modelNames.some(
        (n) => n === model || n.startsWith(`${model}:`)
      );
    } catch (err) {
      console.error(`${color('[ollama]', colors.red)} Cannot reach Ollama at ${this.host}. (${String(err)})`);
      return false;
    }
  }

  public async generateResponse(payload: WorkerPayload): Promise<WorkerResponse> {
    const startTime = Date.now();

    const messages: Message[] = payload.messages || [
      { role: 'system', content: payload.systemPrompt },
      { role: 'user', content: payload.userPrompt }
    ];

    if (!payload.messages && payload.contextFiles.length > 0 && messages[1]) {
      const contextStr = payload.contextFiles.map(f => `File: ${f.path}\nContent:\n${f.content}`).join('\n\n');
      messages[1].content += `\n\nContext Files:\n${contextStr}`;
    }

    try {
      const displayPrompt = payload.messages ? `[ReAct Turn ${Math.floor(payload.messages.length / 2)}]` : payload.userPrompt;
      console.log(`${color('[ollama]', colors.yellow)} Prompt (${payload.model}): ${dim(displayPrompt.slice(0, 500))}${displayPrompt.length > 500 ? '...' : ''}`);
      
      const request: ChatRequest & { stream: false } = {
        model: payload.model,
        messages,
        format: payload.expectedOutputSchema as string | object,
        options: {
          temperature: 0,
          num_ctx: this.maxContextTokens
        },
        stream: false
      };

      if (payload.tools) {
        request.tools = payload.tools;
      }

      const response = await this.client.chat(request);
      
      const content = response.message.content;
      console.log(`${color('[ollama]', colors.green)} Response: ${content.slice(0, 500)}${content.length > 500 ? '...' : ''}`);
      
      if (response.prompt_eval_count || response.eval_count) {
        console.log(`${color('[ollama]', colors.magenta)} Usage: ${response.prompt_eval_count ?? 0} prompt tokens, ${response.eval_count ?? 0} completion tokens`);
      }

      return {
        rawText: content,
        thinking: response.message.thinking,
        tool_calls: response.message.tool_calls as ToolCall[] | undefined,
        usage: {
          promptTokens: response.prompt_eval_count ?? 0,
          completionTokens: response.eval_count ?? 0
        },
        durationMs: Date.now() - startTime
      };

    } catch (error) {
      console.error(`${color('[ollama]', colors.red)} Chat failed: ${error}`);
      throw error;
    }
  }

  public async *streamResponse(payload: WorkerPayload): AsyncGenerator<WorkerResponse> {
    const startTime = Date.now();
    const messages: Message[] = [
      { role: 'system', content: payload.systemPrompt },
      { role: 'user', content: payload.userPrompt }
    ];

    if (payload.contextFiles.length > 0 && messages[1]) {
      const contextStr = payload.contextFiles.map(f => `File: ${f.path}\nContent:\n${f.content}`).join('\n\n');
      messages[1].content += `\n\nContext Files:\n${contextStr}`;
    }

    const request: ChatRequest & { stream: true } = {
      model: payload.model,
      messages,
      format: payload.expectedOutputSchema as string | object,
      stream: true
    };

    if (payload.tools) {
      request.tools = payload.tools;
    }

    const responseStream = await this.client.chat(request);

    for await (const chunk of responseStream) {
      yield {
        rawText: chunk.message.content,
        thinking: chunk.message.thinking,
        tool_calls: chunk.message.tool_calls as ToolCall[] | undefined,
        usage: {
          promptTokens: 0,
          completionTokens: 0
        },
        durationMs: Date.now() - startTime
      };
    }
  }
}
