import { Router } from 'express';
import { ServerDependencies } from '../server.js';
import { AppSettings } from '../../infrastructure/storage/types.js';

export function createSettingsRouter(deps: ServerDependencies): Router {
  const router = Router();

  router.get('/', async (_req, res) => {
    try {
      const settings = await deps.storageEngine.getSettings();
      res.json(settings);
    } catch (error) {
      res.status(500).json({ error: String(error) });
    }
  });

  router.patch('/', async (req, res) => {
    try {
      const updates = req.body as Partial<AppSettings>;
      const ledger = await deps.storageEngine.getLedger();
      
      ledger.settings = {
        ...ledger.settings,
        ...updates
      };

      await deps.storageEngine.commitLedger(ledger);

      // If maxBacklog was updated, apply it to the event bus
      if (updates.maxBacklog !== undefined) {
        deps.eventBus.setMaxBacklog(updates.maxBacklog);
      }

      res.json({ success: true, settings: ledger.settings });
    } catch (error) {
      res.status(500).json({ error: String(error) });
    }
  });

  return router;
}
