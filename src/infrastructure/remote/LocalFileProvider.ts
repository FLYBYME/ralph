import { 
  IRemoteProvider, 
  RemoteIssue, 
  RemotePullRequest, 
  CheckRunStatus, 
  RepositoryMetadata, 
  RemoteComment 
} from './types.js';

/**
 * LocalFileProvider
 * A secondary local provider stub. 
 */
export class LocalFileProvider implements IRemoteProvider {
  public readonly providerId = 'local-file-stub';

  public async fetchRepository(owner: string, repo: string): Promise<RepositoryMetadata> {
    return {
      owner,
      name: repo,
      description: 'Stub Repo',
      defaultBranch: 'main',
      visibility: 'private',
      url: `local://${owner}/${repo}`
    };
  }

  public async getDefaultBranch(_owner: string, _repo: string): Promise<string> { return 'main'; }
  public async getFileContent(_owner: string, _repo: string, _path: string, _ref?: string): Promise<string | null> { return null; }
  public async searchCode(_owner: string, _repo: string, _query: string): Promise<string[]> { return []; }
  public async branchExists(_owner: string, _repo: string, _name: string): Promise<boolean> { return false; }
  public async deleteBranch(_owner: string, _repo: string, _name: string): Promise<void> {}
  public async cloneRepository(_owner: string, _repo: string, _url: string, _targetPath: string): Promise<void> {}

  public async fetchIssue(owner: string, repo: string, issueNumber: number): Promise<RemoteIssue> {
    return {
      number: issueNumber,
      title: 'Stub Issue',
      body: 'Stub Body',
      state: 'open',
      labels: [],
      assignees: [],
      url: `local://${owner}/${repo}/issues/${issueNumber}`,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };
  }

  public async listIssues(): Promise<RemoteIssue[]> { return []; }
  public async updateIssue(_owner: string, _repo: string, _issueNumber: number, _updates: any): Promise<void> {}
  public async addLabels(_owner: string, _repo: string, _issueNumber: number, _labels: string[]): Promise<void> {}
  public async removeLabels(_owner: string, _repo: string, _issueNumber: number, _labels: string[]): Promise<void> {}
  public async setAssignees(_owner: string, _repo: string, _issueNumber: number, _assignees: string[]): Promise<void> {}

  public async createPullRequest(): Promise<{ number: number; url: string }> {
    return { number: 1, url: 'local://pr/1' };
  }

  public async fetchPullRequest(_owner: string, _repo: string, prNumber: number): Promise<RemotePullRequest> {
    return {
      number: prNumber,
      title: 'Stub PR',
      body: '',
      state: 'open',
      url: 'local://pr/1',
      labels: [],
      assignees: [],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      headRef: 'feat',
      baseRef: 'main',
      merged: false,
      draft: false
    };
  }

  public async getDiff(_owner: string, _repo: string, _ref: string | number): Promise<string> { return ''; }
  public async getModifiedFiles(_owner: string, _repo: string, _ref: string | number): Promise<string[]> { return []; }
  public async submitReview(): Promise<void> {}
  public async mergePullRequest(): Promise<void> {}

  public async fetchComments(_owner: string, _repo: string, _id: number): Promise<RemoteComment[]> { return []; }
  public async postComment(_owner: string, _repo: string, _id: number | string, body: string): Promise<RemoteComment> {
    return { id: 1, author: 'stub', body, createdAt: new Date().toISOString() };
  }
  public async updateComment(_owner: string, _repo: string, _commentId: string | number, _body: string): Promise<void> {}
  public async deleteComment(_owner: string, _repo: string, _commentId: string | number): Promise<void> {}

  public async getLatestCheckRuns(_owner: string, _repo: string, _ref: string): Promise<CheckRunStatus[]> { return []; }
  public async getWorkflowLogs(_owner: string, _repo: string, _runId: number): Promise<string> { return ''; }
  public async triggerWorkflow(_owner: string, _repo: string, _workflowId: string | number, _ref: string): Promise<void> {}
}
