import { LedgerStorageEngine } from './LedgerStorageEngine.js';
import { IRemoteProvider } from '../remote/types.js';

export interface ResolvedTaskContext {
  title: string;
  body: string | null;
  projectId: string;
  externalId?: string;
}

/**
 * TaskResolver
 * Responsibility: Bridges the gap between an external reference (GitHub #123) 
 * and our local Ledger/TaskRecords.
 */
export class TaskResolver {
  constructor(
    private readonly storageEngine: LedgerStorageEngine,
    private readonly remoteProvider: IRemoteProvider
  ) {}

  /**
   * Resolves a task's full context. 
   * If it doesn't exist locally, it fetches from the remote provider.
   */
  public async resolve(projectId: string, externalId?: string): Promise<ResolvedTaskContext> {
    const project = await this.storageEngine.getProject(projectId);
    if (!project) {
      throw new Error(`Project ${projectId} not found in ledger.`);
    }

    if (!externalId) {
      // Manual task, no external source
      return {
        title: 'Manual Task',
        body: null,
        projectId
      };
    }

    // Attempt to resolve via remote (assuming owner/repo can be inferred or stored in project)
    // For now, let's assume project name is "owner/repo" or similar
    const [owner, repo] = project.name.split('/');
    
    if (!owner || !repo) {
        // Fallback if naming convention isn't followed
        return {
            title: `Task #${externalId}`,
            body: null,
            projectId,
            externalId
        };
    }

    try {
      const remote = await this.remoteProvider.fetchIssue(owner, repo, parseInt(externalId, 10));
      return {
        title: remote.title,
        body: remote.body,
        projectId,
        externalId: String(remote.number)
      };
    } catch (error) {
      console.warn(`[TaskResolver] Could not fetch remote issue ${owner}/${repo}#${externalId}:`, error);
      return {
        title: `Unresolved Task #${externalId}`,
        body: null,
        projectId,
        externalId
      };
    }
  }
}
