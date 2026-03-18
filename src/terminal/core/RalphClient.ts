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
    milestone?: string
  ): Promise<{ taskId: string }> {
    const res = await fetch(`${this.baseUrl}/tasks`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action, projectId, input, urgent, labels, assignees, milestone })
    });
    return res.json() as Promise<{ taskId: string }>;
  }

  async getTask(taskId: string): Promise<TaskRecord> {
    const res = await fetch(`${this.baseUrl}/tasks/${taskId}`);
    return res.json() as Promise<TaskRecord>;
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
