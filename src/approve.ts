import { LedgerStorageEngine } from './infrastructure/storage/LedgerStorageEngine.js';
import { createLogger } from './infrastructure/logging/Logger.js';

const logger = createLogger('cli');

async function approveTask() {
  const taskId = process.argv[2];
  if (!taskId) {
    logger.error('Please provide a task ID as an argument.');
    logger.info('Usage: npx tsx src/approve.ts <task-id>');
    process.exit(1);
  }

  const storage = new LedgerStorageEngine(process.cwd());

  await storage.appendMessageToTask(taskId, 'HUMAN', 'Looks good, proceed.', 'APPROVAL');

  logger.info(`Approved task ${taskId}`);
}

approveTask().catch((err) => logger.error(`Unhandled error: ${err}`));
