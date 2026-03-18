import { RalphClient } from '../core/RalphClient.js';

export interface CommandDependencies {
  client: RalphClient;
  log?: (message: string) => void;
}

export type CommandValue = string | number | boolean | null | undefined;
export type CommandObject = { [key: string]: CommandValue | CommandObject | CommandArray };
export type CommandArray = Array<CommandValue | CommandObject | CommandArray>;

/**
 * CommandResult - Structured output from any command execution.
 * Mode engines (CLI, REPL, TUI) will format this data as they see fit.
 */
export interface CommandResult {
  /** The title/header for the output */
  title?: string;
  /** Tabular data: array of rows (objects) */
  table?: Record<string, CommandValue>[];
  /** Columns to show in the table (if omitted, all keys are shown) */
  columns?: string[];
  /** Freeform text output */
  text?: string;
  /** Raw JSON object for dump */
  json?: CommandValue | CommandObject | CommandArray;
  /** Success/info/error message */
  message?: string;
  /** Was the command successful? */
  success?: boolean;
}

/**
 * CommandContext - Everything a command handler needs to do its job.
 */
export interface CommandContext extends CommandDependencies {
  /** Parsed positional arguments */
  args: Record<string, string>;
  /** Parsed named options */
  options: Record<string, CommandValue>;
  /** Raw argument array (for pass-through) */
  rawArgs: string[];
}

/**
 * CommandDefinition - Declarative metadata for a command.
 * Drop one of these into `commands/` and the registry picks it up automatically.
 */
export interface CommandDefinition {
  /** Primary name (what the user types) */
  name: string;
  /** Short description shown in help */
  description: string;
  /** Optional aliases */
  aliases?: string[];
  /** Category for grouping in help/TUI (e.g. 'data', 'system', 'debug') */
  category?: string;
  /** Positional arguments: name → description */
  args?: { name: string; description: string; required?: boolean }[];
  /** Named options */
  options?: { flags: string; description: string; default?: string }[];
  /** Sub-commands (for hierarchical commands) */
  subcommands?: CommandDefinition[];
  /** If this command is only available in certain modes */
  modes?: ('cli' | 'repl' | 'tui')[];
  /** The execution handler — receives parsed args + context, returns structured result */
  execute: (ctx: CommandContext) => Promise<CommandResult>;
}
