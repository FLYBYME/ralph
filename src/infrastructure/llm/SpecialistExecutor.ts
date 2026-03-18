import { spawn } from 'node:child_process';
import { LocalEventBus } from '../bus/LocalEventBus.js';
import { LedgerStorageEngine } from '../storage/LedgerStorageEngine.js';
import { createLogger, Logger } from '../logging/Logger.js';

export type WorkerSpecialist = 'gemini' | 'copilot' | 'opencode';

export interface WorkerResult {
  success: boolean;
  output: string;
  exitCode: number;
  stderr: string;
}

export interface WorkerOptions {
  timeoutMs?: number;
  cwd?: string;
  taskId?: string;
  activity?: string;
}

/**
 * SpecialistExecutor
 * Responsibility: Executes specialist workers (CLI tools) and streams logs via the EventBus.
 */
export class SpecialistExecutor {
  private logger: Logger;

  constructor(
    private readonly eventBus: LocalEventBus,
    private readonly storageEngine: LedgerStorageEngine
  ) {
    this.logger = createLogger('specialist', eventBus);
  }

  /**
   * Call a worker CLI with a prompt and capture its output.
   * Streams stdout/stderr real-time via the EventBus.
   */
  public async execute(
    specialist: WorkerSpecialist,
    prompt: string,
    opts: WorkerOptions = {}
  ): Promise<WorkerResult> {
    const timeoutMs = opts.timeoutMs ?? 180_000; // 3 min default
    const taskId = opts.taskId || 'unknown-task';
    const activity = opts.activity || `Executing ${specialist} task`;
    const startTime = Date.now();

    const settings = await this.storageEngine.getSettings();

    this.eventBus.publish({
      type: 'SPECIALIST_START',
      taskId,
      timestamp: new Date().toISOString(),
      specialist,
      activity,
    });

    let cmd: string = '';
    let args: string[] = [];
    switch (specialist) {
      case 'gemini':
        cmd = 'gemini';
        args = ['--prompt', prompt, '--yolo', ...(settings.workerGeminiModel ? ['--model', settings.workerGeminiModel] : [])];
        break;
      case 'copilot':
        cmd = 'copilot';
        args = ['--prompt', prompt, '--allow-all-tools', ...(settings.workerCopilotModel ? ['--model', settings.workerCopilotModel] : [])];
        break;
      case 'opencode':
        cmd = 'opencode';
        args = ['run', prompt, ...(settings.workerOpencodeModel ? ['--model', settings.workerOpencodeModel] : [])];
        break;
      default:
        return { success: false, output: '', exitCode: -1, stderr: `Unknown specialist: ${specialist}` };
    }

    this.logger.info(`Prompt: ${prompt.slice(0, 500)}${prompt.length > 500 ? '...' : ''}`, taskId);

    return new Promise((resolve) => {
      let stdoutData = '';
      let stderrData = '';

      const child = spawn(cmd, args, {
        cwd: opts.cwd,
        env: { ...process.env },
      });

      const timeout = setTimeout(() => {
        child.kill();
        this.emitComplete(taskId, specialist, Date.now() - startTime);
        resolve({
          success: false,
          output: stdoutData,
          exitCode: -1,
          stderr: `${specialist} timed out after ${timeoutMs}ms`,
        });
      }, timeoutMs);

      child.stdout.on('data', (chunk: Buffer) => {
        const text = chunk.toString();
        stdoutData += text;
        this.emitLog(taskId, specialist, 'stdout', text);
      });

      child.stderr.on('data', (chunk: Buffer) => {
        const text = chunk.toString();
        stderrData += text;
        this.emitLog(taskId, specialist, 'stderr', text);
      });

      child.on('error', (err) => {
        clearTimeout(timeout);
        this.emitComplete(taskId, specialist, Date.now() - startTime);
        resolve({
          success: false,
          output: stdoutData,
          exitCode: -1,
          stderr: `${specialist} spawn error: ${err.message}`,
        });
      });

      child.on('exit', (code) => {
        clearTimeout(timeout);
        const exitCode = code ?? -1;
        const durationMs = Date.now() - startTime;
        
        this.logger.info(`Finished with exit code ${exitCode} (${durationMs}ms)`, taskId);
        this.emitComplete(taskId, specialist, durationMs);

        if (specialist === 'gemini' && exitCode === 53) {
          resolve({
            success: false,
            output: stdoutData.trim(),
            exitCode,
            stderr: 'Gemini turn limit reached (exit 53). Simplify the request or retry.',
          });
          return;
        }

        resolve({
          success: exitCode === 0,
          output: stdoutData.trim(),
          exitCode,
          stderr: stderrData.trim(),
        });
      });
    });
  }

  private emitComplete(taskId: string, specialist: string, durationMs: number): void {
    this.eventBus.publish({
      type: 'SPECIALIST_COMPLETE',
      taskId,
      timestamp: new Date().toISOString(),
      specialist,
      durationMs,
    });
  }

  private emitLog(taskId: string, specialist: string, stream: 'stdout' | 'stderr', text: string): void {
    this.eventBus.publish({
      type: 'SPECIALIST_LOG',
      taskId,
      timestamp: new Date().toISOString(),
      specialist,
      stream,
      text,
    });
  }
}
