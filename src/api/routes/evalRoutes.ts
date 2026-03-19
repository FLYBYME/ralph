import { Router } from 'express';
import { ServerDependencies } from '../server.js';
import { EvalScenario } from '../../infrastructure/eval/EvalManager.js';

export function createEvalRouter(deps: ServerDependencies): Router {
  const router = Router();

  // Mock scenarios for now
  const scenarios: EvalScenario[] = [
    {
      id: 'tdd-auth-bypass',
      title: 'Fix Auth Bypass via TDD',
      description: 'Reproduce and fix a security vulnerability where empty tokens are accepted.',
      projectId: 'template-api', // Needs to exist in ledger
      objective: 'Fix the vulnerability in auth.ts where an empty authorization header allows access. Use TDD to prove the fix.',
      useTDD: true,
      expectedFiles: ['src/auth.ts', 'tests/auth.test.ts']
    }
  ];

  router.post('/run', async (req, res) => {
    try {
      const { scenarioId } = req.body;
      const scenario = scenarios.find(s => s.id === scenarioId);
      
      if (!scenario) {
        return res.status(404).json({ error: `Scenario ${scenarioId} not found.` });
      }

      if (!deps.evalManager) {
          return res.status(503).json({ error: 'Eval manager not initialized' });
      }

      const evalId = await deps.evalManager.startEval(scenario);
      res.status(202).json({ evalId, message: 'Evaluation started' });
    } catch (error) {
      res.status(500).json({ error: String(error) });
    }
  });

  router.get('/results', async (_req, res) => {
    try {
      const results = await deps.storageEngine.getEvalResults();
      res.json(results);
    } catch (error) {
      res.status(500).json({ error: String(error) });
    }
  });

  router.get('/:id/status', async (req, res) => {
    try {
      const result = await deps.storageEngine.getEvalResult(req.params.id);
      if (!result) return res.status(404).json({ error: 'Eval result not found' });
      res.json(result);
    } catch (error) {
      res.status(500).json({ error: String(error) });
    }
  });

  router.get('/scenarios', (_req, res) => {
      res.json(scenarios);
  });

  return router;
}
