import { ProjectRecord, TaskSummary, TaskRecord } from '../../infrastructure/storage/types.js';

export class RalphClient {
  private baseUrl: string;

  constructor(port: number = 3000) {
    this.baseUrl = `http://localhost:${port}/api`;
  }

  async getProjects(): Promise<ProjectRecord[]> {
    const res = await fetch(`${this.baseUrl}/projects`);
    return res.json() as Promise<ProjectRecord[]>;
  }

  async addProject(project: Partial<ProjectRecord>): Promise<ProjectRecord> {
    const res = await fetch(`${this.baseUrl}/projects`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(project)
    });
    return res.json() as Promise<ProjectRecord>;
  }

  async getTasks(status?: string, projectId?: string): Promise<TaskSummary[]> {
    const url = new URL(`${this.baseUrl}/tasks`);
    if (status) url.searchParams.append('status', status);
    if (projectId) url.searchParams.append('projectId', projectId);
    const res = await fetch(url.toString());
    return res.json() as Promise<TaskSummary[]>;
  }

  async createTask(
    action: string, 
    projectId: string, 
    input: string, 
    urgent: boolean = false,
    labels: string[] = [],
    assignees: string[] = [],
    milestone?: string,
    useTDD?: boolean
  ): Promise<{ taskId: string }> {
    const res = await fetch(`${this.baseUrl}/tasks`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action, projectId, input, urgent, labels, assignees, milestone, useTDD })
    });
    return res.json() as Promise<{ taskId: string }>;
  }

  async getTask(taskId: string): Promise<TaskRecord> {
    const res = await fetch(`${this.baseUrl}/tasks/${taskId}`);
    return res.json() as Promise<TaskRecord>;
  }

  async getSubTasks(taskId: string): Promise<any[]> {
    const res = await fetch(`${this.baseUrl}/tasks/${taskId}/subtasks`);
    return res.json() as Promise<any[]>;
  }

  async updateSubTask(taskId: string, subTaskId: string, updates: any): Promise<any> {
    const res = await fetch(`${this.baseUrl}/tasks/${taskId}/subtasks/${subTaskId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(updates)
    });
    return res.json();
  }

  async delegateTask(taskId: string, specialist: string, instruction: string, context_files: string[] = []): Promise<any> {
    const res = await fetch(`${this.baseUrl}/tasks/${taskId}/delegate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ specialist, instruction, context_files })
    });
    return res.json();
  }

  async getAuditLogs(taskId: string): Promise<any[]> {
    const res = await fetch(`${this.baseUrl}/tasks/${taskId}/audit`);
    return res.json() as Promise<any[]>;
  }

  async jumpStep(taskId: string, step: string): Promise<any> {
    const res = await fetch(`${this.baseUrl}/tasks/${taskId}/step/jump`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ step })
    });
    return res.json();
  }

  async deleteTask(taskId: string): Promise<any> {
    const res = await fetch(`${this.baseUrl}/tasks/${taskId}`, {
      method: 'DELETE'
    });
    return res.json();
  }

  async getTaskContext(taskId: string): Promise<any> {
    const res = await fetch(`${this.baseUrl}/tasks/${taskId}/context`);
    return res.json();
  }

  async getProjectTree(projectId: string): Promise<string[]> {
    const res = await fetch(`${this.baseUrl}/projects/${projectId}/tree`);
    return res.json() as Promise<string[]>;
  }

  async indexProject(projectId: string): Promise<any> {
    const res = await fetch(`${this.baseUrl}/projects/${projectId}/index`, {
      method: 'POST'
    });
    return res.json();
  }

  async searchProject(projectId: string, query: string): Promise<any> {
    const res = await fetch(`${this.baseUrl}/projects/${projectId}/search?q=${encodeURIComponent(query)}`);
    return res.json();
  }

  async getWorkersStatus(): Promise<any> {
    const res = await fetch(`${this.baseUrl}/system/workers`);
    return res.json();
  }

  async getQuotaStatus(): Promise<any[]> {
    const res = await fetch(`${this.baseUrl}/system/quota`);
    return res.json() as Promise<any[]>;
  }

  async runJanitorAudit(): Promise<any> {
    const res = await fetch(`${this.baseUrl}/system/janitor/run`, {
      method: 'POST'
    });
    return res.json();
  }

  // ─── Evaluation ──────────────────────────────────────────────────────────

  async runEval(scenarioId: string): Promise<{ evalId: string; message: string }> {
    const res = await fetch(`${this.baseUrl}/eval/run`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ scenarioId })
    });
    return res.json() as Promise<{ evalId: string; message: string }>;
  }

  async getEvalStatus(evalId: string): Promise<any> {
    const res = await fetch(`${this.baseUrl}/eval/${evalId}/status`);
    return res.json();
  }

  async getEvalResults(): Promise<any[]> {
    const res = await fetch(`${this.baseUrl}/eval/results`);
    return res.json() as Promise<any[]>;
  }

  async getEvalScenarios(): Promise<any[]> {
    const res = await fetch(`${this.baseUrl}/eval/scenarios`);
    return res.json() as Promise<any[]>;
  }

  async chatTask(taskId: string, message: string): Promise<{ response: string }> {
    const res = await fetch(`${this.baseUrl}/tasks/${taskId}/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message })
    });
    return res.json() as Promise<{ response: string }>;
  }

  // ─── Project Chat Sessions ───────────────────────────────────────────────

  async createChatSession(projectId: string): Promise<any> {
    const res = await fetch(`${this.baseUrl}/chats`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ projectId })
    });
    return res.json() as Promise<any>;
  }

  async getChatSessions(projectId: string): Promise<any[]> {
    const res = await fetch(`${this.baseUrl}/chats/project/${projectId}`);
    return res.json() as Promise<any[]>;
  }

  async chatProject(sessionId: string, message: string): Promise<{ response: string }> {
    const res = await fetch(`${this.baseUrl}/chats/${sessionId}/messages`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message })
    });
    return res.json() as Promise<{ response: string }>;
  }

  // ─── Knowledge Base ──────────────────────────────────────────────────────

  async searchKnowledge(query: string, category?: string): Promise<any[]> {
    const url = new URL(`${this.baseUrl}/kb`);
    url.searchParams.append('query', query);
    if (category) url.searchParams.append('category', category);
    const res = await fetch(url.toString());
    return res.json() as Promise<any[]>;
  }

  async getKnowledgeEntry(id: string): Promise<any> {
    const res = await fetch(`${this.baseUrl}/kb/${id}`);
    return res.json() as Promise<any>;
  }

  async publishKnowledge(entry: any): Promise<any> {
    const res = await fetch(`${this.baseUrl}/kb`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(entry)
    });
    return res.json() as Promise<any>;
  }

  async appendMessage(taskId: string, body: string, intent: string = 'STATUS_UPDATE'): Promise<{ success: boolean }> {
    const res = await fetch(`${this.baseUrl}/tasks/${taskId}/messages`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ body, intent })
    });
    return res.json() as Promise<{ success: boolean }>;
  }

  async getDiff(taskId: string): Promise<string> {
    const res = await fetch(`${this.baseUrl}/tasks/${taskId}/artifacts/diff`);
    return res.text();
  }

  getStreamUrl(taskId?: string, backlog: boolean = false): string {
    const url = new URL(`${this.baseUrl.replace(/\/api$/, '')}/api/stream`);
    if (taskId) {
      url.searchParams.append('taskId', taskId);
    }
    if (backlog) {
        url.searchParams.append('backlog', 'true');
    }
    return url.toString();
  }

  async getSettings(): Promise<any> {
    const res = await fetch(`${this.baseUrl}/settings`);
    return res.json();
  }

  async patchSettings(updates: any): Promise<{ success: boolean; settings: any }> {
    const res = await fetch(`${this.baseUrl}/settings`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(updates)
    });
    return res.json() as Promise<{ success: boolean; settings: any }>;
  }
}
