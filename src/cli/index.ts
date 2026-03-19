#!/usr/bin/env node
import { Command } from 'commander';
import { bootstrapTerminal } from '../terminal/core/context.js';
import '../terminal/commands/index.js';
import { registry } from '../terminal/core/registry.js';
import { runCli } from '../terminal/modes/CliMode.js';
import { runRepl } from '../terminal/modes/ReplMode.js';
import { runTui } from '../terminal/modes/TuiMode.js';

const program = new Command();

program.configureHelp({
  sortSubcommands: true
});

program
  .name('ralph')
  .description('Ralph AI Agent CLI')
  .version('2.0.0')
  .option('--repl', 'Run in interactive REPL mode')
  .option('--tui', 'Run in interactive TUI dashboard mode');

const commandGroups: Record<string, Command> = {};

// To track what names we've used at the root level
const rootNames = new Set<string>();

for (const def of registry.all()) {
  let parent: Command = program;
  const parts = def.name.split(':');
  let finalName = def.name;

  if (parts.length > 1) {
    const groupName = parts[0]!;
    if (!commandGroups[groupName]) {
      commandGroups[groupName] = program.command(groupName).description(`${groupName.charAt(0).toUpperCase() + groupName.slice(1)} related commands`);
      rootNames.add(groupName);
    }
    parent = commandGroups[groupName]!;
    finalName = parts.slice(1).join(':');
  } else {
    rootNames.add(def.name);
  }

  const subCmd = parent.command(finalName);
  configureSubcommand(subCmd, def, finalName, true); // true = allow registering aliases on this subcommand

  // ALSO register the full colon-name at the root if it's not already there
  // This supports "ralph task:solve"
  if (parts.length > 1 && !rootNames.has(def.name)) {
    const rootFullName = program.command(def.name);
    configureSubcommand(rootFullName, def, def.name, false);
    rootNames.add(def.name);
  }

  // IF this is a hierarchical command, we ALSO register its sub-aliases at the root level if they don't have colons themselves
  // This allows "ralph solve" even if internally it's "task:solve"
  if (parts.length > 1 && def.aliases) {
    for (const alias of def.aliases) {
      if (!alias.includes(':') && !rootNames.has(alias)) {
        const rootAlias = program.command(alias);
        configureSubcommand(rootAlias, def, alias, false); // false = don't double stack aliases
        rootNames.add(alias);
      }
    }
  }
}

function configureSubcommand(cmd: Command, def: any, nameUsed: string, registerAliases: boolean) {
  cmd.description(def.description);

  if (registerAliases && def.aliases) {
    for (const alias of def.aliases) {
      if (alias !== nameUsed && !alias.includes(':')) {
        cmd.alias(alias);
      }
    }
  }

  if (def.args) {
    for (const argDef of def.args) {
      const argStr = argDef.required ? `<${argDef.name}>` : `[${argDef.name}]`;
      cmd.argument(argStr, argDef.description);
    }
  }

  if (def.options) {
    for (const optDef of def.options) {
      cmd.option(optDef.flags, optDef.description, optDef.default);
    }
  }

  cmd.action(async (...actionArgs) => {
    const deps = await bootstrapTerminal();

    // Command object is always the last arg
    const cmdObj = actionArgs[actionArgs.length - 1] as Command;
    const opts = cmdObj.opts();

    // Construct tokens for executeCommand. 
    // We pass def.name so the executor knows which command to run.
    const tokens = [def.name];

    // Add positionals. They are the non-object args before the command object.
    const positionals = actionArgs.filter(a => typeof a === 'string');
    tokens.push(...positionals);

    // Add flags from commander options
    for (const [key, val] of Object.entries(opts)) {
      if (val === true) {
        tokens.push(`--${key}`);
      } else if (val !== undefined && val !== false) {
        tokens.push(`--${key}`, String(val));
      }
    }

    await runCli(deps, tokens);
  });
}

program.action(async (_options, cmd) => {
  const opts = cmd.opts();
  const deps = await bootstrapTerminal();

  if (opts.tui) {
    await runTui(deps);
  } else if (opts.repl) {
    await runRepl(deps);
  } else {
    program.help();
  }
});

program.parse(process.argv);
