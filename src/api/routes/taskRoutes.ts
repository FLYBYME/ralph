import { Router } from 'express';
import { ServerDependencies } from '../server.js';
import { TaskStatus } from '../../infrastructure/storage/types.js';

export function createTaskRouter(deps: ServerDependencies): Router {
  const router = Router();

  router.get('/', async (req, res) => {
    try {
      const ledger = await deps.storageEngine.getLedger();
      let tasks = ledger.tasks;
      if (req.query.status) {
        tasks = tasks.filter(t => t.status === req.query.status);
      }
      if (req.query.projectId) {
        tasks = tasks.filter(t => t.projectId === req.query.projectId);
      }
      res.json(tasks);
    } catch (error) {
      res.status(500).json({ error: String(error) });
    }
  });

  router.post('/', async (req, res) => {
    try {
      const { action: actionId, projectId, input, externalId, urgent, labels, assignees, milestone } = req.body;
      const action = deps.actionRegistry.get(actionId);
      
      if (!action) {
        return res.status(400).json({ error: `Unknown action: ${actionId}` });
      }

      const result = await action.execute({ projectId, input, externalId, urgent, labels, assignees, milestone });
      res.json(result);
    } catch (error) {
      res.status(500).json({ error: String(error) });
    }
  });

  router.get('/:id', async (req, res) => {
    try {
      const task = await deps.storageEngine.getTaskRecord(req.params.id);
      res.json(task);
    } catch (error) {
      res.status(404).json({ error: String(error) });
    }
  });

  router.patch('/:id/status', async (req, res) => {
    try {
      const { status } = req.body;
      if (!status) return res.status(400).json({ error: 'Status is required' });
      await deps.storageEngine.updateTaskStatus(req.params.id, status as TaskStatus);
      res.json({ success: true, status });
    } catch (error) {
      res.status(500).json({ error: String(error) });
    }
  });

  router.patch('/:id/labels', async (req, res) => {
    try {
      const { labels } = req.body;
      if (!Array.isArray(labels)) return res.status(400).json({ error: 'Labels array is required' });
      await deps.storageEngine.updateTaskLabels(req.params.id, labels);
      res.json({ success: true, labels });
    } catch (error) {
      res.status(500).json({ error: String(error) });
    }
  });

  router.patch('/:id/assignees', async (req, res) => {
    try {
      const { assignees } = req.body;
      if (!Array.isArray(assignees)) return res.status(400).json({ error: 'Assignees array is required' });
      await deps.storageEngine.updateTaskAssignees(req.params.id, assignees);
      res.json({ success: true, assignees });
    } catch (error) {
      res.status(500).json({ error: String(error) });
    }
  });

  router.patch('/:id/milestone', async (req, res) => {
    try {
      const { milestone } = req.body;
      if (typeof milestone !== 'string' && milestone !== null) {
          return res.status(400).json({ error: 'Milestone string is required' });
      }
      await deps.storageEngine.updateTaskMilestone(req.params.id, milestone || '');
      res.json({ success: true, milestone });
    } catch (error) {
      res.status(500).json({ error: String(error) });
    }
  });

  router.get('/:id/messages', async (req, res) => {
    try {
      const task = await deps.storageEngine.getTaskRecord(req.params.id);
      res.json(task.thread.messages);
    } catch (error) {
      res.status(404).json({ error: String(error) });
    }
  });

  router.post('/:id/messages', async (req, res) => {
    try {
      const { author = 'HUMAN', body, intent = 'STATUS_UPDATE' } = req.body;
      if (!body) return res.status(400).json({ error: 'Message body is required' });

      await deps.storageEngine.appendMessageToTask(req.params.id, author, body, intent);
      res.json({ success: true, message: 'Message appended' });
    } catch (error) {
      res.status(500).json({ error: String(error) });
    }
  });

  router.get('/:id/artifacts/diff', async (req, res) => {
    try {
      const task = await deps.storageEngine.getTaskRecord(req.params.id);
      const project = await deps.storageEngine.getProject(task.projectId);
      if (!project) return res.status(404).json({ error: 'Project not found' });
      
      const [owner, repo] = project.name.split('/');
      const diff = await deps.remoteProvider.getDiff(owner || '', repo || project.name, req.params.id);
      res.type('text/plain').send(diff);
    } catch (error) {
      res.status(500).json({ error: String(error) });
    }
  });

  router.get('/:id/artifacts/ci-logs', async (req, res) => {
    try {
      const task = await deps.storageEngine.getTaskRecord(req.params.id);
      const project = await deps.storageEngine.getProject(task.projectId);
      if (!project) return res.status(404).json({ error: 'Project not found' });
      
      const [owner, repo] = project.name.split('/');
      const logs = await deps.remoteProvider.getWorkflowLogs(owner || '', repo || project.name, req.params.id as any);
      res.type('text/plain').send(logs);
    } catch (error) {
      res.status(500).json({ error: String(error) });
    }
  });

  return router;
}
