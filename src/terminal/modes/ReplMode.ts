import * as readline from 'node:readline';
import { executeCommand, renderResult } from '../core/executor.js';
import chalk from 'chalk';
import { CommandDependencies } from '../commands/BaseCommand.js';
import { createLogger } from '../../infrastructure/logging/Logger.js';

const logger = createLogger('terminal');

export async function runRepl(deps: CommandDependencies) {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    prompt: chalk.cyan('ralph> ')
  });

  logger.info('Ralph Interactive Shell');
  logger.info('Type "help" for a list of commands, or "exit" to quit.\n');

  rl.prompt();

  rl.on('line', async (line) => {
    const input = line.trim();
    if (input) {
      const result = await executeCommand({ ...deps, log: (m) => console.log(m) }, input);
      if (result) renderResult(result);
    }
    rl.prompt();
  }).on('SIGINT', () => {
    // If a command is running, it will have its own SIGINT listener via process
    // We just want to make sure the REPL itself doesn't die. 
    // Usually we'd want to kill the subprocess, but since commands are internal promses,
    // they follow process.on('SIGINT') which we register inside them.
    rl.write('\n');
    rl.prompt();
  }).on('close', () => {
    logger.info('Goodbye!');
    process.exit(0);
  });
}
