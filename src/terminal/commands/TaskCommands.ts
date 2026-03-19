import { CommandDefinition, CommandContext, CommandResult, CommandObject } from './BaseCommand.js';
import { registry } from '../core/registry.js';
import { TaskSummary, ProjectRecord } from '../../infrastructure/storage/types.js';
import * as http from 'node:http';
import chalk from 'chalk';

export const taskListCommand: CommandDefinition = {
  name: 'task:ls',
  description: 'List all tasks via API',
  aliases: ['tasks', 'tl', 'ls'],
  category: 'task',
  options: [
    { flags: '-s, --status <status>', description: 'Filter by status' }
  ],
  execute: async (ctx: CommandContext): Promise<CommandResult> => {
    const status = ctx.options['status'] as string | undefined;
    const tasks = await ctx.client.getTasks(status);

    return {
      success: true,
      title: 'Tasks (from API)',
      table: tasks.map((t: TaskSummary) => ({
        ID: t.id.split('-')[0],
        Status: t.status,
        Assignee: (t.assignees && t.assignees[0]) || 'none',
        Labels: (t.labels && t.labels.length) || 0,
        Title: t.title.slice(0, 40),
        Urgent: t.urgent ? 'Yes' : 'No'
      }))
    };
  }
};

export const taskSolveCommand: CommandDefinition = {
  name: 'task:solve',
  description: 'Start an autonomous task via API',
  aliases: ['solve'],
  category: 'task',
  args: [
    { name: 'objective', description: 'What Ralph should do', required: true }
  ],
  options: [
    { flags: '-p, --project <id>', description: 'Project ID' },
    { flags: '-u, --urgent', description: 'Mark as urgent' },
    { flags: '-l, --label <label>', description: 'Add label' },
    { flags: '-a, --assignee <name>', description: 'Add assignee' },
    { flags: '-m, --milestone <name>', description: 'Set milestone' }
  ],
  execute: async (ctx: CommandContext): Promise<CommandResult> => {
    const objective = ctx.args['objective'];
    let projectId = ctx.options['project'] as string | undefined;

    if (!projectId) {
      const projects = await ctx.client.getProjects();
      const cwd = process.cwd();
      const matched = projects.find((p: ProjectRecord) => cwd.startsWith(p.absolutePath));
      if (!matched) {
        return { success: false, message: 'Project ID required. Run "project:add" first or use -p.' };
      }
      projectId = matched.id;
    }

    if (!objective) return { success: false, message: 'Objective is required' };

    const labels = ctx.options['label'] ? [String(ctx.options['label'])] : [];
    const assignees = ctx.options['assignee'] ? [String(ctx.options['assignee'])] : [];
    const milestone = ctx.options['milestone'] ? String(ctx.options['milestone']) : undefined;

    const result = await ctx.client.createTask(
      'solve', 
      projectId || '', 
      objective, 
      !!ctx.options['urgent'], 
      labels, 
      assignees, 
      milestone
    );

    return {
      success: true,
      message: `Task enqueued: ${result.taskId}. Run "logs ${result.taskId}" to watch.`,
      json: result as CommandObject
    };
  }
};

export const taskApproveCommand: CommandDefinition = {
  name: 'task:approve',
  description: 'Approve a paused task via API',
  aliases: ['approve'],
  category: 'task',
  args: [
    { name: 'taskId', description: 'Task ID or prefix', required: true }
  ],
  execute: async (ctx: CommandContext): Promise<CommandResult> => {
    const taskId = ctx.args['taskId'];
    if (!taskId) return { success: false, message: 'Task ID required' };
    
    await ctx.client.appendMessage(taskId, 'Looks good, proceed.', 'APPROVAL');
    return {
      success: true,
      message: `Task ${taskId} approved via API.`
    };
  }
};

export const taskDiffCommand: CommandDefinition = {
  name: 'task:diff',
  description: 'View the local diff for a task via API',
  aliases: ['diff'],
  category: 'task',
  args: [
    { name: 'taskId', description: 'Task ID or prefix', required: true }
  ],
  execute: async (ctx: CommandContext): Promise<CommandResult> => {
    const taskId = ctx.args['taskId'];
    if (!taskId) return { success: false, message: 'Task ID required' };
    
    const diff = await ctx.client.getDiff(taskId);
    return {
      success: true,
      title: `Diff for task ${taskId}`,
      text: diff
    };
  }
};

export const taskLogsCommand: CommandDefinition = {
  name: 'task:logs',
  description: 'Stream live logs for a task via API SSE',
  aliases: ['logs'],
  category: 'task',
  args: [
    { name: 'taskId', description: 'Task ID or prefix', required: true }
  ],
  options: [
    { flags: '-b, --backlog', description: 'Show recent historical logs for this task' }
  ],
  execute: async (ctx: CommandContext): Promise<CommandResult> => {
    const taskId = ctx.args['taskId'];
    if (!taskId) return { success: false, message: 'Task ID required' };
    
    const backlog = !!ctx.options['backlog'];
    const streamUrl = ctx.client.getStreamUrl(taskId, backlog);
    const log = ctx.log || ((m) => console.log(m));
    log(chalk.blue.bold(`\n--- Streaming logs for task ${taskId}${backlog ? ' (with backlog)' : ''} (Press Ctrl+C to stop) ---\n`));
    
    return new Promise((resolve) => {
      const req = http.get(streamUrl, (res) => {
        let buffer = '';
        res.on('data', (chunk: Buffer) => {
          buffer += chunk.toString();
          const lines = buffer.split('\n\n');
          buffer = lines.pop() || '';

          for (const line of lines) {
            if (line.startsWith('data: ')) {
               try {
                  const event = JSON.parse(line.slice(6));
                  if (event.type === 'FSM_TRANSITION') {
                    log(`[STATE] ${chalk.yellow(event.oldState)} -> ${chalk.green(event.newState)} @ ${chalk.dim(event.timestamp)}`);
                  } else if (event.type === 'WORKER_STREAM') {
                    process.stdout.write(event.chunk);
                  } else if (event.type === 'SPECIALIST_LOG') {
                    const color = event.stream === 'stderr' ? chalk.red : chalk.gray;
                    log(`[${event.specialist}] ${color(event.text.trim())}`);
                  } else if (event.type === 'SYSTEM_LOG' && event.taskId === taskId) {
                    const levelColors: any = { info: chalk.blue, warn: chalk.yellow, error: chalk.red, debug: chalk.magenta };
                    const color = levelColors[event.level] || chalk.white;
                    log(`${chalk.dim(event.timestamp)} ${color(event.level.toUpperCase().padEnd(5))} ${chalk.cyan(`[${event.module}]`)} ${event.message}`);
                  }
               } catch (e) {
                  // Ignore parse errors from partial lines
               }
            }
          }
        });
        
        res.on('end', () => {
          log(chalk.yellow('\nStream closed by server.'));
          resolve({ success: true, message: 'Log stream ended.' });
        });
      });

      req.on('error', (err) => {
        resolve({ success: false, message: `Stream error: ${err.message}` });
      });

      // Handle Ctrl+C locally within this command
      const sigHandler = () => {
        req.destroy();
        log(chalk.yellow('\nStream detached.'));
        process.off('SIGINT', sigHandler);
        resolve({ success: true, message: 'Detached from logs.' });
      };
      process.on('SIGINT', sigHandler);
    });
  }
};

export const taskReviewCommand: CommandDefinition = {
  name: 'task:review',
  description: 'Submit feedback/instructions for a task',
  aliases: ['review'],
  category: 'task',
  args: [
    { name: 'taskId', description: 'Task ID or prefix', required: true },
    { name: 'feedback', description: 'Your message for Ralph', required: true }
  ],
  execute: async (ctx: CommandContext): Promise<CommandResult> => {
    const taskId = ctx.args['taskId']!;
    const feedback = ctx.args['feedback']!;
    await ctx.client.appendMessage(taskId, feedback, 'FEEDBACK');
    return { success: true, message: `Feedback submitted for task ${taskId}.` };
  }
};

export const taskRejectCommand: CommandDefinition = {
  name: 'task:reject',
  description: 'Reject a task and return it to investigation',
  aliases: ['reject'],
  category: 'task',
  args: [
    { name: 'taskId', description: 'Task ID or prefix', required: true }
  ],
  execute: async (ctx: CommandContext): Promise<CommandResult> => {
    const taskId = ctx.args['taskId']!;
    await ctx.client.appendMessage(taskId, 'Rejected by admin. Please rethink and investigation again.', 'REJECT');
    return { success: true, message: `Task ${taskId} rejected. Ralph is refocusing.` };
  }
};

export const taskFinalizeCommand: CommandDefinition = {
  name: 'task:finalize',
  description: 'Approve a task and trigger final commit/push/PR',
  aliases: ['finalize', 'publish'],
  category: 'task',
  args: [
    { name: 'taskId', description: 'Task ID or prefix', required: true }
  ],
  execute: async (ctx: CommandContext): Promise<CommandResult> => {
    const taskId = ctx.args['taskId']!;
    await ctx.client.appendMessage(taskId, 'Approved. Please finalize and push.', 'APPROVAL');
    return { success: true, message: `Finalization requested for task ${taskId}. Watch logs for PR creation.` };
  }
};

registry.register(taskListCommand);
registry.register(taskSolveCommand);
registry.register(taskApproveCommand);
registry.register(taskDiffCommand);
registry.register(taskLogsCommand);
registry.register(taskReviewCommand);
registry.register(taskRejectCommand);
registry.register(taskFinalizeCommand);
