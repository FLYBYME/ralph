import { LocalEventBus } from './infrastructure/bus/LocalEventBus.js';
import { WorkerManager } from './infrastructure/llm/WorkerManager.js';
import { OllamaProvider } from './infrastructure/llm/providers/OllamaProvider.js';
import { PromptBuilder } from './infrastructure/llm/PromptBuilder.js';
import { LedgerStorageEngine } from './infrastructure/storage/LedgerStorageEngine.js';
import { DiskTooling } from './infrastructure/storage/DiskTooling.js';
import { TaskQueue } from './infrastructure/queue/TaskQueue.js';
import { FiniteStateMachine } from './infrastructure/fsm/FiniteStateMachine.js';
import { ContextAnalyzer } from './infrastructure/fsm/ContextAnalyzer.js';
import { DaemonOrchestrator } from './infrastructure/orchestrator/DaemonOrchestrator.js';
import { SpecialistExecutor } from './infrastructure/llm/SpecialistExecutor.js';
import { CommandManager } from './infrastructure/commands/CommandManager.js';
import { LedgerRemoteProvider } from './infrastructure/remote/LedgerRemoteProvider.js';
import { TaskResolver } from './infrastructure/storage/TaskResolver.js';
import { ActionRegistry } from './infrastructure/actions/ActionRegistry.js';
import { SolveAction } from './infrastructure/actions/SolveAction.js';
import { TriageAction } from './infrastructure/actions/TriageAction.js';
import { startServer } from './api/server.js';
import { createLogger } from './infrastructure/logging/Logger.js';

async function main() {
  // 1. Infrastructure Setup
  const eventBus = new LocalEventBus();
  const logger = createLogger('orchestrator', eventBus);

  const storageEngine = new LedgerStorageEngine(process.cwd());
  const diskTooling = new DiskTooling();

  // Bootstrap environment to ensure ledger and settings exist
  await storageEngine.bootstrapEnvironment();
  const settings = await storageEngine.getSettings();
  
  // Apply operational limits from settings
  eventBus.setMaxBacklog(settings.maxBacklog);

  logger.info('--- Ralph AI Agent ---');
  logger.info(`Model: ${settings.ollamaModel}`);
  logger.info(`Host: ${settings.ollamaHost}`);
  logger.info('----------------------');

  const ollamaProvider = new OllamaProvider(settings.ollamaHost);
  const workerManager = new WorkerManager(eventBus);
  const promptBuilder = new PromptBuilder();
  const commandManager = new CommandManager(storageEngine, eventBus, workerManager, ollamaProvider);
  const contextAnalyzer = new ContextAnalyzer(workerManager, ollamaProvider, promptBuilder, commandManager);
  const specialistExecutor = new SpecialistExecutor(eventBus, storageEngine);

  // 2. Actions & Remote Setup
  const remoteProvider = new LedgerRemoteProvider(storageEngine, diskTooling);
  const taskResolver = new TaskResolver(storageEngine, remoteProvider);
  const actionRegistry = new ActionRegistry();

  actionRegistry.register(new SolveAction(storageEngine, eventBus, taskResolver));
  actionRegistry.register(new TriageAction(workerManager, ollamaProvider, taskResolver));

  const taskQueue = new TaskQueue(storageEngine);
  const fsm = new FiniteStateMachine(
    workerManager,
    ollamaProvider,
    promptBuilder,
    diskTooling,
    specialistExecutor
  );

  // 3. Orchestrator Setup
  const orchestrator = new DaemonOrchestrator(
    storageEngine,
    taskQueue,
    eventBus,
    fsm,
    workerManager,
    contextAnalyzer
  );

  // 4. Unified Event Logging via Logger
  eventBus.subscribe('FSM_TRANSITION', (event) => {
    if (event.type === 'FSM_TRANSITION') {
      logger.info(`Task ${event.taskId.slice(0, 8)}: ${event.oldState} -> ${event.newState}`, event.taskId);
    }
  });

  eventBus.subscribe('SPECIALIST_START', (event) => {
    if (event.type === 'SPECIALIST_START') {
      logger.info(`[worker:${event.specialist}] 🚀 Started: ${event.activity}`, event.taskId);
    }
  });

  eventBus.subscribe('SPECIALIST_COMPLETE', (event) => {
    if (event.type === 'SPECIALIST_COMPLETE') {
      logger.info(`[worker:${event.specialist}] ✅ Completed in ${event.durationMs}ms`, event.taskId);
    }
  });

  eventBus.subscribe('SPECIALIST_LOG', (event) => {
    if (event.type === 'SPECIALIST_LOG') {
      if (event.stream === 'stderr') {
        logger.error(`[${event.specialist}:err] ${event.text.trim()}`, event.taskId);
      } else {
        logger.info(`[${event.specialist}] ${event.text.trim()}`, event.taskId);
      }
    }
  });

  eventBus.subscribe('TOOL_CALL', (event) => {
    if (event.type === 'TOOL_CALL') {
      const statusIcon = event.result.success ? '✔' : '✖';
      const argsStr = JSON.stringify(event.args);
      const shortOutput = event.result.output.slice(0, 150).replace(/\n/g, '\\n') + (event.result.output.length > 150 ? '...' : '');
      logger.info(`[tool:${event.toolName}] ${statusIcon} args: ${argsStr}`, event.taskId);
      logger.debug(`[tool:${event.toolName}:result] ${shortOutput}`, event.taskId);
    }
  });

  eventBus.subscribe('WORKER_STREAM', (event) => {
    if (event.type === 'WORKER_STREAM') {
      if (event.thinking) process.stdout.write(event.thinking);
      if (event.chunk) process.stdout.write(event.chunk);
    }
  });

  // 5. Boot the system
  try {
    const isOllamaUp = await ollamaProvider.ping(settings.ollamaModel);
    if (!isOllamaUp) {
      logger.error(`Ollama model "${settings.ollamaModel}" not found at ${settings.ollamaHost}.`);
      process.exit(1);
    }

    await startServer(settings.serverPort, { storageEngine, actionRegistry, eventBus, remoteProvider, ollamaProvider, workerManager });
    await orchestrator.boot();
  } catch (error) {
    logger.error(`Fatal error during boot: ${error}`);
    process.exit(1);
  }
}

main().catch((err) => {
  console.error('Unhandled promise rejection:', err);
  process.exit(1);
});
