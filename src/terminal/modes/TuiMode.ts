import blessed from 'blessed';
import { registry } from '../core/registry.js';
import { executeCommand } from '../core/executor.js';
import { CommandResult, CommandDependencies, CommandValue } from '../commands/BaseCommand.js';

export async function runTui(deps: CommandDependencies) {
  const screen = blessed.screen({
    smartCSR: true,
    title: 'Ralph Terminal Dashboard',
    fullUnicode: true,
  });

  // ── Sidebar: Command List ──
  const sidebar = blessed.list({
    parent: screen,
    label: ' {bold}Commands{/bold} ',
    tags: true,
    top: 0,
    right: 0,
    width: '25%',
    height: '100%-3',
    border: { type: 'line' },
    style: {
      border: { fg: 'cyan' },
      selected: { bg: 'cyan', fg: 'black', bold: true },
      item: { fg: 'white' },
    },
    keys: true,
    vi: true,
    mouse: true,
    scrollable: true,
    scrollbar: { style: { bg: 'cyan' } },
  });

  const categories = registry.byCategory();
  const sidebarItems: string[] = [];
  const commandMap: string[] = [];
  for (const [category, cmds] of categories) {
    sidebarItems.push(`{bold}{cyan-fg}── ${category.toUpperCase()} ──{/cyan-fg}{/bold}`);
    commandMap.push('');
    for (const cmd of cmds) {
      sidebarItems.push(`  ${cmd.name}`);
      commandMap.push(cmd.name);
    }
  }
  sidebar.setItems(sidebarItems);

  // ── Main Output Area ──
  const output = blessed.log({
    parent: screen,
    label: ' {bold}Output{/bold} ',
    tags: true,
    top: 0,
    left: 0,
    width: '75%',
    height: '100%-3',
    border: { type: 'line' },
    style: {
      border: { fg: 'blue' },
      label: { fg: 'blue' },
    },
    scrollable: true,
    scrollbar: { style: { bg: 'blue' } },
    mouse: true,
    keys: true,
    vi: true,
  });

  // ── Input Box ──
  const inputBox = blessed.textbox({
    parent: screen,
    label: ' {bold}Command Input{/bold} ',
    tags: true,
    bottom: 0,
    left: 0,
    width: '100%',
    height: 3,
    border: { type: 'line' },
    style: {
      border: { fg: 'yellow' },
      label: { fg: 'yellow' },
      focus: { border: { fg: 'green' } },
    },
    mouse: true,
  });

  function appendResult(result: CommandResult): void {
    if (result.title) {
      output.log(`{bold}{blue-fg}--- ${result.title} ---{/blue-fg}{/bold}`);
    }
    if (result.message) {
      output.log(result.success !== false
        ? `{green-fg}${result.message}{/green-fg}`
        : `{red-fg}${result.message}{/red-fg}`);
    }
    if (result.table && result.table.length > 0) {
      const table = result.table;
      const firstRow = table[0];
      if (firstRow) {
        const cols = result.columns ?? Object.keys(firstRow);
        output.log(`{bold}${cols.map(c => c.padEnd(15)).join(' | ')}{/bold}`);
        output.log('{gray-fg}' + '-'.repeat(cols.length * 18) + '{/gray-fg}');
        for (const row of table) {
          output.log(cols.map(c => String(row[c] as CommandValue ?? '').padEnd(15)).join(' | '));
        }
      }
    }
    if (result.json !== undefined) {
      output.log(JSON.stringify(result.json, null, 2));
    }
    if (result.text) {
      output.log(result.text);
    }
    screen.render();
  }

  inputBox.on('submit', async (value: string) => {
    const commandText = value.trim();
    inputBox.clearValue();
    if (!commandText) {
       inputBox.readInput();
       return;
    }
    
    output.log(`{yellow-fg}> ${commandText}{/yellow-fg}`);
    const result = await executeCommand({ ...deps, log: (m) => {
        output.log(m);
        screen.render();
    } }, commandText);
    if (result) appendResult(result);
    
    inputBox.readInput();
    screen.render();
  });

  sidebar.on('select', async (_item: blessed.Widgets.ListElement, index: number) => {
    const cmdName = commandMap[index];
    if (!cmdName) return;
    
    const cmd = registry.get(cmdName);
    if (cmd && cmd.args && cmd.args.length > 0) {
      inputBox.setValue(`${cmdName} `);
      inputBox.focus();
      inputBox.readInput();
    } else {
      output.log(`{yellow-fg}> ${cmdName}{/yellow-fg}`);
      const result = await executeCommand({ ...deps, log: (m) => {
        output.log(m);
        screen.render();
      } }, cmdName);
      if (result) appendResult(result);
    }
    screen.render();
  });

  screen.key(['q', 'escape', 'C-c'], () => process.exit(0));
  screen.key(['tab'], () => {
    if (inputBox === screen.focused) sidebar.focus();
    else if (sidebar === screen.focused) output.focus();
    else {
        inputBox.focus();
        inputBox.readInput();
    }
    screen.render();
  });

  // Explicitly handle SIGINT for Ctrl+C
  process.on('SIGINT', () => process.exit(0));

  output.log('{bold}{blue-fg}Ralph Terminal Dashboard{/blue-fg}{/bold}');
  output.log('Connected to API. Type commands or use sidebar list.');
  
  inputBox.focus();
  inputBox.readInput();
  screen.render();
}
