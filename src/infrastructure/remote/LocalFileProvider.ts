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

  public async getDefaultBranch(): Promise<string> { return 'main'; }
  public async getFileContent(): Promise<string | null> { return null; }
  public async searchCode(): Promise<string[]> { return []; }
  public async branchExists(): Promise<boolean> { return false; }
  public async deleteBranch(): Promise<void> {}
  public async cloneRepository(): Promise<void> {}

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
  public async updateIssue(): Promise<void> {}
  public async addLabels(): Promise<void> {}
  public async removeLabels(): Promise<void> {}
  public async setAssignees(): Promise<void> {}

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

  public async getDiff(): Promise<string> { return ''; }
  public async getModifiedFiles(): Promise<string[]> { return []; }
  public async submitReview(): Promise<void> {}
  public async mergePullRequest(): Promise<void> {}

  public async fetchComments(): Promise<RemoteComment[]> { return []; }
  public async postComment(_owner: string, _repo: string, _id: number | string, body: string): Promise<RemoteComment> {
    return { id: 1, author: 'stub', body, createdAt: new Date().toISOString() };
  }
  public async updateComment(): Promise<void> {}
  public async deleteComment(): Promise<void> {}

  public async getLatestCheckRuns(): Promise<CheckRunStatus[]> { return []; }
  public async getWorkflowLogs(): Promise<string> { return ''; }
  public async triggerWorkflow(): Promise<void> {}
}
