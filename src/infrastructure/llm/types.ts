export interface FileContext {
  path: string;
  content: string;
}

export interface WorkerTool {
  type: string;
  function: {
    name?: string;
    description?: string;
    type?: string;
    parameters?: {
      type?: string;
      $defs?: Record<string, unknown>;
      items?: unknown;
      required?: string[];
      properties?: {
        [key: string]: {
          type?: string | string[];
          items?: unknown;
          description?: string;
          enum?: unknown[];
        };
      };
    };
  };
}

export interface ToolCall {
  id?: string;
  function: {
    name: string;
    arguments: Record<string, unknown>;
  };
}


export interface WorkerPayload {
  model: string;
  systemPrompt: string;
  userPrompt: string;
  messages?: any[];
  contextFiles: FileContext[];
  expectedOutputSchema?: unknown; // JSON Schema or Zod
  tools?: WorkerTool[] | undefined;
}

export interface WorkerResponse {
  rawText?: string;
  thinking?: string | undefined;
  tool_calls?: ToolCall[] | undefined;
  usage: {
    promptTokens: number;
    completionTokens: number;
  };
  durationMs: number;
}

export interface ILlmProvider {
  readonly providerId: string;
  readonly maxContextTokens: number;
  generateResponse(payload: WorkerPayload, model?: string): Promise<WorkerResponse>;
  streamResponse?(payload: WorkerPayload, model?: string): AsyncGenerator<WorkerResponse>;
  ping(): Promise<boolean>;
}
