import { Command } from '../types.js';
import { randomUUID } from 'node:crypto';
import { exec } from 'node:child_process';
import { promisify } from 'node:util';
import { WorkerPayload } from '../../llm/types.js';

const execAsync = promisify(exec);

/**
 * /find [keyword] — Searches for file paths.
 */
export const findCommand: Command = {
  name: 'find',
  description: 'Search the repository for file paths matching a keyword.',
  adminOnly: false,
  execute: async (ctx, args) => {
    const query = args.trim();
    if (!query) return;

    try {
      const { stdout } = await execAsync(`find . -maxdepth 4 -not -path "*/.*" -iname "*${query}*" | head -n 20`, { cwd: ctx.project.absolutePath });
      const output = stdout.trim() || `🔍 No files matching **"${query}"** found.`;
      
      ctx.task.thread.messages.push({
        id: randomUUID(),
        author: 'RALPH',
        intent: 'STATUS_UPDATE',
        body: `🔍 **Files matching "${query}":**\n\n${output}`,
        timestamp: new Date().toISOString()
      });
      await ctx.storageEngine.commitTaskRecord(ctx.task);
    } catch (err) {
      console.error('[command:find] Error:', err);
    }
  },
};

/**
 * /explain [file-path] — Explains a file using LLM.
 */
export const explainCommand: Command = {
  name: 'explain',
  description: 'Provide an LLM explanation of what a specific file does.',
  adminOnly: false,
  execute: async (ctx, args) => {
    const filePath = args.trim();
    if (!filePath) return;

    try {
      const settings = await ctx.storageEngine.getSettings();
      const content = await (await import('../../storage/DiskTooling.js')).DiskTooling.prototype.readFile(
          (await import('node:path')).resolve(ctx.project.absolutePath, filePath)
      );

      const payload: Omit<WorkerPayload, 'model'> = {
        systemPrompt: "You are a helpful AI assistant explaining source code.",
        userPrompt: `Explain what the following file does in plain English. Focus on its purpose and key exports:\n\nFile: ${filePath}\n\n\`\`\`typescript\n${content.slice(0, 4000)}\n\`\`\``,
        contextFiles: []
      };

      const response = await ctx.workerManager.dispatch(payload, ctx.llmProvider, settings.ollamaModel);

      ctx.task.thread.messages.push({
        id: randomUUID(),
        author: 'RALPH',
        intent: 'STATUS_UPDATE',
        body: `📖 **File Explanation: \`${filePath}\`**\n\n${response.rawText}`,
        timestamp: new Date().toISOString()
      });
      await ctx.storageEngine.commitTaskRecord(ctx.task);
    } catch (err) {
      console.error('[command:explain] Error:', err);
    }
  },
};
