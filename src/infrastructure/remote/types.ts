
export interface RemoteIssue {
  number: number;
  title: string;
  body: string | null;
  state: 'open' | 'closed';
  labels: string[];
  assignees: string[];
  url: string;
  createdAt: string;
  updatedAt: string;
  milestone?: string | undefined;
}

export interface RemotePullRequest extends RemoteIssue {
  headRef: string;
  baseRef: string;
  merged: boolean;
  mergeableState?: string;
  draft: boolean;
}

export interface RemoteComment {
  id: string | number;
  author: string;
  body: string;
  createdAt: string;
  url?: string;
}

export interface RepositoryMetadata {
  owner: string;
  name: string;
  description: string | null;
  defaultBranch: string;
  visibility: 'public' | 'private' | 'internal';
  url: string;
}

export interface CheckRunStatus {
  name: string;
  status: 'queued' | 'in_progress' | 'completed';
  conclusion: 'success' | 'failure' | 'neutral' | 'cancelled' | 'timed_out' | 'action_required' | null;
  run_id: number;
}

export interface PullRequestReview {
  event: 'APPROVE' | 'REQUEST_CHANGES' | 'COMMENT';
  body: string;
  comments?: Array<{
    path: string;
    position?: number;
    body: string;
    line?: number;
  }>;
}

/**
 * IRemoteProvider
 * Abstract interface for repository host operations (GitHub, GitLab, Ledger).
 * Provides a unified contract for the FSM and Actions to interact with issues and code.
 */
export interface IRemoteProvider {
  readonly providerId: string;

  // ─── Repository & Metadata ───────────────────────────────────────────────
  fetchRepository(owner: string, repo: string): Promise<RepositoryMetadata>;
  getDefaultBranch(owner: string, repo: string): Promise<string>;
  getFileContent(owner: string, repo: string, path: string, ref?: string): Promise<string | null>;
  searchCode(owner: string, repo: string, query: string): Promise<string[]>;
  branchExists(owner: string, repo: string, name: string): Promise<boolean>;
  deleteBranch(owner: string, repo: string, name: string): Promise<void>;
  cloneRepository(owner: string, repo: string, url: string, targetPath: string): Promise<void>;

  // ─── Issue Management ────────────────────────────────────────────────────
  fetchIssue(owner: string, repo: string, issueNumber: number): Promise<RemoteIssue>;
  listIssues(owner: string, repo: string, filters?: { state?: 'open' | 'closed'; labels?: string[] }): Promise<RemoteIssue[]>;
  updateIssue(owner: string, repo: string, issueNumber: number, updates: Partial<Pick<RemoteIssue, 'title' | 'body' | 'state'>>): Promise<void>;
  addLabels(owner: string, repo: string, issueNumber: number, labels: string[]): Promise<void>;
  removeLabels(owner: string, repo: string, issueNumber: number, labels: string[]): Promise<void>;
  setAssignees(owner: string, repo: string, issueNumber: number, assignees: string[]): Promise<void>;

  // ─── Pull Request Lifecycle ──────────────────────────────────────────────
  createPullRequest(owner: string, repo: string, head: string, base: string, title: string, body: string): Promise<{ number: number; url: string }>;
  fetchPullRequest(owner: string, repo: string, prNumber: number): Promise<RemotePullRequest>;
  getDiff(owner: string, repo: string, prNumber: number): Promise<string>;
  getModifiedFiles(owner: string, repo: string, prNumber: number): Promise<string[]>;
  submitReview(owner: string, repo: string, prNumber: number, review: PullRequestReview): Promise<void>;
  mergePullRequest(owner: string, repo: string, prNumber: number, method?: 'merge' | 'squash' | 'rebase'): Promise<void>;

  // ─── Conversations ───────────────────────────────────────────────────────
  fetchComments(owner: string, repo: string, id: number): Promise<RemoteComment[]>;
  postComment(owner: string, repo: string, id: number | string, body: string): Promise<RemoteComment>;
  updateComment(owner: string, repo: string, commentId: string | number, body: string): Promise<void>;
  deleteComment(owner: string, repo: string, commentId: string | number): Promise<void>;

  // ─── CI/CD & Workflows ───────────────────────────────────────────────────
  getLatestCheckRuns(owner: string, repo: string, ref: string): Promise<CheckRunStatus[]>;
  getWorkflowLogs(owner: string, repo: string, runId: number): Promise<string>;
  triggerWorkflow(owner: string, repo: string, workflowId: string | number, ref: string, inputs?: Record<string, string>): Promise<void>;
}
