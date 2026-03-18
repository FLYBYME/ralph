import { CommandDefinition, CommandContext, CommandResult } from './BaseCommand.js';
import { registry } from '../core/registry.js';
import chalk from 'chalk';
import * as http from 'node:http';

export const helpCommand: CommandDefinition = {
  name: 'help',
  description: 'Show available commands',
  aliases: ['?'],
  category: 'system',
  args: [
    { name: 'command', description: 'Command to get help for', required: false }
  ],
  execute: async (ctx: CommandContext): Promise<CommandResult> => {
    const target = ctx.args.command;
    if (target) {
      const cmd = registry.get(target);
      if (!cmd) return { success: false, message: `Unknown command: ${target}` };
      
      let helpText = `${chalk.bold(cmd.name)} - ${cmd.description}\n\n`;
      if (cmd.aliases) helpText += `${chalk.dim('Aliases:')} ${cmd.aliases.join(', ')}\n`;
      if (cmd.args) {
        helpText += `${chalk.dim('Arguments:')}\n`;
        cmd.args.forEach(a => helpText += `  <${a.name}> ${a.description}${a.required ? ' (required)' : ''}\n`);
      }
      if (cmd.options) {
        helpText += `${chalk.dim('Options:')}\n`;
        cmd.options.forEach(o => helpText += `  ${o.flags} ${o.description}\n`);
      }
      return { success: true, text: helpText };
    }

    let text = `${chalk.blue.bold('Ralph AI Agent - Help')}\n\n`;
    const groups = registry.byCategory();
    for (const [cat, cmds] of groups) {
      text += `${chalk.yellow.bold(cat.toUpperCase())}\n`;
      cmds.forEach(c => {
        text += `  ${c.name.padEnd(15)} ${chalk.dim(c.description)}\n`;
      });
      text += '\n';
    }
    return { success: true, text };
  }
};

export const exitCommand: CommandDefinition = {
  name: 'exit',
  description: 'Exit the REPL/TUI',
  aliases: ['quit'],
  category: 'system',
  execute: async (): Promise<CommandResult> => {
    process.exit(0);
  }
};

export const streamCommand: CommandDefinition = {
  name: 'stream',
  description: 'Monitor all system events and task logs in real-time',
  options: [
    { flags: '-b, --backlog', description: 'Show the most recent history from the log backlog' }
  ],
  execute: async (ctx: CommandContext): Promise<CommandResult> => {
    const backlog = !!ctx.options['backlog'];
    const streamUrl = ctx.client.getStreamUrl(undefined, backlog);
    const log = ctx.log || ((m) => console.log(m));
    log(chalk.magenta.bold(`\n--- Global System Stream${backlog ? ' (with backlog)' : ''} (Press Ctrl+C to stop) ---\n`));
    
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
                  const taskPrefix = event.taskId ? `[${chalk.cyan(event.taskId.split('-')[0])}] ` : '';
                  
                  if (event.type === 'FSM_TRANSITION') {
                    log(`${taskPrefix}${chalk.yellow(event.oldState)} -> ${chalk.green(event.newState)} @ ${chalk.dim(event.timestamp)}`);
                  } else if (event.type === 'WORKER_STREAM') {
                    process.stdout.write(event.chunk);
                  } else if (event.type === 'SPECIALIST_LOG') {
                    const color = event.stream === 'stderr' ? chalk.red : chalk.gray;
                    log(`${taskPrefix}[${event.specialist}] ${color(event.text.trim())}`);
                  } else if (event.type === 'TOOL_CALL') {
                    log(`${taskPrefix}${chalk.blue('TOOL')} ${chalk.bold(event.toolName)}(${JSON.stringify(event.args)}) -> ${event.result.success ? '✅' : '❌'}`);
                  } else if (event.type === 'SYSTEM_LOG') {
                    const levelColors: any = { info: chalk.blue, warn: chalk.yellow, error: chalk.red, debug: chalk.magenta };
                    const color = levelColors[event.level] || chalk.white;
                    log(`${chalk.dim(event.timestamp)} ${color(event.level.toUpperCase().padEnd(5))} ${chalk.cyan(`[${event.module}]`)} ${taskPrefix}${event.message}`);
                  }
               } catch (e) {
                  // Ignore
               }
            }
          }
        });
        
        res.on('end', () => {
          console.log(chalk.yellow('\nStream closed by server.'));
          resolve({ success: true, message: 'Global stream ended.' });
        });
      });

      req.on('error', (err) => {
        resolve({ success: false, message: `Stream error: ${err.message}` });
      });

      const sigHandler = () => {
        req.destroy();
        console.log(chalk.yellow('\nStream detached.'));
        process.off('SIGINT', sigHandler);
        resolve({ success: true, message: 'Detached from global stream.' });
      };
      process.on('SIGINT', sigHandler);
    });
  }
};

export const configCommand: CommandDefinition = {
  name: 'config',
  description: 'View or update system configuration',
  category: 'system',
  args: [
    { name: 'key', description: 'Setting key to update', required: false },
    { name: 'value', description: 'New value for the key', required: false }
  ],
  execute: async (ctx: CommandContext): Promise<CommandResult> => {
    const { key, value } = ctx.args;

    if (!key) {
      // GET /api/settings
      const settings = await ctx.client.getSettings();
      let text = `${chalk.blue.bold('Current Configuration:')}\n\n`;
      Object.entries(settings).forEach(([k, v]) => {
        text += `  ${chalk.cyan(k.padEnd(25))} : ${chalk.yellow(v)}\n`;
      });
      return { success: true, text };
    }

    if (key && value === undefined) {
        return { success: false, message: 'Value is required when updating a key.' };
    }

    // PATCH /api/settings
    // Cast value according to expected type if possible
    let typedValue: any = value;
    if (value === 'true') typedValue = true;
    else if (value === 'false') typedValue = false;
    else if (!isNaN(Number(value))) typedValue = Number(value);

    try {
        const result = await ctx.client.patchSettings({ [key]: typedValue });
        return { success: true, message: `Updated ${key} to ${typedValue}`, text: JSON.stringify(result.settings, null, 2) };
    } catch (err) {
        return { success: false, message: `Failed to update ${key}: ${err}` };
    }
  }
};

registry.register(helpCommand);
registry.register(exitCommand);
registry.register(streamCommand);
registry.register(configCommand);
