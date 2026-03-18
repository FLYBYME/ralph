import { Router } from 'express';
import { ServerDependencies } from '../server.js';
import { EventType, SystemEvent } from '../../infrastructure/bus/types.js';

export function createStreamRouter(deps: ServerDependencies): Router {
  const router = Router();

  router.get('/', async (req, res) => {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders();

    const taskId = req.query.taskId as string | undefined;
    const includeBacklog = req.query.backlog === 'true';

    const eventTypes: EventType[] = [
      'FSM_TRANSITION',
      'WORKER_STREAM',
      'SPECIALIST_START',
      'SPECIALIST_COMPLETE',
      'SPECIALIST_LOG',
      'TOOL_CALL',
      'SYSTEM_LOG'
    ];

    // 1. Push history from EventBus backlog if requested
    if (includeBacklog) {
      const backlog = deps.eventBus.getBacklog(taskId, eventTypes);
      for (const event of backlog) {
        res.write(`data: ${JSON.stringify(event)}\n\n`);
      }
    }

    // 2. Setup real-time handler
    const handler = (event: SystemEvent) => {
      // If taskId filter is active, only send events matching the ID
      if (taskId && event.taskId !== taskId) return;
      res.write(`data: ${JSON.stringify(event)}\n\n`);
    };

    eventTypes.forEach(type => deps.eventBus.subscribe(type, handler as any));

    req.on('close', () => {
      eventTypes.forEach(type => deps.eventBus.unsubscribe(type, handler as any));
    });
  });

  return router;
}
