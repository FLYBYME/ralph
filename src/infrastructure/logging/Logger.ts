import chalk from 'chalk';
import { LocalEventBus } from '../bus/LocalEventBus.js';
import { SystemLogEvent } from '../bus/types.js';

export class Logger {
  private module: string;
  private bus: LocalEventBus | undefined;

  constructor(module: string, bus?: LocalEventBus) {
    this.module = module;
    this.bus = bus;
  }

  public info(message: string, taskId: string = 'system') {
    this.log('info', message, taskId);
  }

  public warn(message: string, taskId: string = 'system') {
    this.log('warn', message, taskId);
  }

  public error(message: string, taskId: string = 'system') {
    this.log('error', message, taskId);
  }

  public debug(message: string, taskId: string = 'system') {
    this.log('debug', message, taskId);
  }

  private log(level: 'info' | 'warn' | 'error' | 'debug', message: string, taskId: string) {
    const timestamp = new Date().toISOString();
    
    // 1. Emit to EventBus if present
    if (this.bus) {
      const event: SystemLogEvent = {
        type: 'SYSTEM_LOG',
        taskId,
        timestamp,
        level,
        module: this.module,
        message
      };
      this.bus.publish(event);
    }

    // 2. Format for local console
    const colorMap = {
      info: chalk.blue,
      warn: chalk.yellow,
      error: chalk.red,
      debug: chalk.magenta
    };
    
    const levelStr = colorMap[level](level.toUpperCase().padEnd(5));
    const moduleStr = chalk.cyan(`[${this.module}]`);
    const taskStr = taskId !== 'system' ? chalk.dim(`(task:${taskId.split('-')[0]}) `) : '';
    
    console.log(`${chalk.dim(timestamp)} ${levelStr} ${moduleStr} ${taskStr}${message}`);
  }
}

// Global factory or default instance helper
export function createLogger(module: string, bus?: LocalEventBus): Logger {
  return new Logger(module, bus);
}
