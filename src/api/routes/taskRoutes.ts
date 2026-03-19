import { Router } from 'express';
import { ServerDependencies } from '../server.js';
import { TaskStatus, ChatMessage, FsmStep } from '../../infrastructure/storage/types.js';
import { LlmMessage } from '../../infrastructure/llm/types.js';
import { createToolRegistry } from '../../infrastructure/llm/ToolRegistry.js';

export function createTaskRouter(deps: ServerDependencies): Router {
  const router = Router();

  router.get('/:id/subtasks', async (req, res) => {
    try {
      const task = await deps.storageEngine.getTaskRecord(req.params.id);
      res.json(task.context.planning.subTasks || []);
    } catch (error) {
      res.status(404).json({ error: String(error) });
    }
  });

  router.patch('/:id/subtasks/:subTaskId', async (req, res) => {
    try {
      const { status, result } = req.body;
      const taskId = req.params.id;
      const subTaskId = req.params.subTaskId;

      await deps.storageEngine.mutateTaskRecord(taskId, async (record) => {
        const subTask = record.context.planning.subTasks.find(s => s.id === subTaskId);
        if (subTask) {
          if (status) subTask.status = status;
          if (result) subTask.result = result;
        }
      });
      res.json({ success: true });
    } catch (error) {
      res.status(500).json({ error: String(error) });
    }
  });

  router.post('/:id/delegate', async (req, res) => {
    try {
      const { specialist, instruction, context_files } = req.body;
      const project = await deps.storageEngine.getProject((await deps.storageEngine.getTaskRecord(req.params.id)).projectId);
      if (!project) return res.status(404).json({ error: 'Project not found' });

      const registry = createToolRegistry({
        repoPath: project.absolutePath,
        workerManager: deps.workerManager,
        workerProvider: deps.ollamaProvider,
        storageEngine: deps.storageEngine
      });

      const tool = registry.get('spawnSubAgent');
      if (!tool) return res.status(500).json({ error: 'Delegation tool not found' });

      const result = await tool.execute({ role: specialist, instruction, context_files });
      res.json(result);
    } catch (error) {
      res.status(500).json({ error: String(error) });
    }
  });

  router.get('/:id/audit', async (req, res) => {
    try {
      const logs = await deps.storageEngine.getAuditLogs(req.params.id);
      res.json(logs);
    } catch (error) {
      res.status(500).json({ error: String(error) });
    }
  });

  router.post('/:id/step/jump', async (req, res) => {
    try {
      const { step } = req.body;
      if (!Object.values(FsmStep).includes(step as FsmStep)) {
        return res.status(400).json({ error: 'Invalid step' });
      }
      await deps.storageEngine.mutateTaskRecord(req.params.id, async (record) => {
        record.context.currentStep = step as FsmStep;
      });
      res.json({ success: true, step });
    } catch (error) {
      res.status(500).json({ error: String(error) });
    }
  });

  router.delete('/:id', async (req, res) => {
    try {
      await deps.storageEngine.deleteTask(req.params.id);
      res.json({ success: true });
    } catch (error) {
      res.status(500).json({ error: String(error) });
    }
  });

  router.get('/:id/context', async (req, res) => {
    try {
      const task = await deps.storageEngine.getTaskRecord(req.params.id);
      res.json(task.context);
    } catch (error) {
      res.status(404).json({ error: String(error) });
    }
  });

  router.post('/:id/chat', async (req, res) => {
    try {
      const { message } = req.body;
      if (!message) return res.status(400).json({ error: 'Message is required' });

      const taskId = req.params.id;
      const task = await deps.storageEngine.getTaskRecord(taskId);
      const project = await deps.storageEngine.getProject(task.projectId);
      if (!project) return res.status(404).json({ error: 'Project not found' });

      // 1. Append User Message
      await deps.storageEngine.appendMessageToTask(taskId, 'HUMAN', message, 'CHAT');

      // 2. Build History (last 10 messages)
      const recentMessages = task.thread.messages.slice(-10);
      const history: LlmMessage[] = recentMessages.map((m: ChatMessage) => ({
        role: m.author === 'HUMAN' ? 'user' : 'assistant',
        content: m.body
      }));

      // 3. Prepare Tools and Registry
      const registry = createToolRegistry({
        repoPath: project.absolutePath,
        workerManager: deps.workerManager,
        workerProvider: deps.ollamaProvider,
        storageEngine: deps.storageEngine
      });

      const systemPrompt = `You are "Ralph", a helpful AI programming assistant. You are currently in a chat session regarding Task "${task.objective.title}".
      
      You have access to tools to help you answer questions or perform actions.
      If you are just chatting or explaining, use standard text.
      If the user asks you to do something that requires repository access, use your tools.
      
      TASK OBJECTIVE: ${task.objective.title}
      TASK DESCRIPTION: ${task.objective.originalPrompt}
      CURRENT FSM STEP: ${task.context.currentStep}`;

      // 4. Dispatch to WorkerManager
      const settings = await deps.storageEngine.getSettings();
      const result = await deps.workerManager.reactDispatch({
        model: settings.ollamaModel,
        systemPrompt,
        initialPrompt: message,
        provider: deps.ollamaProvider,
        tools: registry,
        taskId: taskId,
        history
      });

      // 5. Append Ralph's response
      await deps.storageEngine.appendMessageToTask(taskId, 'RALPH', result.finalAnswer, 'CHAT');

      res.json({ response: result.finalAnswer });
    } catch (error) {
      res.status(500).json({ error: String(error) });
    }
  });

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
      const { action: actionId, projectId, input, externalId, urgent, labels, assignees, milestone, useTDD } = req.body;
      const action = deps.actionRegistry.get(actionId);
      
      if (!action) {
        return res.status(400).json({ error: `Unknown action: ${actionId}` });
      }

      const result = await action.execute({ projectId, input, externalId, urgent, labels, assignees, milestone, useTDD });
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
