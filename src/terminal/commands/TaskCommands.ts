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
    { flags: '--tdd', description: 'Enable TDD pipeline for this task' },
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
    const useTDD = !!ctx.options['tdd'];

    const result = await ctx.client.createTask(
      'solve', 
      projectId || '', 
      objective, 
      !!ctx.options['urgent'], 
      labels, 
      assignees, 
      milestone,
      useTDD
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
    { name: 'taskId', description: 'Task ID or prefix', required: true },
    { name: 'message', description: 'Optional approval message', required: false }
  ],
  execute: async (ctx: CommandContext): Promise<CommandResult> => {
    const taskId = ctx.args['taskId'];
    const message = ctx.args['message'] || 'Looks good, proceed.';
    if (!taskId) return { success: false, message: 'Task ID required' };
    
    await ctx.client.appendMessage(taskId, message, 'APPROVAL');
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

export const taskPathCommand: CommandDefinition = {
  name: 'task:path',
  description: 'View the visual FSM timeline for a task',
  aliases: ['path'],
  category: 'task',
  args: [
    { name: 'id', description: 'Task ID', required: true }
  ],
  execute: async (ctx: CommandContext): Promise<CommandResult> => {
    const taskId = ctx.args.id as string;
    try {
      const task = await ctx.client.getTask(taskId);
      if (!task.timeline || task.timeline.length === 0) {
        return { success: true, text: 'No timeline events found for this task.' };
      }

      let output = `${chalk.bold.blue('FSM Timeline')} for ${chalk.cyan(taskId)}\n\n`;
      for (const event of task.timeline) {
        let icon = chalk.gray('[ ]');
        if (event.status === 'SUCCESS') icon = chalk.green('[✔]');
        else if (event.status === 'FAILED' || event.status === 'FATAL') icon = chalk.red('[!]');
        else if (event.status === 'YIELD') icon = chalk.yellow('[↺]');

        output += `${icon} ${chalk.bold(event.step.padEnd(15))} ${chalk.dim(`(${event.details})`)}\n`;
      }

      return { success: true, text: output };
    } catch (err: any) {
      return { success: false, message: `Failed to fetch task path: ${err.message}` };
    }
  }
};

export const taskImpactCommand: CommandDefinition = {
  name: 'task:impact',
  description: 'View the Disk Manifest of tools that successfully modified the filesystem or ran commands',
  aliases: ['impact'],
  category: 'task',
  args: [
    { name: 'id', description: 'Task ID', required: true }
  ],
  execute: async (ctx: CommandContext): Promise<CommandResult> => {
    const taskId = ctx.args.id as string;
    try {
      const task = await ctx.client.getTask(taskId);
      if (!task.toolCalls || task.toolCalls.length === 0) {
        return { success: true, text: 'No tool impact recorded for this task.' };
      }

      const filesCreated = new Set<string>();
      const filesModified = new Set<string>();
      const commandsRun: string[] = [];

      for (const call of task.toolCalls) {
        if (!call.result.success) continue;

        const name = call.toolName;
        const args = call.args || {};

        if (name === 'writeFile' || name === 'createFile') {
          if (args.path) filesCreated.add(args.path);
        } else if (name === 'replaceText' || name === 'editFile' || name === 'patchFile') {
          if (args.path) filesModified.add(args.path);
        } else if (name === 'runCommand' || name === 'executeShell' || name === 'exec') {
          if (args.command) commandsRun.push(`${args.command}\n  ${chalk.dim(call.result.output.trim().split('\\n')[0])}`);
        }
      }

      let output = `${chalk.bold.blue('Tool Impact Audit')} for ${chalk.cyan(taskId)}\n\n`;
      
      if (filesCreated.size > 0) {
        output += `${chalk.bold.green('FILES CREATED:')}\n`;
        filesCreated.forEach(f => output += `- ${f}\n`);
        output += '\n';
      }
      
      if (filesModified.size > 0) {
        output += `${chalk.bold.yellow('FILES MODIFIED:')}\n`;
        filesModified.forEach(f => output += `- ${f}\n`);
        output += '\n';
      }

      if (commandsRun.length > 0) {
        output += `${chalk.bold.magenta('COMMANDS RUN:')}\n`;
        commandsRun.forEach(c => output += `- ${c}\n`);
        output += '\n';
      }

      if (filesCreated.size === 0 && filesModified.size === 0 && commandsRun.length === 0) {
        output += chalk.dim('No file modifications or command executions were recorded.');
      }

      return { success: true, text: output.trim() };
    } catch (err: any) {
      return { success: false, message: `Failed to fetch tool impact: ${err.message}` };
    }
  }
};

export const taskSummaryCommand: CommandDefinition = {
  name: 'task:summary',
  description: 'View the Autonomous Post-Mortem summary for a finalized task',
  aliases: ['summary'],
  category: 'task',
  args: [
    { name: 'id', description: 'Task ID', required: true }
  ],
  execute: async (ctx: CommandContext): Promise<CommandResult> => {
    const taskId = ctx.args.id as string;
    try {
      let task = await ctx.client.getTask(taskId);
      
      if (!task.postMortem) {
        if (task.status === 'COMPLETED') {
          console.log(chalk.yellow('Summary missing for completed task. Triggering backfill...'));
          const backfill = await ctx.client.backfillSummary(taskId);
          task.postMortem = backfill.summary;
        } else {
          return { success: true, text: 'No post-mortem summary available for this task. It may not be finalized yet.' };
        }
      }

      const output = `${chalk.bold.blue('Autonomous Post-Mortem')} for ${chalk.cyan(taskId)}\n\n${chalk.white(task.postMortem)}`;
      return { success: true, text: output };
    } catch (err: any) {
      return { success: false, message: `Failed to fetch task summary: ${err.message}` };
    }
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
    { name: 'taskId', description: 'Task ID or prefix', required: true },
    { name: 'message', description: 'Optional reason for rejection', required: false }
  ],
  execute: async (ctx: CommandContext): Promise<CommandResult> => {
    const taskId = ctx.args['taskId']!;
    const message = ctx.args['message'] || 'Rejected by admin. Please rethink and investigation again.';
    await ctx.client.appendMessage(taskId, message, 'REJECT');
    return { success: true, message: `Task ${taskId} rejected. Ralph is refocusing.` };
  }
};

export const taskFinalizeCommand: CommandDefinition = {
  name: 'task:finalize',
  description: 'Approve a task and trigger final commit/push/PR',
  aliases: ['finalize', 'publish', 'commit'],
  category: 'task',
  args: [
    { name: 'taskId', description: 'Task ID or prefix', required: true },
    { name: 'message', description: 'Optional final approval message', required: false }
  ],
  execute: async (ctx: CommandContext): Promise<CommandResult> => {
    const taskId = ctx.args['taskId']!;
    const message = ctx.args['message'] || 'Approved. Please finalize and push.';
    await ctx.client.appendMessage(taskId, message, 'APPROVAL');
    return { success: true, message: `Finalization requested for task ${taskId}. Watch logs for PR creation.` };
  }
};

registry.register(taskListCommand);
registry.register(taskSolveCommand);
registry.register(taskApproveCommand);
registry.register(taskDiffCommand);
registry.register(taskPathCommand);
registry.register(taskImpactCommand);
registry.register(taskSummaryCommand);
registry.register(taskLogsCommand);
registry.register(taskReviewCommand);
registry.register(taskRejectCommand);
registry.register(taskFinalizeCommand);
