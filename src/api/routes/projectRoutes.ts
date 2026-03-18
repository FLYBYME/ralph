import { Router } from 'express';
import { ServerDependencies } from '../server.js';
import { createToolRegistry, toToolParams } from '../../infrastructure/llm/ToolRegistry.js';

export function createProjectRouter(deps: ServerDependencies): Router {
  const router = Router();

  router.get('/', async (_req, res) => {
    try {
      const ledger = await deps.storageEngine.getLedger();
      res.json(ledger.projects);
    } catch (error) {
      res.status(500).json({ error: String(error) });
    }
  });

  router.post('/', async (req, res) => {
    try {
      const { name, absolutePath, defaultBranch, sourceUrl, ciCommands = [] } = req.body;
      const isLocalOnly = !sourceUrl;
      
      let finalPath = absolutePath;

      if (!isLocalOnly) {
        const { exec } = await import('node:child_process');
        const { promisify } = await import('node:util');
        const execAsync = promisify(exec);
        
        const workspacesDir = deps.storageEngine.getWorkspacesDir();
        const safeName = name.replace(/[^a-zA-Z0-9_-]/g, '_');
        finalPath = `${workspacesDir}/${safeName}`;
        
        const fs = await import('node:fs/promises');
        await fs.mkdir(workspacesDir, { recursive: true });

        try {
            await fs.access(finalPath);
            console.log(`[API] Path ${finalPath} already exists. Skipping clone.`);
        } catch {
            console.log(`[API] Cloning ${sourceUrl} to ${finalPath}...`);
            await execAsync(`git clone ${sourceUrl} ${finalPath}`);
        }
      }

      const project = await deps.storageEngine.addProject(name, finalPath || '', defaultBranch, isLocalOnly, sourceUrl, ciCommands);
      res.json(project);
    } catch (error) {
      console.error(error);
      res.status(500).json({ error: String(error) });
    }
  });

  router.get('/:id', async (req, res) => {
    try {
      const project = await deps.storageEngine.getProject(req.params.id);
      if (!project) return res.status(404).json({ error: 'Not found' });
      res.json(project);
    } catch (error) {
      res.status(500).json({ error: String(error) });
    }
  });

  router.post('/:id/tools/:toolName', async (req, res) => {
    try {
      const project = await deps.storageEngine.getProject(req.params.id);
      if (!project) return res.status(404).json({ error: 'Project not found' });

      const registry = createToolRegistry({
        repoPath: project.absolutePath,
        workerManager: deps.workerManager,
        workerProvider: deps.ollamaProvider,
        storageEngine: deps.storageEngine,
      });

      const tool = registry.get(req.params.toolName);
      if (!tool) {
        return res.status(404).json({ error: `Tool ${req.params.toolName} not found` });
      }

      const params = toToolParams(req.body);
      const result = await tool.execute(params);
      res.json(result);
    } catch (error) {
      res.status(500).json({ error: String(error) });
    }
  });

  return router;
}
