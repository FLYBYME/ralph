import { Router } from 'express';
import { ServerDependencies } from '../server.js';

export function createSystemRouter(deps: ServerDependencies): Router {
  const router = Router();

  router.get('/settings', async (_req, res) => {
    try {
      const settings = await deps.storageEngine.getSettings();
      res.json(settings);
    } catch (error) {
      res.status(500).json({ error: String(error) });
    }
  });

  router.patch('/settings', async (req, res) => {
    try {
      const updated = await deps.storageEngine.updateSettings(req.body);
      res.json(updated);
    } catch (error) {
      res.status(500).json({ error: String(error) });
    }
  });

  router.get('/health', async (_req, res) => {
    try {
      const isUp = await deps.ollamaProvider.ping();
      res.json({ status: 'ok', ollamaReachable: isUp });
    } catch (error) {
      res.status(500).json({ status: 'error', error: String(error) });
    }
  });

  return router;
}
