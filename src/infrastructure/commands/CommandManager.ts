import { Command, CommandContext } from './types.js';
import { LedgerStorageEngine } from '../storage/LedgerStorageEngine.js';
import { LocalEventBus } from '../bus/LocalEventBus.js';
import { createLogger, Logger } from '../logging/Logger.js';
import { pauseCommand, resumeCommand, resetCommand } from './handlers/CoreHandlers.js';
import { findCommand, explainCommand } from './handlers/AnalysisHandlers.js';
import { WorkerManager } from '../llm/WorkerManager.js';
import { ProviderRegistry } from '../llm/ProviderRegistry.js';

/**
 * CommandManager
 * Responsibility: Registration, parsing, and dispatching of commands.
 */
export class CommandManager {
  private commands = new Map<string, Command>();
  private logger: Logger;

  constructor(
    private readonly storageEngine: LedgerStorageEngine,
    private readonly eventBus: LocalEventBus,
    private readonly workerManager: WorkerManager,
    private readonly providerRegistry: ProviderRegistry
  ) {
    this.logger = createLogger('command', eventBus);
    this.register(pauseCommand);
    this.register(resumeCommand);
    this.register(resetCommand);
    this.register(findCommand);
    this.register(explainCommand);
  }

  /**
   * Registers a command and its aliases.
   */
  public register(command: Command): void {
    this.commands.set(command.name.toLowerCase(), command);
    if (command.aliases) {
      for (const alias of command.aliases) {
        this.commands.set(alias.toLowerCase(), command);
      }
    }
  }

  /**
   * Parses a comment string to extract command name and arguments.
   * Format: @agent /command args...
   */
  public async parse(comment: string): Promise<{ name: string; args: string } | null> {
    const settings = await this.storageEngine.getSettings();
    const mention = settings.agentMention;
    
    // Regex to match "@agent /command args"
    const pattern = new RegExp(`^@?${mention}\\s+/(\\w+)(?:\\s+([\\s\\S]*))?$`, 'i');
    const match = comment.trim().match(pattern);

    if (!match) return null;

    return {
      name: match[1]!.toLowerCase(),
      args: (match[2] || '').trim(),
    };
  }

  /**
   * Dispatches a command if detected in the comment.
   */
  public async dispatch(comment: string, ctx: Omit<CommandContext, 'storageEngine' | 'eventBus' | 'workerManager' | 'llmProvider'>): Promise<boolean> {
    const parsed = await this.parse(comment);
    if (!parsed) return false;

    const command = this.commands.get(parsed.name);
    if (!command) {
      this.logger.warn(`Unknown command: /${parsed.name}`, ctx.task.id);
      return false;
    }

    // Permission check
    if (command.adminOnly) {
      const isAuthorized = await this.storageEngine.isAuthorizedAdmin(ctx.sender);
      if (!isAuthorized) {
        this.logger.error(`Unauthorized: @${ctx.sender} attempted /${parsed.name}`, ctx.task.id);
        return true; 
      }
    }

    this.logger.info(`Dispatching /${command.name} for Task: ${ctx.task.id}`, ctx.task.id);

    try {
      const fullCtx: CommandContext = {
        ...ctx,
        storageEngine: this.storageEngine,
        eventBus: this.eventBus,
        workerManager: this.workerManager,
        llmProvider: this.providerRegistry.getActiveProvider()
      };
      await command.execute(fullCtx, parsed.args);
      return true;
    } catch (error) {
      this.logger.error(`Error executing /${command.name}: ${error}`, ctx.task.id);
      return true;
    }
  }
}
