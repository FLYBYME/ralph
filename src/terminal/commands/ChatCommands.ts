import { registry } from '../core/registry.js';
import { CommandDependencies, CommandContext } from './BaseCommand.js';
import chalk from 'chalk';
import * as readline from 'node:readline';

async function runChatMode(deps: CommandDependencies, sessionId: string, type: 'task' | 'project') {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    prompt: chalk.magenta('ralph-chat> ')
  });

  console.log(chalk.bold(`\n--- Ralph Chat Session (${type}:${sessionId.slice(0, 8)}) ---`));
  console.log(chalk.dim('Type your messages here. Type "exit" or press Ctrl+C to end.\n'));

  rl.prompt();

  for await (const line of rl) {
    const message = line.trim();
    if (message.toLowerCase() === 'exit' || message.toLowerCase() === 'quit') {
      rl.close();
      break;
    }

    if (!message) {
      rl.prompt();
      continue;
    }

    try {
      let result;
      if (type === 'task') {
        result = await deps.client.chatTask(sessionId, message);
      } else {
        result = await deps.client.chatProject(sessionId, message);
      }
      
      console.log(`\n${chalk.blue.bold('Ralph:')} ${result.response}\n`);
    } catch (err) {
      console.error(chalk.red(`Error: ${err instanceof Error ? err.message : String(err)}`));
    }
    rl.prompt();
  }

  console.log(chalk.yellow('\nEnding chat session.'));
}

registry.register({
  name: 'chat:start',
  description: 'Start an interactive chat session for a specific task.',
  args: [{ name: 'taskId', description: 'The task ID to chat about', required: true }],
  execute: async (ctx: CommandContext) => {
    const taskId = ctx.args.taskId!;
    await runChatMode(ctx, taskId, 'task');
    return { success: true, message: 'Chat finished.' };
  }
});

registry.register({
  name: 'chat:project',
  description: 'Start a project-level chat session.',
  args: [{ name: 'projectId', description: 'The project ID to chat about', required: true }],
  execute: async (ctx: CommandContext) => {
    const projectId = ctx.args.projectId!;
    // For simplicity, we'll create a new session or reuse the latest one
    const sessions = await ctx.client.getChatSessions(projectId);
    let sessionId;
    if (sessions.length > 0) {
      sessionId = sessions[0].id;
    } else {
      const newSession = await ctx.client.createChatSession(projectId);
      sessionId = newSession.id;
    }
    await runChatMode(ctx, sessionId, 'project');
    return { success: true, message: 'Chat finished.' };
  }
});

registry.register({
  name: 'chat:sessions',
  description: 'List recent chat sessions for a project.',
  args: [{ name: 'projectId', description: 'Project ID', required: true }],
  execute: async (ctx: CommandContext) => {
    const sessions = await ctx.client.getChatSessions(ctx.args.projectId!);
    if (sessions.length === 0) return { success: true, message: 'No chat sessions found for this project.' };
    
    console.log(chalk.bold('\nChat Sessions:'));
    for (const s of sessions) {
      console.log(`${chalk.yellow(s.id.slice(0, 8))} - Updated: ${s.updatedAt}`);
    }
    return { success: true };
  }
});
