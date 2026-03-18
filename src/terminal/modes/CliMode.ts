import { executeCommand, renderResult } from '../core/executor.js';
import { CommandDependencies } from '../commands/BaseCommand.js';

export async function runCli(deps: CommandDependencies, args: string[]) {
  const result = await executeCommand({ ...deps, log: (m) => console.log(m) }, args);
  if (result) {
    renderResult(result);
    if (result.success === false) {
      process.exit(1);
    }
  }
}
