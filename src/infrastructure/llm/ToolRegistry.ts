import type { Tool } from 'ollama';
import * as fs from 'fs/promises';
import * as path from 'path';
import { exec } from 'node:child_process';
import { promisify } from 'node:util';
import { DiskTooling } from '../storage/DiskTooling.js';
import { WorkerManager } from './WorkerManager.js';
import { ILlmProvider, WorkerPayload } from './types.js';
import { LedgerStorageEngine } from '../storage/LedgerStorageEngine.js';
import { KnowledgeCategory } from '../storage/types.js';

const execAsync = promisify(exec);

// ─── Public Types ────────────────────────────────────────────────────────────

export type ToolParamValue = string | number | boolean | string[];
export type ToolParams = Record<string, ToolParamValue>;

export interface ToolResult {
  success: boolean;
  output: string;
}

export interface RegisteredTool {
  /** Native Ollama tool definition for the API call. */
  ollamaTool: Tool;
  execute: (params: ToolParams) => Promise<ToolResult>;
}

export type ToolRegistry = Map<string, RegisteredTool>;

// ─── HITL Plan Sentinel ──────────────────────────────────────────────────────

export interface ProposedPlan {
  title: string;
  markdownSteps: string;
  targetFiles: string[];
}

/** Thrown inside proposePlan.execute() to halt the ReAct loop. */
export class PlanProposedError extends Error {
  readonly plan: ProposedPlan;
  constructor(plan: ProposedPlan) {
    super('PLAN_PROPOSED');
    this.name = 'PlanProposedError';
    this.plan = plan;
  }
}

/** Thrown inside concludeInvestigation.execute() to halt the ReAct loop. */
export class InvestigationConcludedError extends Error {
  readonly report: string;
  constructor(report: string) {
    super('INVESTIGATION_CONCLUDED');
    this.name = 'InvestigationConcludedError';
    this.report = report;
  }
}

// ─── Helper: safely extract params ───────────────────────────────────────────

function str(params: ToolParams, key: string, fallback = ''): string {
  const v = params[key];
  if (typeof v === 'string') return v;
  if (Array.isArray(v)) return v.join(', ');
  if (v !== undefined) return String(v);
  return fallback;
}

function num(params: ToolParams, key: string): number | undefined {
  const v = params[key];
  const n = Number(v);
  return isNaN(n) ? undefined : n;
}

// ─── Ollama Tool Builder ─────────────────────────────────────────────────────

function makeTool(
  name: string,
  description: string,
  properties: Record<string, { type: string; description: string; enum?: string[] }>,
  required: string[]
): Tool {
  return {
    type: 'function',
    function: { name, description, parameters: { type: 'object', required, properties } },
  };
}

// ─── Context & Session State ─────────────────────────────────────────────────

export interface ToolContext {
  repoPath: string;
  workerManager: WorkerManager;
  workerProvider: ILlmProvider;
  storageEngine: LedgerStorageEngine;
  /** Called when proposePlan tool is invoked — before PlanProposedError is thrown. */
  onPlanProposed?: (plan: ProposedPlan) => void;
}

// ─── Factory ────────────────────────────────────────────────────────────────

export function createToolRegistry(ctx: ToolContext): ToolRegistry {
  const diskTooling = new DiskTooling();
  const registry: ToolRegistry = new Map();

  // ── readFile ──────────────────────────────────────────────────────────────
  registry.set('readFile', {
    ollamaTool: makeTool(
      'readFile',
      'Read lines from a source file. Defaults to the first 100 lines. Hard-capped at 300 lines per call.',
      {
        path:      { type: 'string', description: 'File path relative to repo root' },
        startLine: { type: 'number', description: 'First line to read (1-indexed, default: 1)' },
        endLine:   { type: 'number', description: 'Last line to read (default: startLine + 99)' },
      },
      ['path']
    ),
    execute: async (params): Promise<ToolResult> => {
      const filePath = str(params, 'path').trim();
      if (!filePath) return { success: false, output: 'path is required' };

      const absolutePath = path.resolve(ctx.repoPath, filePath);
      if (!(await diskTooling.fileExists(absolutePath))) {
          return { success: false, output: `File not found: ${filePath}` };
      }

      const raw = await diskTooling.readFile(absolutePath);
      const lines = raw.split('\n');
      const total = lines.length;
      const start = Math.max(1, num(params, 'startLine') ?? 1);
      const defaultEnd = Math.min(total, start + 99);
      const requestedEnd = num(params, 'endLine') ?? defaultEnd;
      const end = Math.min(total, requestedEnd, start + 299);

      const slice = lines.slice(start - 1, end);
      const header = `// ${filePath} (lines ${start}–${end} of ${total})\n`;
      return { success: true, output: header + slice.join('\n') };
    },
  });

  // ── listDirectory ─────────────────────────────────────────────────────────
  registry.set('listDirectory', {
    ollamaTool: makeTool(
      'listDirectory',
      'List the immediate contents (files and subdirectories) of a directory. Pass "." or "" for the repo root.',
      {
        path: { type: 'string', description: 'Directory path (e.g. "src/actions", "." for root)' },
      },
      ['path']
    ),
    execute: async (params): Promise<ToolResult> => {
      const dirPath = str(params, 'path').trim();
      const absoluteDirPath = path.resolve(ctx.repoPath, dirPath);

      try {
          const entries = await fs.readdir(absoluteDirPath, { withFileTypes: true });
          if (entries.length === 0) {
              return { success: true, output: `Directory "${dirPath}" is empty.` };
          }
          const lines = entries.map((e) => {
              if (e.isDirectory()) return `📁 ${e.name}/`;
              return `📄 ${e.name}`;
          });
          return { success: true, output: [`${dirPath || 'root'}/:`, ...lines].join('\n') };
      } catch (error) {
          return { success: false, output: `Failed to list directory: ${error instanceof Error ? error.message : String(error)}` };
      }
    },
  });

  // ── searchCodebase ────────────────────────────────────────────────────────
  registry.set('searchCodebase', {
    ollamaTool: makeTool(
      'searchCodebase',
      'Search the repository file tree for paths matching a substring. Returns up to 20 matches.',
      {
        query: { type: 'string', description: 'Substring to search for in file paths (e.g. "auth", "webhook")' },
      },
      ['query']
    ),
    execute: async (params): Promise<ToolResult> => {
      const query = str(params, 'query').trim();
      if (!query) return { success: false, output: 'query is required' };

      try {
        const { stdout } = await execAsync(`find . -maxdepth 4 -not -path "*/.*" -iname "*${query}*" | head -n 20`, { cwd: ctx.repoPath });
        return { success: true, output: stdout.trim() || `No files matching "${query}".` };
      } catch (err) {
        return { success: false, output: `Search failed: ${err instanceof Error ? err.message : String(err)}` };
      }
    },
  });

  // ── searchFileContent ─────────────────────────────────────────────────────
  registry.set('searchFileContent', {
    ollamaTool: makeTool(
      'searchFileContent',
      'Search INSIDE files for a specific string using grep.',
      {
        query: { type: 'string', description: 'String to search for' },
        directory: { type: 'string', description: 'Directory to search in (default: ".")' }
      },
      ['query']
    ),
    execute: async (params): Promise<ToolResult> => {
      const query = str(params, 'query').trim();
      const dir = str(params, 'directory', '.').trim();
      if (!query) return { success: false, output: 'query is required' };

      try {
        const { stdout } = await execAsync(`grep -rnI "${query}" "${dir}" --exclude-dir=node_modules --exclude-dir=.git | head -n 20`, { cwd: ctx.repoPath });
        return { success: true, output: stdout.trim() || `No content matching "${query}" found.` };
      } catch (err: any) {
        if (err.code === 1) return { success: true, output: `No content matching "${query}" found.` };
        return { success: false, output: `Search failed: ${err.message}` };
      }
    },
  });

  // ── searchKnowledgeBase ──────────────────────────────────────────────────
  registry.set('searchKnowledgeBase', {
    ollamaTool: makeTool(
      'searchKnowledgeBase',
      'Search the internal knowledge base for architectural patterns, runbooks, or policies.',
      {
        query:    { type: 'string', description: 'Semantic or keyword query' },
        category: { type: 'string', description: 'Optional category: Runbook, Architecture, Policy, Tutorial', enum: ['Runbook', 'Architecture', 'Policy', 'Tutorial'] }
      },
      ['query']
    ),
    execute: async (params): Promise<ToolResult> => {
      const query    = str(params, 'query').trim();
      const category = str(params, 'category') as KnowledgeCategory | undefined;

      try {
        const results = await ctx.storageEngine.searchKnowledge(query, category);
        if (results.length === 0) return { success: true, output: 'No knowledge entries found matching that query.' };

        const formatted = results.map(e => `[${e.id}] ${e.title} (${e.category})\nTags: ${e.tags.join(', ')}`).join('\n\n');
        return { success: true, output: `Found ${results.length} entries:\n\n${formatted}` };
      } catch (err) {
        return { success: false, output: `KB Search failed: ${err instanceof Error ? err.message : String(err)}` };
      }
    },
  });

  // ── getKnowledgeEntry ────────────────────────────────────────────────────
  registry.set('getKnowledgeEntry', {
    ollamaTool: makeTool(
      'getKnowledgeEntry',
      'Retrieve the full content of a specific knowledge entry by ID.',
      {
        id: { type: 'string', description: 'Knowledge entry ID (e.g. kb-arch-1234)' }
      },
      ['id']
    ),
    execute: async (params): Promise<ToolResult> => {
      const id = str(params, 'id').trim();
      const entry = await ctx.storageEngine.getKnowledgeEntry(id);
      if (!entry) return { success: false, output: `Knowledge entry not found: ${id}` };

      const content = entry.contentBlocks.join('\n\n');
      return { success: true, output: `TITLE: ${entry.title}\nCATEGORY: ${entry.category}\n\n${content}\n\nRelated: ${entry.relatedEntries.join(', ') || 'None'}` };
    },
  });

  // ── publishKnowledge ─────────────────────────────────────────────────────
  registry.set('publishKnowledge', {
    ollamaTool: makeTool(
      'publishKnowledge',
      'Document a successful fix, architectural insight, or runbook entry to the knowledge base.',
      {
        title:          { type: 'string', description: 'Clear title' },
        category:       { type: 'string', description: 'Category', enum: ['Runbook', 'Architecture', 'Policy', 'Tutorial'] },
        tags:           { type: 'string', description: 'Comma-separated tags' },
        content_blocks: { type: 'string', description: 'Markdown content (separate paragraphs/bullets with double newlines)' }
      },
      ['title', 'category', 'content_blocks']
    ),
    execute: async (params): Promise<ToolResult> => {
      const title    = str(params, 'title').trim();
      const category = str(params, 'category') as KnowledgeCategory;
      const tags     = str(params, 'tags').split(',').map(t => t.trim()).filter(Boolean);
      const blocks   = str(params, 'content_blocks').split('\n\n').map(b => b.trim()).filter(Boolean);

      try {
        const entry = await ctx.storageEngine.publishKnowledge({ title, category, tags, contentBlocks: blocks, relatedEntries: [] });
        return { success: true, output: `Knowledge entry published successfully: ${entry.id}` };
      } catch (err) {
        return { success: false, output: `KB Publish failed: ${err instanceof Error ? err.message : String(err)}` };
      }
    },
  });

  // ── concludeInvestigation ─────────────────────────────────────────────────
  registry.set('concludeInvestigation', {
    ollamaTool: makeTool(
      'concludeInvestigation',
      'Call this ONLY if no code changes are needed (e.g. just a question or explanation).',
      {
        report: { type: 'string', description: 'The final answer/explanation for the user.' }
      },
      ['report']
    ),
    execute: async (params): Promise<ToolResult> => {
      const report = str(params, 'report').trim();
      if (!report) return { success: false, output: 'report is required' };
      throw new InvestigationConcludedError(report);
    },
  });

  // ── proposePlan ───────────────────────────────────────────────────────────
  registry.set('proposePlan', {
    ollamaTool: makeTool(
      'proposePlan',
      'Propose an implementation plan for human approval. Call this AFTER investigating the issue and BEFORE writing any code.',
      {
        title:          { type: 'string', description: 'Short plan title' },
        markdown_steps: { type: 'string', description: 'Full Markdown description of the plan' },
        target_files:   { type: 'string', description: 'Comma-separated list of files to be modified' },
      },
      ['title', 'markdown_steps', 'target_files']
    ),
    execute: async (params): Promise<ToolResult> => {
      const title         = str(params, 'title').trim();
      const markdownSteps = str(params, 'markdown_steps').trim();
      const targetFiles   = str(params, 'target_files')
        .split(',')
        .map((f) => f.trim())
        .filter(Boolean);

      if (!title)         return { success: false, output: 'title is required' };
      if (!markdownSteps) return { success: false, output: 'markdown_steps is required' };

      const plan: ProposedPlan = { title, markdownSteps, targetFiles };
      if (ctx.onPlanProposed) ctx.onPlanProposed(plan);
      throw new PlanProposedError(plan);
    },
  });

  // ── delegateToGemini ─────────────────────────────────────────────────────
  registry.set('delegateToGemini', {
    ollamaTool: makeTool(
      'delegateToGemini',
      'Delegate a complex code generation task to Gemini.',
      {
        instruction:   { type: 'string', description: 'Coding instruction' },
        context_files: { type: 'string', description: 'Comma-separated file paths' },
      },
      ['instruction']
    ),
    execute: async (params): Promise<ToolResult> => {
      const instruction  = str(params, 'instruction').trim();
      const contextPaths = str(params, 'context_files').split(',').map((f) => f.trim()).filter(Boolean);

      if (!instruction) return { success: false, output: 'instruction is required' };

      const contextFiles = [];
      for (const filePath of contextPaths.slice(0, 8)) {
          const absolutePath = path.resolve(ctx.repoPath, filePath);
          if (await diskTooling.fileExists(absolutePath)) {
              const content = await diskTooling.readFile(absolutePath);
              contextFiles.push({ path: filePath, content: content.slice(0, 5000) });
          }
      }

      const payload: Omit<WorkerPayload, 'model'> = {
          systemPrompt: "You are an expert software engineer. Implement the task precisely. Output only the code.",
          userPrompt: instruction,
          contextFiles,
      };

      try {
          const settings = await ctx.storageEngine.getSettings();
          const response = await ctx.workerManager.dispatch(payload, ctx.workerProvider, settings.ollamaModel);
          return { success: true, output: response.rawText || "No response content" };
      } catch (error) {
          return { success: false, output: `Worker delegation failed: ${error instanceof Error ? error.message : String(error)}` };
      }
    },
  });

  // ── spawnSubAgent ────────────────────────────────────────────────────────
  registry.set('spawnSubAgent', {
    ollamaTool: makeTool(
      'spawnSubAgent',
      'Spawn a specialized background agent to perform a specific sub-task (e.g. summarize a file, research a bug).',
      {
        role:          { type: 'string', description: 'The role of the sub-agent (e.g. "summarizer", "tester", "researcher")' },
        instruction:   { type: 'string', description: 'The specific instruction for the sub-agent' },
        context_files: { type: 'string', description: 'Comma-separated list of file paths to provide for context' },
      },
      ['role', 'instruction']
    ),
    execute: async (params): Promise<ToolResult> => {
      const role         = str(params, 'role').trim();
      const instruction  = str(params, 'instruction').trim();
      const contextPaths = str(params, 'context_files').split(',').map((f) => f.trim()).filter(Boolean);

      if (!instruction) return { success: false, output: 'instruction is required' };

      const contextFiles = [];
      for (const filePath of contextPaths.slice(0, 10)) {
          const absolutePath = path.resolve(ctx.repoPath, filePath);
          if (await diskTooling.fileExists(absolutePath)) {
              const content = await diskTooling.readFile(absolutePath);
              contextFiles.push({ path: filePath, content: content.slice(0, 10000) });
          }
      }

      const payload: Omit<WorkerPayload, 'model'> = {
          systemPrompt: `You are a specialized sub-agent fulfilling the role of: ${role}. 
Your goal is to provide a concise, expert answer or perform the requested analysis based strictly on the context provided.`,
          userPrompt: instruction,
          contextFiles,
      };

      try {
          const settings = await ctx.storageEngine.getSettings();
          const response = await ctx.workerManager.dispatch(payload, ctx.workerProvider, settings.ollamaModel);
          return { success: true, output: response.rawText || "Sub-agent finished without output." };
      } catch (error) {
          return { success: false, output: `Sub-agent spawn failed: ${error instanceof Error ? error.message : String(error)}` };
      }
    },
  });

  // ── writeFile ────────────────────────────────────────────────────────────
  registry.set('writeFile', {
    ollamaTool: makeTool(
      'writeFile',
      'Write or overwrite a file.',
      {
        path:    { type: 'string', description: 'File path relative to repo root' },
        content: { type: 'string', description: 'Complete new file content (not a diff)' },
      },
      ['path', 'content']
    ),
    execute: async (params): Promise<ToolResult> => {
      const filePath    = str(params, 'path').trim();
      const content = str(params, 'content');

      if (!filePath)    return { success: false, output: 'path is required' };
      if (!content) return { success: false, output: 'content is required' };

      const absolutePath = path.resolve(ctx.repoPath, filePath);
      try {
          await diskTooling.writeFile(absolutePath, content);
          return { success: true, output: `File "${filePath}" written successfully.` };
      } catch (error) {
          return { success: false, output: `Failed to write file: ${error instanceof Error ? error.message : String(error)}` };
      }
    },
  });

  return registry;
}

/** Extract native Ollama Tool definitions from the registry for the API call. */
export function getOllamaTools(registry: ToolRegistry): Tool[] {
  return [...registry.values()].map((t) => t.ollamaTool);
}

/** Convert Ollama's Record<string,unknown> arguments into our ToolParams type. */
export function toToolParams(args: Record<string, unknown>): ToolParams {
  const params: ToolParams = {};
  for (const [key, val] of Object.entries(args)) {
    if (typeof val === 'string' || typeof val === 'number' || typeof val === 'boolean') {
      params[key] = val;
    } else if (Array.isArray(val)) {
      params[key] = val.map(String);
    } else if (val !== null && val !== undefined) {
      params[key] = String(val);
    }
  }
  return params;
}
