import { ILlmProvider, WorkerPayload, WorkerResponse, LlmMessage } from './types.js';
import { LocalEventBus } from '../bus/LocalEventBus.js';
import { ToolRegistry, toToolParams, PlanProposedError, InvestigationConcludedError, ProposedPlan } from './ToolRegistry.js';
import { colors, color } from '../../utils/colors.js';

export class TimeoutError extends Error {
  constructor(message: string) {
    super(`[TimeoutError] ${message}`);
  }
}

export interface ReActResult {
    finalAnswer: string;
    iterations: number;
    status: 'complete' | 'pending_approval' | 'concluded';
    proposedPlan?: ProposedPlan;
}

/**
 * WorkerManager
 * Responsibility: Coordinating LLM calls, enforcing timeouts, and managing concurrency.
 */
export class WorkerManager {
  private activeProcesses: Set<AbortController> = new Set();

  constructor(private readonly eventBus: LocalEventBus) {}

  public getActiveProcessesCount(): number {
    return this.activeProcesses.size;
  }

  /**
   * Dispatches a single turn request to an LLM provider.
   */
  public async dispatch(
    payload: Omit<WorkerPayload, 'model'>, 
    provider: ILlmProvider,
    model: string,
    timeoutMs: number = 60000
  ): Promise<WorkerResponse> {
    const controller = new AbortController();
    this.activeProcesses.add(controller);

    const timeout = setTimeout(() => {
      controller.abort();
    }, timeoutMs);

    try {
      const response = await provider.generateResponse({ ...payload, model });
      return response;
    } catch (error: any) {
      if (error.name === 'AbortError') {
        throw new TimeoutError(`LLM request timed out after ${timeoutMs}ms`);
      }
      throw error;
    } finally {
      clearTimeout(timeout);
      this.activeProcesses.delete(controller);
    }
  }

  /**
   * Run a multi-turn ReAct loop using NATIVE Ollama tool calling.
   */
  public async reactDispatch(
    options: {
        model: string;
        systemPrompt: string;
        initialPrompt: string;
        provider: ILlmProvider;
        tools: ToolRegistry;
        maxIterations?: number;
        taskId: string;
        history?: LlmMessage[];
    }
  ): Promise<ReActResult> {
    const { model, systemPrompt, initialPrompt, provider, tools, maxIterations = 10, taskId, history = [] } = options;
    const ollamaTools = [...tools.values()].map(t => t.ollamaTool);

    let messages: LlmMessage[] = [
      { role: 'system', content: systemPrompt },
      ...history,
      { role: 'user', content: initialPrompt },
    ];

    let iterations = 0;

    while (iterations < maxIterations) {
      iterations++;

      const lastMsg = messages[messages.length - 1];
      const payload: WorkerPayload = {
          model,
          systemPrompt,
          userPrompt: lastMsg ? lastMsg.content : initialPrompt,
          messages: messages, // Send full history
          contextFiles: [],
          tools: ollamaTools as any // Cast for provider compatibility
      };

      const response = await provider.generateResponse(payload);

      const assistantMsg: LlmMessage = { 
          role: 'assistant', 
          content: response.rawText || '', 
          tool_calls: response.tool_calls
      };

      console.log(`${color('[ollama:thought]', colors.cyan)} ${assistantMsg.content || '(tool call)'}`);
      messages.push(assistantMsg);

      const toolCalls = response.tool_calls;

      if (!toolCalls || toolCalls.length === 0) {
        return { 
            finalAnswer: assistantMsg.content, 
            iterations, 
            status: 'complete' 
        };
      }

      for (const toolCall of toolCalls) {
        const toolName = toolCall.function.name;
        const params = toToolParams(toolCall.function.arguments);

        console.log(`${color('[ollama:tool]', colors.yellow)} Calling ${toolName}(${JSON.stringify(params)})`);

        const tool = tools.get(toolName);
        if (!tool) {
          const errMsg = `Unknown tool "${toolName}".`;
          messages.push({ role: 'tool', tool_call_id: toolCall.id, content: errMsg });
          continue;
        }

        try {
          const result = await tool.execute(params);
          
          this.eventBus.publish({
            type: 'TOOL_CALL',
            taskId,
            timestamp: new Date().toISOString(),
            toolName,
            args: params,
            result: {
              success: result.success,
              output: result.output
            }
          });

          messages.push({ role: 'tool', tool_call_id: toolCall.id, content: result.output });
        } catch (err) {
          if (err instanceof PlanProposedError) {
            return {
              finalAnswer: `Plan proposed: ${err.plan.title}`,
              iterations,
              status: 'pending_approval',
              proposedPlan: err.plan
            };
          }
          if (err instanceof InvestigationConcludedError) {
            return {
              finalAnswer: err.report,
              iterations,
              status: 'concluded'
            };
          }
          messages.push({ role: 'tool', content: `Error: ${err instanceof Error ? err.message : String(err)}` });
        }
      }
    }

    return {
      finalAnswer: "Max iterations reached",
      iterations,
      status: 'complete'
    };
  }

  /**
   * Streams output chunks and broadcasts them via the LocalEventBus.
   */
  public async *streamDispatch(
    payload: Omit<WorkerPayload, 'model'>, 
    provider: ILlmProvider, 
    taskId: string,
    model: string
  ): AsyncGenerator<WorkerResponse> {
    if (!provider.streamResponse) {
        // Fallback to standard dispatch if provider doesn't support streaming
        const response = await this.dispatch(payload, provider, model);
        yield response;
        return;
    }

    try {
        for await (const response of provider.streamResponse({ ...payload, model })) {
            // Broadcast chunk via bus so UI can update in real-time
            this.eventBus.publish({
                type: 'WORKER_STREAM',
                taskId,
                timestamp: new Date().toISOString(),
                chunk: response.rawText || '',
                thinking: response.thinking,
                tool_calls: response.tool_calls
            });
            yield response;
        }
    } catch (error) {
        console.error(`[WorkerManager] Streaming failed for task ${taskId}:`, error);
        throw error;
    }
  }

  /**
   * Safely kills all orphaned child processes.
   */
  public async killAllProcesses(): Promise<void> {
    console.log(`[WorkerManager] Killing ${this.activeProcesses.size} active AbortControllers.`);
    for (const controller of this.activeProcesses) {
        controller.abort();
    }
    this.activeProcesses.clear();
  }
}
