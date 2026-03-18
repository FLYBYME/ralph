import { CommandResult, CommandContext, CommandDependencies, CommandValue } from '../commands/BaseCommand.js';
import { registry } from './registry.js';
import { parseArgs } from '../utils/parser.js';
import chalk from 'chalk';
import { createLogger } from '../../infrastructure/logging/Logger.js';

const logger = createLogger('terminal');

/**
 * Render a CommandResult to the terminal (shared by CLI and REPL modes).
 */
export function renderResult(result: CommandResult): void {
  if (result.title) {
    logger.info(`--- ${result.title} ---`);
  }

  if (result.message) {
    if (result.success !== false) {
      logger.info(result.message);
    } else {
      logger.error(result.message);
    }
  }

  if (result.table && result.table.length > 0) {
    const table = result.table;
    const firstRow = table[0];
    if (firstRow) {
      const cols = result.columns ?? Object.keys(firstRow);
      const header = chalk.bold(cols.map(c => c.padEnd(20)).join(' | '));
      const separator = chalk.gray('-'.repeat(cols.length * 23));
      logger.info(header);
      logger.info(separator);
      for (const row of table) {
        const line = cols.map(c => String(row[c] ?? '').padEnd(20)).join(' | ');
        logger.info(line);
      }
      logger.info(`${table.length} record(s)`);
    }
  }

  if (result.json !== undefined) {
    logger.info(JSON.stringify(result.json, null, 2));
  }

  if (result.text) {
    logger.info(result.text);
  }
}

/**
 * Parse a raw argv array into a CommandContext for a given command.
 */
export function buildContext(
  deps: CommandDependencies,
  commandArgs: string[],
  argDefs?: { name: string; description: string; required?: boolean }[],
  optionDefs?: { flags: string; description: string; default?: string }[]
): CommandContext {
  const args: Record<string, string> = {};
  const options: Record<string, CommandValue> = {};
  const rawArgs: string[] = [];

  // Create a mapping of all possible flag strings to their canonical name
  const flagToCanonical = new Map<string, string>();
  for (const opt of optionDefs ?? []) {
    // split flags like "-b, --backlog" or "--project <id>"
    const flags = opt.flags.split(',').map(f => {
        const cleaned = f.trim().split(' ')[0]!.replace(/^-+/, '');
        return cleaned;
    });
    const longFlag = flags.find(f => f.length > 1);
    const shortFlag = flags.find(f => f.length === 1);
    const canonical = longFlag || shortFlag;
    if (canonical) {
      for (const f of flags) {
        flagToCanonical.set(f, canonical);
      }
    }
  }

  let positionalIndex = 0;
  const positionalDefs = argDefs ?? [];

  for (let i = 0; i < commandArgs.length; i++) {
    const token = commandArgs[i];
    if (token === undefined) continue;

    if (token.startsWith('-')) {
      const match = token.match(/^-+([a-zA-Z0-9_-]+)/);
      if (match) {
        const rawKey = match[1]!;
        const canonicalKey = flagToCanonical.get(rawKey) || rawKey;

        const next = commandArgs[i + 1];
        if (next !== undefined && !next.startsWith('-')) {
          options[canonicalKey] = next;
          i++;
          rawArgs.push(token, next);
        } else {
          options[canonicalKey] = true;
          rawArgs.push(token);
        }
      }
    } else {
      const argDef = positionalDefs[positionalIndex];
      if (argDef) {
        args[argDef.name] = token;
      }
      positionalIndex++;
      rawArgs.push(token);
    }
  }

  for (const opt of optionDefs ?? []) {
    const flags = opt.flags.split(',').map(f => f.trim().split(' ')[0]!.replace(/^-+/, ''));
    const longFlag = flags.find(f => f.length > 1);
    const shortFlag = flags.find(f => f.length === 1);
    const canonical = longFlag || shortFlag;
    if (canonical && options[canonical] === undefined && opt.default !== undefined) {
      options[canonical] = opt.default;
    }
  }

  return { ...deps, args, options, rawArgs };
}

/**
 * Execute a single command line (string or pre-parsed tokens).
 */
export async function executeCommand(
  deps: CommandDependencies,
  input: string | string[]
): Promise<CommandResult | null> {
  const tokens = typeof input === 'string' ? parseArgs(input) : input;
  if (tokens.length === 0) return null;

  const cmdName = tokens[0];
  if (!cmdName) return null;
  const cmd = registry.get(cmdName);

  if (!cmd) {
    return { success: false, message: `Unknown command: ${cmdName}. Type "help" for available commands.` };
  }

  const ctx = buildContext(deps, tokens.slice(1), cmd.args, cmd.options);

  for (const argDef of cmd.args ?? []) {
    if (argDef.required && !ctx.args[argDef.name]) {
      return { success: false, message: `Missing required argument: <${argDef.name}>. Run "help ${cmd.name}" for usage.` };
    }
  }

  try {
    return await cmd.execute(ctx as CommandContext);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return { success: false, message: `Command error: ${message}` };
  }
}
