import { LedgerStorageEngine } from '../../infrastructure/storage/LedgerStorageEngine.js';
import { RalphClient } from './RalphClient.js';
import { CommandDependencies } from '../commands/BaseCommand.js';

export async function bootstrapTerminal(): Promise<CommandDependencies> {
  const envStorage = new LedgerStorageEngine(process.cwd());
  await envStorage.bootstrapEnvironment();
  const settings = await envStorage.getSettings();

  const client = new RalphClient(settings.serverPort);

  return { client };
}
