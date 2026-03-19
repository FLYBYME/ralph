import { ToolCall } from '../llm/types.js';

export type EventType = 'FSM_TRANSITION' | 'WORKER_STREAM' | 'HUMAN_INTERVENTION_REQUIRED' | 'SPECIALIST_START' | 'SPECIALIST_COMPLETE' | 'SPECIALIST_LOG' | 'TOOL_CALL' | 'SYSTEM_LOG' | 'KNOWLEDGE_PUBLISHED' | 'CHAT_MESSAGE_APPENDED';

export interface BaseEvent {
  type: EventType;
  taskId: string;
  timestamp: string;
}

export interface ToolCallEvent extends BaseEvent {
  type: 'TOOL_CALL';
  toolName: string;
  args: any;
  result: {
    success: boolean;
    output: string;
  };
}

export interface FsmTransitionEvent extends BaseEvent {
  type: 'FSM_TRANSITION';
  oldState: string;
  newState: string;
}

export interface WorkerStreamEvent extends BaseEvent {
  type: 'WORKER_STREAM';
  chunk: string; // The raw stdout buffer chunk
  thinking?: string | undefined;
  tool_calls?: ToolCall[] | undefined;
}

export interface HumanInterventionRequiredEvent extends BaseEvent {
  type: 'HUMAN_INTERVENTION_REQUIRED';
  threadSummary?: string;
}

export interface SpecialistStartEvent extends BaseEvent {
  type: 'SPECIALIST_START';
  specialist: string;
  activity: string;
}

export interface SpecialistCompleteEvent extends BaseEvent {
  type: 'SPECIALIST_COMPLETE';
  specialist: string;
  durationMs: number;
}

export interface SpecialistLogEvent extends BaseEvent {
  type: 'SPECIALIST_LOG';
  specialist: string;
  stream: 'stdout' | 'stderr';
  text: string;
}

export interface SystemLogEvent extends BaseEvent {
  type: 'SYSTEM_LOG';
  level: 'info' | 'warn' | 'error' | 'debug';
  module: string;
  message: string;
}

export interface KnowledgePublishedEvent extends BaseEvent {
  type: 'KNOWLEDGE_PUBLISHED';
  entryId: string;
}

export interface ChatMessageAppendedEvent extends BaseEvent {
  type: 'CHAT_MESSAGE_APPENDED';
  sessionId: string;
  author: 'HUMAN' | 'RALPH' | 'SYSTEM';
}

export type SystemEvent = 
  | FsmTransitionEvent 
  | WorkerStreamEvent 
  | HumanInterventionRequiredEvent 
  | SpecialistStartEvent 
  | SpecialistCompleteEvent 
  | SpecialistLogEvent 
  | ToolCallEvent 
  | SystemLogEvent
  | KnowledgePublishedEvent
  | ChatMessageAppendedEvent;

export type EventHandler<T extends SystemEvent = SystemEvent> = (event: T) => void;
