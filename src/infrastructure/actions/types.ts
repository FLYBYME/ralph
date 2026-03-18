export interface ActionParams {
  projectId: string;
  externalId?: string; // e.g. GitHub issue number
  input?: string;      // The raw request or objective
  urgent?: boolean;
  labels?: string[];
  assignees?: string[];
  milestone?: string;
}

export interface ActionResult {
  success: boolean;
  taskId: string;
  message: string;
  data?: any;
}

/**
 * IAction
 * Contract for top-level entry points (Solve, Triage, Review, etc.)
 */
export interface IAction {
  readonly actionId: string;
  execute(params: ActionParams): Promise<ActionResult>;
}
