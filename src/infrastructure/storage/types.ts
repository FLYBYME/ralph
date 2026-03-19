export type TaskStatus = 'OPEN' | 'IN_PROGRESS' | 'PAUSED' | 'COMPLETED' | 'FAILED' | 'AWAITING_REVIEW';

export type MessageIntent = 'COMMAND' | 'FEEDBACK' | 'APPROVAL' | 'STATUS_UPDATE' | 'ERROR' | 'CHAT' | 'AUDIT';

export enum FsmStep {
  INVESTIGATE = 'INVESTIGATE',
  PLAN = 'PLAN',
  WRITE_TESTS = 'WRITE_TESTS',
  VERIFY_FAIL = 'VERIFY_FAIL',
  EXECUTE = 'EXECUTE',
  VERIFY = 'VERIFY',
  SELF_REVIEW = 'SELF_REVIEW',
  AWAITING_REVIEW = 'AWAITING_REVIEW',
  FINALIZE = 'FINALIZE'
}

export type JsonValue = string | number | boolean | null | { [key: string]: JsonValue } | JsonValue[];

export interface InvestigationContext {
  discoveredFiles: string[];
  searchQueriesRun: string[];
  architecturalSummary: string;
  notes?: string;
}

export interface ActionableStep {
  id: string;
  description: string;
}

export interface SubTask {
  id: string;
  worker: string;
  instructions: string;
  targetFiles: string[];
  dependsOn: string[];
  status?: 'OPEN' | 'IN_PROGRESS' | 'COMPLETED' | 'FAILED';
  result?: string;
}

export interface PlanningContext {
  rootCauseAnalysis: string;
  subTasks: SubTask[];
  proposedSteps: ActionableStep[];
  targetFiles: string[];
  requiredTools: string[];
  planSummary?: string;
}

export interface ExecutionContext {
  activeWorkerId: string;
  attemptCount: number;
  lastErrorLog: string | null;
  geminiPrompt?: string;
  selectedWorker?: 'gemini' | 'copilot' | 'opencode';
  specialistOutput?: string;
  consecutiveErrors?: number;
}

export interface VerificationContext {
  commandsRun: string[];
  testOutput: string;
  lintPassed: boolean;
}

export interface ReviewContext {
  selfReviewNotes: string;
  proposedCommitMessage: string;
  diffSummary: string;
}

export interface ContextStackItem {
  ref: string;
  summary: string;
}

export interface StateContext {
  currentStep: FsmStep;
  investigation: InvestigationContext;
  planning: PlanningContext;
  execution: ExecutionContext;
  verification: VerificationContext;
  review: ReviewContext;
  contextStack?: ContextStackItem[];
}

export interface WorkspaceState {
  [key: string]: JsonValue;
}

export interface ProjectRecord {
  [key: string]: string | boolean | string[] | undefined;
  id: string;
  name: string;
  absolutePath: string; // The path on disk (either local or inside workspaces)
  sourceUrl?: string | undefined; // Optional: Git URL if cloned
  isLocalOnly: boolean; // True if just mapped to a local directory, false if cloned
  ciCommands: string[]; // List of commands to run in the Docker container during VERIFY
  defaultBranch: string;
  ignoredPaths: string[];
  lastScannedAt: string;
  isEval?: boolean;
}

export interface TaskSummary {
  [key: string]: string | boolean | string[] | undefined;
  id: string;
  projectId: string;
  status: TaskStatus;
  title: string;
  urgent: boolean;
  useTDD: boolean;
  humanInputReceived: boolean;
  resumeAfter?: string | undefined; // ISO timestamp
  labels: string[];
  assignees: string[];
  milestone?: string | undefined;
  isEval?: boolean;
}

export interface ProviderConfig {
  id: string; // unique name for this instance
  providerId: 'ollama-local' | 'openai' | 'anthropic';
  apiKey?: string;
  baseURL?: string;
  model: string;
}

export interface AppSettings {
  agentMention: string;
  ollamaHost: string;
  ollamaModel: string;
  serverPort: number;
  workerGeminiEnabled: boolean;
  workerGeminiModel: string;
  workerCopilotEnabled: boolean;
  workerCopilotModel: string;
  workerOpencodeEnabled: boolean;
  workerOpencodeModel: string;
  maxBacklog: number;
  maxIterations: number;
  maxReActTurns: number;
  providers: ProviderConfig[];
  activeProviderId: string;
  quotaLocks?: QuotaLock[];
  janitorEnabled: boolean;
  janitorIntervalHours: number;
  janitorCooldownHours: number;
  tddModeEnabled: boolean;
  llmTimeoutMs: number;
  specialistTimeoutMs: number;
}

export interface QuotaLock {
  specialist: 'gemini' | 'copilot' | 'opencode';
  reason: string;
  disabledUntil: string; // ISO timestamp
}

export interface LocalLedger {
  schemaVersion: number;
  projects: ProjectRecord[];
  tasks: TaskSummary[];
  settings: AppSettings;
  lastJanitorRun?: string;
}

export interface TaskObjective {
  title: string;
  originalPrompt: string;
  successCriteria: string[];
  useTDD: boolean;
}

export interface ChatMessage {
  id: string;
  author: 'HUMAN' | 'RALPH' | 'SYSTEM';
  intent: MessageIntent;
  body: string;
  timestamp: string;
}

export interface TaskThread {
  messages: ChatMessage[];
}

export interface ChatSession {
  id: string;
  projectId: string;
  messages: ChatMessage[];
  createdAt: string;
  updatedAt: string;
}
export type KnowledgeCategory = 'Runbook' | 'Architecture' | 'Policy' | 'Tutorial';

export interface KnowledgeEntry {
  id: string; // e.g., kb-arch-1234
  title: string;
  category: KnowledgeCategory;
  tags: string[];
  lastUpdated: string; // ISO timestamp
  contentBlocks: string[]; // Discrete paragraphs or bullet points
  relatedEntries: string[]; // Array of IDs
}

export interface FsmTimelineEvent {
  step: FsmStep;
  status: 'SUCCESS' | 'FAILED' | 'YIELD' | 'FATAL';
  details: string;
  timestamp: string;
}

export interface ToolCallEvent {
  toolName: string;
  args: any;
  result: { success: boolean; output: string };
  timestamp: string;
}

export interface TaskRecord {
  id: string;
  projectId: string;
  status: TaskStatus;
  objective: TaskObjective;
  context: StateContext;
  thread: TaskThread;
  workspace: WorkspaceState;
  createdAt: string;
  updatedAt: string;
  labels: string[];
  assignees: string[];
  milestone?: string | undefined;
  isEval?: boolean;
  timeline?: FsmTimelineEvent[];
  toolCalls?: ToolCallEvent[];
  postMortem?: string;
}

export interface AuditLogEntry {
  timestamp: string;
  transitionFrom: string;
  transitionTo: string;
  triggerEvent: string;
  reasoning: string;
}

export type EvalStatus = 'PENDING' | 'RUNNING' | 'PASSED' | 'FAILED' | 'ERROR';

export interface EvalResult {
  id: string;
  scenarioId: string;
  taskId: string;
  status: EvalStatus;
  startTime: string;
  endTime?: string;
  score?: number; // 0-100
  feedback?: string;
  fsmSteps: string[]; // Path followed
  judgeModel?: string;
}
