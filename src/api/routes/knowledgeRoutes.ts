import { Router } from 'express';
import { ServerDependencies } from '../server.js';
import { KnowledgeCategory } from '../../infrastructure/storage/types.js';

export function createKnowledgeRouter(deps: ServerDependencies): Router {
  const router = Router();

  router.get('/', async (req, res) => {
    try {
      const { query, category } = req.query;
      if (query) {
        const results = await deps.storageEngine.searchKnowledge(String(query), category as KnowledgeCategory);
        return res.json(results);
      }
      const kb = await deps.storageEngine.getKnowledgeBase();
      res.json(kb);
    } catch (error) {
      res.status(500).json({ error: String(error) });
    }
  });

  router.post('/', async (req, res) => {
    try {
      const { title, category, tags, contentBlocks, relatedEntries } = req.body;
      if (!title || !category || !contentBlocks) {
        return res.status(400).json({ error: 'Title, category, and contentBlocks are required' });
      }

      const entry = await deps.storageEngine.publishKnowledge({
        title,
        category: category as KnowledgeCategory,
        tags: tags || [],
        contentBlocks,
        relatedEntries: relatedEntries || []
      });

      // Emit event for vectorization/indexing (placeholder)
      deps.eventBus.publish({
        type: 'KNOWLEDGE_PUBLISHED',
        taskId: 'system',
        timestamp: new Date().toISOString(),
        entryId: entry.id
      });

      res.status(201).json(entry);
    } catch (error) {
      res.status(500).json({ error: String(error) });
    }
  });

  router.get('/:id', async (req, res) => {
    try {
      const entry = await deps.storageEngine.getKnowledgeEntry(req.params.id);
      if (!entry) return res.status(404).json({ error: 'Knowledge entry not found' });
      res.json(entry);
    } catch (error) {
      res.status(500).json({ error: String(error) });
    }
  });

  return router;
}
