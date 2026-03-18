import express from 'express';
import { LedgerStorageEngine } from '../infrastructure/storage/LedgerStorageEngine.js';
import { ActionRegistry } from '../infrastructure/actions/ActionRegistry.js';
import { LocalEventBus } from '../infrastructure/bus/LocalEventBus.js';
import { IRemoteProvider } from '../infrastructure/remote/types.js';
import { ILlmProvider } from '../infrastructure/llm/types.js';
import { WorkerManager } from '../infrastructure/llm/WorkerManager.js';

import { createProjectRouter } from './routes/projectRoutes.js';
import { createTaskRouter } from './routes/taskRoutes.js';
import { createSystemRouter } from './routes/systemRoutes.js';
import { createStreamRouter } from './routes/streamRoutes.js';
import { createSettingsRouter } from './routes/settingsRoutes.js';
import { createLogger } from '../infrastructure/logging/Logger.js';

export interface ServerDependencies {
  storageEngine: LedgerStorageEngine;
  actionRegistry: ActionRegistry;
  eventBus: LocalEventBus;
  remoteProvider: IRemoteProvider;
  ollamaProvider: ILlmProvider;
  workerManager: WorkerManager;
}

export function startServer(port: number, deps: ServerDependencies) {
  const app = express();
  app.use(express.json());

  const logger = createLogger('api', deps.eventBus);

  app.use((req, _res, next) => {
    logger.debug(`${req.method} ${req.url}`);
    next();
  });

  // Use modular routes
  app.use('/api/projects', createProjectRouter(deps));
  app.use('/api/tasks', createTaskRouter(deps));
  app.use('/api/system', createSystemRouter(deps));
  app.use('/api/stream', createStreamRouter(deps));
  app.use('/api/settings', createSettingsRouter(deps));

  // Health check alias (optional)
  app.get('/health', (_req, res) => res.json({ status: 'ok' }));

  return new Promise<void>((resolve) => {
    app.listen(port, () => {
      logger.info(`Server listening on port ${port}`);
      resolve();
    });
  });
}
