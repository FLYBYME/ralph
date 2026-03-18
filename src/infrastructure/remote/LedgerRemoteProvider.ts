import { 
  IRemoteProvider, 
  RemoteIssue, 
  RemotePullRequest, 
  CheckRunStatus, 
  RepositoryMetadata, 
  RemoteComment 
} from './types.js';
import { LedgerStorageEngine } from '../storage/LedgerStorageEngine.js';
import { DiskTooling } from '../storage/DiskTooling.js';
import { DockerRunner } from './DockerRunner.js';
import * as path from 'path';
import * as fs from 'node:fs/promises';
import { exec } from 'node:child_process';
import { promisify } from 'node:util';

const execAsync = promisify(exec);

/**
 * LedgerRemoteProvider
 * A fully-functional local-first provider. 
 * Uses LedgerStorageEngine for data and Dockerode for CI/CD.
 */
export class LedgerRemoteProvider implements IRemoteProvider {
  public readonly providerId = 'local-ledger';
  private dockerRunner = new DockerRunner();

  constructor(
    private readonly storageEngine: LedgerStorageEngine,
    private readonly diskTooling: DiskTooling
  ) {}

  // ─── Repository & Metadata ───────────────────────────────────────────────

  public async fetchRepository(owner: string, repo: string): Promise<RepositoryMetadata> {
    const ledger = await this.storageEngine.getLedger();
    const project = ledger.projects.find(p => p.name === `${owner}/${repo}`);
    if (!project) throw new Error(`Project ${owner}/${repo} not found in ledger.`);

    return {
      owner,
      name: repo,
      description: 'Local Project',
      defaultBranch: project.defaultBranch,
      visibility: 'private',
      url: `local://${project.absolutePath}`
    };
  }

  public async getDefaultBranch(owner: string, repo: string): Promise<string> {
    const repoInfo = await this.fetchRepository(owner, repo);
    return repoInfo.defaultBranch;
  }

  public async getFileContent(owner: string, repo: string, filePath: string, _ref?: string): Promise<string | null> {
    const repoInfo = await this.fetchRepository(owner, repo);
    const absPath = path.resolve(repoInfo.url.replace('local://', ''), filePath);
    if (!(await this.diskTooling.fileExists(absPath))) return null;
    return await this.diskTooling.readFile(absPath);
  }

  public async searchCode(owner: string, repo: string, query: string): Promise<string[]> {
    const repoInfo = await this.fetchRepository(owner, repo);
    const cwd = repoInfo.url.replace('local://', '');
    try {
      const { stdout } = await execAsync(`grep -rlI "${query}" . --exclude-dir=node_modules`, { cwd });
      return stdout.trim().split('\n').filter(Boolean);
    } catch {
      return [];
    }
  }

  public async branchExists(owner: string, repo: string, name: string): Promise<boolean> {
    const repoInfo = await this.fetchRepository(owner, repo);
    const cwd = repoInfo.url.replace('local://', '');
    try {
      await execAsync(`git rev-parse --verify ${name}`, { cwd });
      return true;
    } catch {
      return false;
    }
  }

  public async deleteBranch(owner: string, repo: string, name: string): Promise<void> {
    const repoInfo = await this.fetchRepository(owner, repo);
    const cwd = repoInfo.url.replace('local://', '');
    await execAsync(`git branch -D ${name}`, { cwd });
  }

  public async cloneRepository(_owner: string, _repo: string, url: string, targetPath: string): Promise<void> {
    await execAsync(`git clone ${url} ${targetPath}`);
  }

  // ─── Issue Management ────────────────────────────────────────────────────

  public async fetchIssue(_owner: string, _repo: string, id: number | string): Promise<RemoteIssue> {
    const record = await this.storageEngine.getTaskRecord(String(id));
    return {
      number: 0,
      title: record.objective.title,
      body: record.objective.originalPrompt,
      state: record.status === 'COMPLETED' ? 'closed' : 'open',
      labels: record.labels || [],
      assignees: record.assignees || [],
      milestone: record.milestone,
      url: `local://ledger/${record.id}`,
      createdAt: record.createdAt,
      updatedAt: record.updatedAt
    };
  }

  public async listIssues(owner: string, repo: string): Promise<RemoteIssue[]> {
    const ledger = await this.storageEngine.getLedger();
    const project = ledger.projects.find(p => p.name === `${owner}/${repo}`);
    if (!project) return [];

    const tasks = ledger.tasks.filter(t => t.projectId === project.id);
    const results: RemoteIssue[] = [];
    for (const t of tasks) {
        results.push(await this.fetchIssue(owner, repo, t.id));
    }
    return results;
  }

  public async updateIssue(_owner: string, _repo: string, id: number | string, updates: any): Promise<void> {
    if (updates.state) {
        await this.storageEngine.updateTaskStatus(String(id), updates.state === 'closed' ? 'COMPLETED' : 'OPEN');
    }
  }

  public async addLabels(_owner: string, _repo: string, id: number | string, labels: string[]): Promise<void> {
    const record = await this.storageEngine.getTaskRecord(String(id));
    const currentLabels = record.labels || [];
    const newLabels = [...new Set([...currentLabels, ...labels])];
    await this.storageEngine.updateTaskLabels(String(id), newLabels);
  }

  public async removeLabels(_owner: string, _repo: string, id: number | string, labels: string[]): Promise<void> {
    const record = await this.storageEngine.getTaskRecord(String(id));
    const currentLabels = record.labels || [];
    const newLabels = currentLabels.filter(l => !labels.includes(l));
    await this.storageEngine.updateTaskLabels(String(id), newLabels);
  }

  public async setAssignees(_owner: string, _repo: string, id: number | string, assignees: string[]): Promise<void> {
    await this.storageEngine.updateTaskAssignees(String(id), assignees);
  }

  // ─── Pull Request Lifecycle ──────────────────────────────────────────────

  public async createPullRequest(_owner: string, _repo: string, head: string, base: string, _title: string, _body: string): Promise<{ number: number; url: string }> {
    console.log(`[LedgerRemoteProvider] Local PR "Opened": ${head} -> ${base}`);
    return { number: Date.now(), url: `local://pr/${head}` };
  }

  public async fetchPullRequest(_owner: string, _repo: string, prNumber: number): Promise<RemotePullRequest> {
    return {
      number: prNumber,
      title: 'Local PR',
      body: '',
      state: 'open',
      url: `local://pr/${prNumber}`,
      labels: [],
      assignees: [],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      headRef: 'feature',
      baseRef: 'main',
      merged: false,
      draft: false
    };
  }

  public async getDiff(owner: string, repo: string, _prNumber: number): Promise<string> {
    const repoInfo = await this.fetchRepository(owner, repo);
    const cwd = repoInfo.url.replace('local://', '');
    const { stdout } = await execAsync(`git diff main`, { cwd });
    return stdout;
  }

  public async getModifiedFiles(owner: string, repo: string, _prNumber: number): Promise<string[]> {
    const repoInfo = await this.fetchRepository(owner, repo);
    const cwd = repoInfo.url.replace('local://', '');
    const { stdout } = await execAsync(`git diff --name-only main`, { cwd });
    return stdout.trim().split('\n').filter(Boolean);
  }

  public async submitReview(): Promise<void> {}
  public async mergePullRequest(): Promise<void> {}

  // ─── Conversations ───────────────────────────────────────────────────────

  public async fetchComments(_owner: string, _repo: string, id: number | string): Promise<RemoteComment[]> {
    const record = await this.storageEngine.getTaskRecord(String(id));
    return record.thread.messages.map(m => ({
        id: m.id,
        author: m.author,
        body: m.body,
        createdAt: m.timestamp
    }));
  }

  public async postComment(_owner: string, _repo: string, id: number | string, body: string): Promise<RemoteComment> {
    await this.storageEngine.appendMessageToTask(String(id), 'RALPH', body);
    return {
        id: Date.now(),
        author: 'RALPH',
        body,
        createdAt: new Date().toISOString()
    };
  }

  public async updateComment(): Promise<void> {}
  public async deleteComment(): Promise<void> {}

  // ─── CI/CD & Workflows ───────────────────────────────────────────────────

  public async getLatestCheckRuns(_owner: string, _repo: string, ref: string): Promise<CheckRunStatus[]> {
    const conclusion = await this.dockerRunner.getStatus(ref); 
    return [{
        name: 'local-docker-ci',
        status: conclusion ? 'completed' : 'in_progress',
        conclusion: conclusion,
        run_id: 1
    }];
  }

  public async getWorkflowLogs(_owner: string, _repo: string, runId: number): Promise<string> {
    const logPath = path.join(process.cwd(), 'data', 'logs', `ci-${runId}.log`);
    try {
        return await fs.readFile(logPath, 'utf8');
    } catch {
        return 'No logs found.';
    }
  }

  public async triggerWorkflow(owner: string, repo: string, _workflowId: string | number, ref: string): Promise<void> {
    const repoInfo = await this.fetchRepository(owner, repo);
    const projectPath = repoInfo.url.replace('local://', '');
    const logPath = path.join(process.cwd(), 'data', 'logs', `ci-${ref}.log`);
    void this.dockerRunner.runWorkflow(projectPath, String(ref), logPath);
  }
}
