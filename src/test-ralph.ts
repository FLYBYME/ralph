import { LedgerStorageEngine } from './infrastructure/storage/LedgerStorageEngine.js';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { createLogger } from './infrastructure/logging/Logger.js';

const logger = createLogger('test');

async function setupTest() {
  const storage = new LedgerStorageEngine(process.cwd());
  await storage.bootstrapEnvironment();

  const playgroundPath = path.join(process.cwd(), 'playground');
  await fs.mkdir(playgroundPath, { recursive: true });
  
  // Basic Dockerfile for CI tests
  await fs.writeFile(path.join(playgroundPath, 'Dockerfile'), 'FROM alpine\nCMD ["echo", "Tests Passed"]');
  await fs.writeFile(path.join(playgroundPath, 'README.md'), '# Test Project\n');

  logger.info('--- Setting up Test Case ---');

  // 1. Add the project
  const project = await storage.addProject(
    'test/playground',
    playgroundPath,
    'main'
  );
  logger.info(`Project Registered: ${project.id} at ${playgroundPath}`);

  // 2. Create a task
  const task = await storage.createTask(
    project.id,
    'Add documentation',
    'Please create a CONTRIBUTING.md file in the root of the project with basic guidelines.'
  );
  logger.info(`Task Created: ${task.id}`);
  logger.info('\nNow run: npm start');
}

setupTest().catch((err) => logger.error(`Setup failed: ${err}`));
