import { Router } from 'express';
import { ServerDependencies } from '../server.js';
import { ChatMessage } from '../../infrastructure/storage/types.js';
import { LlmMessage } from '../../infrastructure/llm/types.js';
import { createToolRegistry } from '../../infrastructure/llm/ToolRegistry.js';

export function createChatRouter(deps: ServerDependencies): Router {
  const router = Router();

  // Create a new project-level chat session
  router.post('/', async (req, res) => {
    try {
      const { projectId } = req.body;
      if (!projectId) return res.status(400).json({ error: 'ProjectId is required' });

      const session = await deps.storageEngine.createChatSession(projectId);
      res.status(201).json(session);
    } catch (error) {
      res.status(500).json({ error: String(error) });
    }
  });

  // Get all chat sessions for a project
  router.get('/project/:projectId', async (req, res) => {
    try {
      const sessions = await deps.storageEngine.getChatSessionsForProject(req.params.projectId);
      res.json(sessions);
    } catch (error) {
      res.status(500).json({ error: String(error) });
    }
  });

  // Get a specific session
  router.get('/:id', async (req, res) => {
    try {
      const session = await deps.storageEngine.getChatSession(req.params.id);
      res.json(session);
    } catch (error) {
      res.status(404).json({ error: String(error) });
    }
  });

  // Chat within a session
  router.post('/:id/messages', async (req, res) => {
    try {
      const { message } = req.body;
      if (!message) return res.status(400).json({ error: 'Message is required' });

      const sessionId = req.params.id;
      const session = await deps.storageEngine.getChatSession(sessionId);
      const project = await deps.storageEngine.getProject(session.projectId);
      if (!project) return res.status(404).json({ error: 'Project not found' });

      // 1. Append User Message
      await deps.storageEngine.appendMessageToChatSession(sessionId, 'HUMAN', message);

      // 2. Build History (last 10 messages)
      const recentMessages = session.messages.slice(-10);
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

      const systemPrompt = `You are "Ralph", a helpful AI programming assistant. You are currently in a project-level chat session for "${project.name}".
      
      You have access to the codebase via tools.
      Feel free to explore the repository to answer architectural questions or explain logic.`;

      // 4. Dispatch to WorkerManager
      const settings = await deps.storageEngine.getSettings();
      const result = await deps.workerManager.reactDispatch({
        model: settings.ollamaModel,
        systemPrompt,
        initialPrompt: message,
        provider: deps.ollamaProvider,
        tools: registry,
        maxIterations: settings.maxReActTurns || 20,
        taskId: `chat-${sessionId.slice(0, 8)}`,
        history
      });

      // 5. Append Ralph's response
      await deps.storageEngine.appendMessageToChatSession(sessionId, 'RALPH', result.finalAnswer);

      res.json({ response: result.finalAnswer });
    } catch (error) {
      res.status(500).json({ error: String(error) });
    }
  });

  return router;
}
