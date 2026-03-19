import { z } from 'zod';

export type JsonValue = string | number | boolean | null | { [key: string]: JsonValue } | JsonValue[];

export interface FileContext {
  path: string;
  content: string;
}

export interface StructuredOutputConfig {
  schema: z.ZodType<any>;
  name: string;
}

export interface WorkerTool {
  type: string;
  function: {
    name?: string;
    description?: string;
    type?: string;
    parameters?: {
      type?: string;
      $defs?: Record<string, JsonValue>;
      items?: JsonValue;
      required?: string[];
      properties?: {
        [key: string]: {
          type?: string | string[];
          items?: JsonValue;
          description?: string;
          enum?: JsonValue[];
        };
      };
    };
  };
}

export interface ToolCall {
  id?: string;
  function: {
    name: string;
    arguments: Record<string, JsonValue>;
  };
}

export interface LlmMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string;
  tool_call_id?: string | undefined;
  tool_calls?: ToolCall[] | undefined;
}

export interface WorkerPayload {
  model: string;
  systemPrompt: string;
  userPrompt: string;
  messages?: LlmMessage[];
  contextFiles: FileContext[];
  expectedOutputSchema?: JsonValue; // JSON Schema (legacy)
  responseFormat?: StructuredOutputConfig; // New: Zod schema
  tools?: WorkerTool[] | undefined;
}

export interface WorkerResponse<T = any> {
  rawText?: string;
  parsed?: T; // New: Type-safe result from provider
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
