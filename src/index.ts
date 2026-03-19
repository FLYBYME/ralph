import 'dotenv/config';
import { LocalEventBus } from './infrastructure/bus/LocalEventBus.js';
import { WorkerManager } from './infrastructure/llm/WorkerManager.js';
import { OllamaProvider } from './infrastructure/llm/providers/OllamaProvider.js';
import { OpenAIProvider } from './infrastructure/llm/providers/OpenAIProvider.js';
import { AnthropicProvider } from './infrastructure/llm/providers/AnthropicProvider.js';
import { ProviderRegistry } from './infrastructure/llm/ProviderRegistry.js';
import { PromptBuilder } from './infrastructure/llm/PromptBuilder.js';
import { LedgerStorageEngine } from './infrastructure/storage/LedgerStorageEngine.js';
import { DiskTooling } from './infrastructure/storage/DiskTooling.js';
import { TaskQueue } from './infrastructure/queue/TaskQueue.js';
import { FiniteStateMachine } from './infrastructure/fsm/FiniteStateMachine.js';
import { ContextAnalyzer } from './infrastructure/fsm/ContextAnalyzer.js';
import { DaemonOrchestrator } from './infrastructure/orchestrator/DaemonOrchestrator.js';
import { JanitorService } from './infrastructure/orchestrator/JanitorService.js';
import { SpecialistExecutor } from './infrastructure/llm/SpecialistExecutor.js';
import { CommandManager } from './infrastructure/commands/CommandManager.js';
import { LedgerRemoteProvider } from './infrastructure/remote/LedgerRemoteProvider.js';
import { TaskResolver } from './infrastructure/storage/TaskResolver.js';
import { ActionRegistry } from './infrastructure/actions/ActionRegistry.js';
import { SolveAction } from './infrastructure/actions/SolveAction.js';
import { TriageAction } from './infrastructure/actions/TriageAction.js';
import { AuditAction } from './infrastructure/actions/AuditAction.js';
import { EvalManager } from './infrastructure/eval/EvalManager.js';
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
  logger.info(`Active Provider: ${settings.activeProviderId}`);
  logger.info('----------------------');

  const providerRegistry = new ProviderRegistry();

  for (const config of settings.providers) {
    if (config.providerId === 'ollama-local') {
      providerRegistry.register(new OllamaProvider(config.baseURL || 'http://localhost:11434'), config);
    } else if (config.providerId === 'openai') {
      providerRegistry.register(new OpenAIProvider(config.apiKey || '', config.baseURL, config.id), config);
    } else if (config.providerId === 'anthropic') {
      providerRegistry.register(new AnthropicProvider(config.id, config.apiKey || '', config.baseURL), config);
    }
  }

  try {
    providerRegistry.setActiveProvider(settings.activeProviderId);
  } catch (err) {
    logger.warn(`Failed to set active provider "${settings.activeProviderId}": ${err}. Falling back to first available.`);
    const first = providerRegistry.getAllProviders()[0];
    if (first) providerRegistry.setActiveProvider(first.providerId);
  }

  const workerManager = new WorkerManager(eventBus, storageEngine);
  const promptBuilder = new PromptBuilder();
  const commandManager = new CommandManager(storageEngine, eventBus, workerManager, providerRegistry);
  const contextAnalyzer = new ContextAnalyzer(workerManager, providerRegistry, promptBuilder, commandManager);
  const specialistExecutor = new SpecialistExecutor(eventBus, storageEngine);
  const evalManager = new EvalManager(storageEngine, eventBus, workerManager, providerRegistry, promptBuilder);
  // 2. Actions & Remote Setup
  const remoteProvider = new LedgerRemoteProvider(storageEngine, diskTooling);
  const taskResolver = new TaskResolver(storageEngine, remoteProvider);
  const actionRegistry = new ActionRegistry();

  actionRegistry.register(new SolveAction(storageEngine, eventBus, taskResolver));
  actionRegistry.register(new TriageAction(workerManager, providerRegistry, taskResolver));
  const auditAction = new AuditAction(storageEngine, eventBus);
  actionRegistry.register(auditAction);

  const janitorService = new JanitorService(
    storageEngine,
    workerManager,
    providerRegistry,
    eventBus,
    auditAction
  );

  const taskQueue = new TaskQueue(storageEngine);
  const fsm = new FiniteStateMachine(
    workerManager,
    providerRegistry,
    promptBuilder,
    diskTooling,
    specialistExecutor,
    remoteProvider
  );

  // 3. Orchestrator Setup
  const orchestrator = new DaemonOrchestrator(
    storageEngine,
    taskQueue,
    eventBus,
    fsm,
    workerManager,
    providerRegistry,
    remoteProvider,
    contextAnalyzer,
    janitorService
  );

  // 4. Unified Event Logging via Logger
  const specialistBuffers = new Map<string, string>();

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
      // Flush any remaining buffer
      const key = `${event.taskId}-${event.specialist}`;
      const buffer = specialistBuffers.get(key);
      if (buffer) {
        logger.info(`[${event.specialist}] ${buffer.trim()}`, event.taskId);
        specialistBuffers.delete(key);
      }
      logger.info(`[worker:${event.specialist}] ✅ Completed in ${event.durationMs}ms`, event.taskId);
    }
  });

  eventBus.subscribe('SPECIALIST_LOG', (event) => {
    if (event.type === 'SPECIALIST_LOG') {
      const key = `${event.taskId}-${event.specialist}`;
      let buffer = specialistBuffers.get(key) || '';
      buffer += event.text;

      const lines = buffer.split('\n');
      buffer = lines.pop() || ''; 
      specialistBuffers.set(key, buffer);

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        if (event.stream === 'stderr') {
          logger.error(`[${event.specialist}:err] ${trimmed}`, event.taskId);
        } else {
          logger.info(`[${event.specialist}] ${trimmed}`, event.taskId);
        }
      }
    }
  });

  eventBus.subscribe('TOOL_CALL', async (event) => {
    if (event.type === 'TOOL_CALL') {
      const statusIcon = event.result.success ? '✔' : '✖';
      const argsStr = JSON.stringify(event.args);
      const shortOutput = event.result.output.slice(0, 150).replace(/\n/g, '\\n') + (event.result.output.length > 150 ? '...' : '');
      logger.info(`[tool:${event.toolName}] ${statusIcon} args: ${argsStr}`, event.taskId);
      logger.debug(`[tool:${event.toolName}:result] ${shortOutput}`, event.taskId);
      
      try {
        const taskRecord = await storageEngine.getTaskRecord(event.taskId);
        if (!taskRecord.toolCalls) {
          taskRecord.toolCalls = [];
        }
        taskRecord.toolCalls.push({
          toolName: event.toolName,
          args: event.args,
          result: { success: event.result.success, output: event.result.output },
          timestamp: event.timestamp
        });
        await storageEngine.commitTaskRecord(taskRecord);
      } catch (err) {
        // Task might not exist yet if it's a global tool call, ignore safely.
      }
    }
  });

  eventBus.subscribe('WORKER_STREAM', (event) => {
    if (event.type === 'WORKER_STREAM') {
       // Direct stdout write for real-time feel if needed, but keep it clean
       if (event.thinking || event.chunk) {
          const text = event.thinking || event.chunk || '';
          process.stdout.write(text);
       }
    }
  });

  // 5. Boot the system
  try {
    const activeProvider = providerRegistry.getActiveProvider();
    const isProviderUp = await activeProvider.ping();
    if (!isProviderUp) {
      console.log(activeProvider);
      logger.error(`LLM Provider "${activeProvider.providerId}" is not responding.`);
      process.exit(1);
    }

    await startServer(settings.serverPort, { storageEngine, actionRegistry, eventBus, remoteProvider, ollamaProvider: activeProvider, workerManager, janitorService, evalManager });
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
