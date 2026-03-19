import * as fs from 'fs/promises';
import * as path from 'path';
import { randomUUID } from 'node:crypto';
import {
  AppSettings,
  AuditLogEntry,
  FsmStep,
  LocalLedger,
  MessageIntent,
  ProjectRecord,
  TaskRecord,
  TaskStatus,
  TaskSummary,
} from './types.js';
import { LedgerCorruptionError } from './errors.js';
import { createLogger, Logger } from '../logging/Logger.js';

export class LedgerStorageEngine {
  private readonly dataDir: string;
  private readonly tasksDir: string;
  private readonly logsDir: string;
  private readonly workspacesDir: string;
  private readonly ledgerPath: string;
  private readonly ledgerTmpPath: string;
  private logger: Logger;
 
  constructor(baseDir: string = process.cwd()) {
    this.dataDir = path.join(baseDir, 'data');
    this.tasksDir = path.join(this.dataDir, 'tasks');
    this.logsDir = path.join(this.dataDir, 'logs');
    this.workspacesDir = path.join(this.dataDir, 'workspaces');
    this.ledgerPath = path.join(this.dataDir, 'ledger.json');
    this.ledgerTmpPath = path.join(this.dataDir, 'ledger.tmp.json');
    this.logger = createLogger('storage');
  }

  public async bootstrapEnvironment(): Promise<void> {
    const dirs = [this.dataDir, this.tasksDir, this.logsDir, this.workspacesDir];
    for (const dir of dirs) {
      await fs.mkdir(dir, { recursive: true });
    }

    try {
      await fs.access(this.ledgerPath);
      const ledger = await this.getLedger();
      const defaults = this.getDefaultSettings();
      
      // Merge missing settings into existing ones
      if (!ledger.settings) {
        ledger.settings = defaults;
        await this.commitLedger(ledger);
      } else {
        // 1. Merge missing top-level keys
        let changed = false;
        for (const [key, value] of Object.entries(defaults)) {
          if (ledger.settings[key as keyof AppSettings] === undefined) {
            (ledger.settings[key as keyof AppSettings] as any) = value;
            changed = true;
          }
        }

        // 2. Merge missing providers
        if (defaults.providers) {
          if (!ledger.settings.providers) {
            ledger.settings.providers = defaults.providers;
            changed = true;
          } else {
            for (const defProvider of defaults.providers) {
              const exists = ledger.settings.providers.find(p => p.id === defProvider.id);
              if (!exists) {
                ledger.settings.providers.push(defProvider);
                changed = true;
              }
            }
          }
        }

        if (changed) {
          await this.commitLedger(ledger);
          this.logger.info('Migrated ledger settings with new default keys/providers.');
        }
      }
    } catch (error) {
      const err = error as NodeJS.ErrnoException;
      if (err.code === 'ENOENT') {
        const defaultLedger: LocalLedger = {
          schemaVersion: 1,
          projects: [],
          tasks: [],
          settings: this.getDefaultSettings(),
        };
        await fs.writeFile(this.ledgerPath, JSON.stringify(defaultLedger, null, 2), 'utf8');
      } else {
        throw error;
      }
    }
  }

  private getDefaultSettings(): AppSettings {
    return {
      agentMention: process.env.AGENT_MENTION || 'ralph',
      ollamaHost: process.env.OLLAMA_HOST || 'http://localhost:11434',
      ollamaModel: process.env.OLLAMA_MODEL || 'llama3',
      serverPort: parseInt(process.env.PORT || '3000', 10),
      workerGeminiEnabled: process.env.ENABLE_GEMINI !== 'false',
      workerGeminiModel: process.env.GEMINI_MODEL || '',
      workerCopilotEnabled: process.env.ENABLE_COPILOT === 'true',
      workerCopilotModel: process.env.COPILOT_MODEL || '',
      workerOpencodeEnabled: process.env.ENABLE_OPENCODE === 'true',
      workerOpencodeModel: process.env.OPENCODE_MODEL || '',
      maxBacklog: parseInt(process.env.MAX_BACKLOG || '200', 10),
      maxIterations: parseInt(process.env.MAX_ITERATIONS || '10', 10),
      activeProviderId: process.env.ACTIVE_LLM_PROVIDER || 'ollama-local',
      providers: [
        {
          id: 'ollama-local',
          providerId: 'ollama-local',
          baseURL: process.env.OLLAMA_HOST || 'http://localhost:11434',
          model: process.env.OLLAMA_MODEL || 'llama3',
        },
        {
          id: 'openai-official',
          providerId: 'openai',
          apiKey: process.env.OPENAI_API_KEY || '',
          baseURL: 'https://api.openai.com/v1',
          model: 'gpt-4o',
        },
        {
          id: 'anthropic-official',
          providerId: 'anthropic',
          apiKey: process.env.ANTHROPIC_API_KEY || '',
          baseURL: 'https://api.anthropic.com/v1',
          model: 'claude-3-5-sonnet-20240620',
        },
        {
          id: 'google-gemini',
          providerId: 'openai',
          apiKey: process.env.GEMINI_API_KEY || '',
          baseURL: 'https://generativelanguage.googleapis.com/v1beta/openai/',
          model: 'gemini-1.5-pro',
        },
        {
          id: 'openrouter',
          providerId: 'openai',
          apiKey: process.env.OPENROUTER_API_KEY || '',
          baseURL: 'https://openrouter.ai/api/v1',
          model: 'anthropic/claude-3.5-sonnet',
        },
        {
          id: 'ollama-v1',
          providerId: 'openai',
          baseURL: 'http://localhost:11434/v1/',
          model: 'llama3',
        },
        {
          id: 'sambanova',
          providerId: 'openai',
          apiKey: process.env.SAMBANOVA_API_KEY || '',
          baseURL: 'https://api.sambanova.ai/v1',
          model: 'Meta-Llama-3.1-70B-Instruct',
        }
      ]
    };
  }

  public async getSettings(): Promise<AppSettings> {
    const ledger = await this.getLedger();
    return ledger.settings;
  }

  public async updateSettings(updates: Partial<AppSettings>): Promise<AppSettings> {
    return this.mutateLedger(async (ledger) => {
      ledger.settings = { ...ledger.settings, ...updates };
      return ledger.settings;
    });
  }

  public getWorkspacesDir(): string {
    return this.workspacesDir;
  }

  // ─── Project Management ──────────────────────────────────────────────────

  public async addProject(
    name: string, 
    absolutePath: string, 
    defaultBranch: string = 'main',
    isLocalOnly: boolean = true,
    sourceUrl?: string,
    ciCommands: string[] = []
  ): Promise<ProjectRecord> {
    return this.mutateLedger(async (ledger) => {
      const existing = ledger.projects.find(p => p.absolutePath === absolutePath);
      if (existing) {
          existing.name = name;
          existing.defaultBranch = defaultBranch;
          existing.isLocalOnly = isLocalOnly;
          existing.sourceUrl = sourceUrl;
          existing.ciCommands = ciCommands;
          existing.lastScannedAt = new Date().toISOString();
          return existing;
      }

      const newProject: ProjectRecord = {
        id: randomUUID(),
        name,
        absolutePath,
        sourceUrl,
        isLocalOnly,
        ciCommands,
        defaultBranch,
        ignoredPaths: ['node_modules', '.git', 'dist'],
        lastScannedAt: new Date().toISOString()
      };

      ledger.projects.push(newProject);
      return newProject;
    });
  }

  public async getProject(projectId: string): Promise<ProjectRecord | undefined> {
    const resolvedId = await this.resolveProjectId(projectId).catch(() => projectId);
    const ledger = await this.getLedger();
    return ledger.projects.find(p => p.id === resolvedId);
  }

  // ─── Task Management ─────────────────────────────────────────────────────

  public async createTask(
    projectId: string, 
    title: string, 
    originalPrompt: string, 
    urgent: boolean = false,
    labels: string[] = [],
    assignees: string[] = [],
    milestone?: string
  ): Promise<TaskRecord> {
    const resolvedProjectId = await this.resolveProjectId(projectId).catch(() => projectId);
    const taskId = randomUUID();

    const taskRecord: TaskRecord = {
      id: taskId,
      projectId: resolvedProjectId,
      status: 'OPEN',
      objective: {
        title,
        originalPrompt,
        successCriteria: []
      },
      context: {
        currentStep: FsmStep.INVESTIGATE,
        investigation: { discoveredFiles: [], searchQueriesRun: [], architecturalSummary: '', notes: '' },
        planning: { proposedSteps: [], targetFiles: [], requiredTools: [], planSummary: '' },
        execution: { activeWorkerId: '', attemptCount: 0, lastErrorLog: null, geminiPrompt: '', selectedWorker: 'gemini' },
        verification: { commandsRun: [], testOutput: '', lintPassed: false },
        contextStack: []
      },
      thread: { messages: [] },
      workspace: {},
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      labels,
      assignees,
      milestone
    };

    const taskSummary: TaskSummary = {
      id: taskId,
      projectId: resolvedProjectId,
      status: 'OPEN',
      title,
      urgent,
      humanInputReceived: false,
      labels,
      assignees,
      milestone
    };

    await this.mutateLedger(async (ledger) => {
      ledger.tasks.push(taskSummary);
    });
    
    await this.commitTaskRecord(taskRecord);
    return taskRecord;
  }

  public async updateTaskStatus(taskId: string, status: TaskStatus): Promise<void> {
    const resolvedId = await this.resolveTaskId(taskId);
    
    await this.mutateLedger(async (ledger) => {
      const summary = ledger.tasks.find(t => t.id === resolvedId);
      if (summary) {
        summary.status = status;
      }
    });

    await this.mutateTaskRecord(resolvedId, async (record) => {
      record.status = status;
    });
  }

  public async appendMessageToTask(
    taskId: string,
    author: 'HUMAN' | 'RALPH' | 'SYSTEM',
    body: string,
    intent: MessageIntent = 'STATUS_UPDATE'
  ): Promise<void> {
    const resolvedId = await this.resolveTaskId(taskId);
    
    await this.mutateTaskRecord(resolvedId, async (record) => {
      record.thread.messages.push({
        id: randomUUID(),
        author,
        body,
        intent,
        timestamp: new Date().toISOString()
      });
    });

    if (author === 'HUMAN') {
      await this.mutateLedger(async (ledger) => {
        const summary = ledger.tasks.find(t => t.id === resolvedId);
        if (summary) {
          summary.humanInputReceived = true;
        }
      });
    }
  }

  public async updateTaskLabels(taskId: string, labels: string[]): Promise<void> {
    const resolvedId = await this.resolveTaskId(taskId);
    await this.mutateLedger(async (ledger) => {
      const summary = ledger.tasks.find(t => t.id === resolvedId);
      if (summary) {
        summary.labels = labels;
      }
    });
    await this.mutateTaskRecord(resolvedId, async (record) => {
      record.labels = labels;
    });
  }

  public async updateTaskAssignees(taskId: string, assignees: string[]): Promise<void> {
    const resolvedId = await this.resolveTaskId(taskId);
    await this.mutateLedger(async (ledger) => {
      const summary = ledger.tasks.find(t => t.id === resolvedId);
      if (summary) {
        summary.assignees = assignees;
      }
    });
    await this.mutateTaskRecord(resolvedId, async (record) => {
      record.assignees = assignees;
    });
  }

  public async updateTaskMilestone(taskId: string, milestone: string): Promise<void> {
    const resolvedId = await this.resolveTaskId(taskId);
    await this.mutateLedger(async (ledger) => {
      const summary = ledger.tasks.find(t => t.id === resolvedId);
      if (summary) {
        summary.milestone = milestone;
      }
    });
    await this.mutateTaskRecord(resolvedId, async (record) => {
      record.milestone = milestone;
    });
  }

  // ─── Auth/Policy ─────────────────────────────────────────────────────────

  public async isAuthorizedAdmin(username: string): Promise<boolean> {
    if (!username) return false;
    return username.toLowerCase() === 'admin';
  }

  // ─── Core Persistence ─────────────────────────────────────────────────────

  public async getLedger(): Promise<LocalLedger> {
    try {
      const data = await fs.readFile(this.ledgerPath, 'utf8');
      return JSON.parse(data) as LocalLedger;
    } catch (error) {
      if (error instanceof Error) {
        throw new LedgerCorruptionError(`Failed to parse ledger.json: ${error.message}`);
      }
      throw new LedgerCorruptionError('Unknown error parsing ledger.json');
    }
  }

  public async commitLedger(ledger: LocalLedger): Promise<void> {
    const data = JSON.stringify(ledger, null, 2);
    await fs.writeFile(this.ledgerTmpPath, data, 'utf8');
    await fs.rename(this.ledgerTmpPath, this.ledgerPath);
  }

  public async getTaskRecord(taskId: string): Promise<TaskRecord> {
    const resolvedId = await this.resolveTaskId(taskId);
    const taskPath = path.join(this.tasksDir, `${resolvedId}.json`);
    try {
      const data = await fs.readFile(taskPath, 'utf8');
      return JSON.parse(data) as TaskRecord;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        throw new Error(`Task record not found for taskId: ${resolvedId}`);
      }
      throw new Error(`Failed to parse task record ${resolvedId}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  public async commitTaskRecord(task: TaskRecord): Promise<void> {
    task.updatedAt = new Date().toISOString();
    const taskPath = path.join(this.tasksDir, `${task.id}.json`);
    const taskTmpPath = path.join(this.tasksDir, `${task.id}.tmp.json`);
    const data = JSON.stringify(task, null, 2);

    await fs.writeFile(taskTmpPath, data, 'utf8');
    await fs.rename(taskTmpPath, taskPath);
  }

  /**
   * Helper to execute an action while holding a persistent file lock.
   */
  public async withLock<T>(resourceId: string, ttlMs: number, action: () => Promise<T>): Promise<T> {
    const start = Date.now();
    const timeout = 10000; 
    let acquired = false;

    while (Date.now() - start < timeout) {
      acquired = await this.acquireLock(resourceId, ttlMs);
      if (acquired) break;
      await new Promise(r => setTimeout(r, 100)); // Sleep 100ms
    }

    if (!acquired) {
      throw new Error(`Failed to acquire lock for ${resourceId} after ${timeout}ms timeout.`);
    }

    try {
      return await action();
    } finally {
      await this.releaseLock(resourceId);
    }
  }

  /**
   * High-level transaction helper for the Ledger.
   */
  public async mutateLedger<T>(action: (ledger: LocalLedger) => Promise<T>): Promise<T> {
    return this.withLock('ledger', 5000, async () => {
      const ledger = await this.getLedger();
      const result = await action(ledger);
      await this.commitLedger(ledger);
      return result;
    });
  }

  /**
   * High-level transaction helper for a TaskRecord.
   */
  public async mutateTaskRecord<T>(taskId: string, action: (record: TaskRecord) => Promise<T>): Promise<T> {
    const resolvedId = await this.resolveTaskId(taskId);
    return this.withLock(resolvedId, 5000, async () => {
      const record = await this.getTaskRecord(resolvedId);
      const result = await action(record);
      await this.commitTaskRecord(record);
      return result;
    });
  }

  public async acquireLock(resourceId: string, ttlMs: number): Promise<boolean> {
    const lockPath = path.join(this.dataDir, `${resourceId}.lock`);

    try {
      const handle = await fs.open(lockPath, 'wx');
      await handle.close();
      return true;
    } catch (error) {
      const err = error as NodeJS.ErrnoException;
      if (err.code === 'EEXIST') {
        try {
          const stats = await fs.stat(lockPath);
          const now = Date.now();
          if (now - stats.mtimeMs > ttlMs) {
            try {
              await fs.unlink(lockPath);
            } catch (unlinkError) {
              if ((unlinkError as NodeJS.ErrnoException).code !== 'ENOENT') {
                throw unlinkError;
              }
            }
            return this.acquireLock(resourceId, ttlMs);
          }
        } catch {
          return this.acquireLock(resourceId, ttlMs);
        }
        return false;
      }
      throw error;
    }
  }

  public async releaseLock(resourceId: string): Promise<void> {
    const lockPath = path.join(this.dataDir, `${resourceId}.lock`);
    try {
      await fs.unlink(lockPath);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        throw error;
      }
    }
  }

  public async appendAuditLog(taskId: string, entry: AuditLogEntry): Promise<void> {
    const resolvedId = await this.resolveTaskId(taskId);
    const logPath = path.join(this.logsDir, `${resolvedId}.audit.log`);
    const line = JSON.stringify({ ...entry, taskId: resolvedId }) + '\n';
    await fs.appendFile(logPath, line, 'utf8');
  }

  public async getAuditLogs(taskId: string): Promise<AuditLogEntry[]> {
    const resolvedId = await this.resolveTaskId(taskId);
    const logPath = path.join(this.logsDir, `${resolvedId}.audit.log`);
    try {
      const data = await fs.readFile(logPath, 'utf8');
      return data.trim().split('\n').map(line => JSON.parse(line));
    } catch {
      return [];
    }
  }

  public async resolveTaskId(idOrPrefix: string): Promise<string> {
    const ledger = await this.getLedger();
    const exact = ledger.tasks.find(t => t.id === idOrPrefix);
    if (exact) return exact.id;

    const matches = ledger.tasks.filter(t => t.id.startsWith(idOrPrefix));
    if (matches.length === 1 && matches[0]) {
      return matches[0].id;
    }
    
    if (matches.length > 1) {
      const matchIds = matches.map(m => m.id.split('-')[0]).join(', ');
      throw new Error(`Ambiguous task ID prefix "${idOrPrefix}". Matches: ${matchIds}`);
    }

    throw new Error(`Task record not found for taskId: ${idOrPrefix}`);
  }

  public async resolveProjectId(idOrPrefix: string): Promise<string> {
    const ledger = await this.getLedger();
    const exact = ledger.projects.find(p => p.id === idOrPrefix);
    if (exact) return exact.id;

    const matches = ledger.projects.filter(p => p.id.startsWith(idOrPrefix));
    if (matches.length === 1 && matches[0]) {
      return matches[0].id;
    }
    
    if (matches.length > 1) {
      const matchIds = matches.map(m => m.id.split('-')[0]).join(', ');
      throw new Error(`Ambiguous project ID prefix "${idOrPrefix}". Matches: ${matchIds}`);
    }

    return idOrPrefix;
  }
}
