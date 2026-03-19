import { ILlmProvider, WorkerPayload, WorkerResponse, LlmMessage, StructuredOutputConfig } from './types.js';
import { LocalEventBus } from '../bus/LocalEventBus.js';
import { ToolRegistry, toToolParams, PlanProposedError, InvestigationConcludedError, ProposedPlan } from './ToolRegistry.js';
import { colors, color } from '../../utils/colors.js';
import { LedgerStorageEngine } from '../storage/LedgerStorageEngine.js';

export class TimeoutError extends Error {
  constructor(message: string) {
    super(`[TimeoutError] ${message}`);
  }
}

export interface ReActResult<T = any> {
    finalAnswer: string;
    iterations: number;
    status: 'complete' | 'pending_approval' | 'concluded';
    proposedPlan?: ProposedPlan | undefined;
    parsed?: T | undefined;
}

/**
 * WorkerManager
 * Responsibility: Coordinating LLM calls, enforcing timeouts, and managing concurrency.
 */
export class WorkerManager {
  private activeProcesses: Set<AbortController> = new Set();

  constructor(
    private readonly eventBus: LocalEventBus,
    private readonly storageEngine: LedgerStorageEngine
  ) {}

  public getActiveProcessesCount(): number {
    return this.activeProcesses.size;
  }

  /**
   * Dispatches a single turn request to an LLM provider.
   */
  public async dispatch<T = any>(
    payload: Omit<WorkerPayload, 'model'>, 
    provider: ILlmProvider,
    model: string,
    timeoutMs?: number
  ): Promise<WorkerResponse<T>> {
    const controller = new AbortController();
    this.activeProcesses.add(controller);

    // Ensure tools and responseFormat are NOT mixed
    if (payload.responseFormat && payload.tools && payload.tools.length > 0) {
        console.warn(`${color('[WorkerManager]', colors.yellow)} Stripping tools from payload because responseFormat is requested.`);
        delete payload.tools;
    }

    const settings = await this.storageEngine.getSettings();
    const effectiveTimeoutMs = timeoutMs ?? settings.llmTimeoutMs ?? 60000;

    const timeout = setTimeout(() => {
      controller.abort();
    }, effectiveTimeoutMs);

    try {
      const response = await provider.generateResponse({ ...payload, model });
      return response as WorkerResponse<T>;
    } catch (error: any) {
      if (error.name === 'AbortError') {
        throw new TimeoutError(`LLM request timed out after ${effectiveTimeoutMs}ms`);
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
  public async reactDispatch<T = any>(
    options: {
        model: string;
        systemPrompt: string;
        initialPrompt: string;
        provider: ILlmProvider;
        tools: ToolRegistry;
        maxIterations?: number;
        taskId: string;
        history?: LlmMessage[];
        responseFormat?: StructuredOutputConfig; // <--- The two-step trigger
    }
  ): Promise<ReActResult<T>> {
    const settings = await this.storageEngine.getSettings();
    const { model, systemPrompt, initialPrompt, provider, tools, maxIterations = settings.maxReActTurns || 20, taskId, history = [], responseFormat } = options;
    const ollamaTools = [...tools.values()].map(t => t.ollamaTool);

    let messages: LlmMessage[] = [
      { role: 'system', content: systemPrompt },
      ...history,
      { role: 'user', content: initialPrompt },
    ];

    let iterations = 0;
    let finalStatus: ReActResult['status'] = 'complete';
    let rawAnswer = "Max iterations reached";
    let plan: ProposedPlan | undefined;

    // --- STEP 1: Execute The ReAct Loop (WITH TOOLS) ---
    while (iterations < maxIterations) {
      iterations++;

      const lastMsg = messages[messages.length - 1];
      const payload: Omit<WorkerPayload, 'model'> = {
          systemPrompt,
          userPrompt: lastMsg ? lastMsg.content : initialPrompt,
          messages: messages, // Send full history
          contextFiles: [],
          tools: ollamaTools as any // Cast for provider compatibility
      };

      const response = await this.dispatch(payload, provider, model);

      const assistantMsg: LlmMessage = { 
          role: 'assistant', 
          content: response.rawText || '', 
          tool_calls: response.tool_calls
      };

      console.log(`${color('[ollama:thought]', colors.cyan)} ${assistantMsg.content || '(tool call)'}`);
      messages.push(assistantMsg);

      const toolCalls = response.tool_calls;

      if (!toolCalls || toolCalls.length === 0) {
        rawAnswer = assistantMsg.content;
        finalStatus = 'complete';
        break;
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
            plan = err.plan;
            finalStatus = 'pending_approval';
            rawAnswer = `Plan proposed: ${err.plan.title}`;
            break;
          }
          if (err instanceof InvestigationConcludedError) {
            rawAnswer = err.report;
            finalStatus = 'concluded';
            break;
          }
          messages.push({ role: 'tool', content: `Error: ${err instanceof Error ? err.message : String(err)}` });
        }
      }
      if (finalStatus !== 'complete') break;
    }

    // --- STEP 2: The Final Structured Prompt (NO TOOLS) ---
    if (responseFormat) {
        console.log(`${color('[WorkerManager]', colors.magenta)} Transitioning to Structured Output format phase.`);
        
        // Send the entire reasoning history, but explicitly strip tools and enforce the Zod format
        const formattingPayload: Omit<WorkerPayload, 'model'> = {
            systemPrompt: "You are a formatting agent. Extract the final conclusions and format them perfectly according to the JSON schema provided.",
            userPrompt: "Based on the previous interactions, provide the final structured output.",
            messages: [...messages], // All tool-use history
            contextFiles: [],
            responseFormat: responseFormat // <-- Zod schema enforcement
        };

        const finalResponse = await this.dispatch<T>(formattingPayload, provider, model);
        
        return {
            finalAnswer: finalResponse.rawText || "Structured object returned",
            parsed: finalResponse.parsed,
            iterations,
            status: finalStatus,
            proposedPlan: plan
        };
    }

    // If no structured output was required, return standard string response
    return { finalAnswer: rawAnswer, iterations, status: finalStatus, proposedPlan: plan };
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
