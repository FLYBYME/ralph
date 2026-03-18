import Docker from 'dockerode';
import * as fs from 'fs';
import { CheckRunStatus } from './types.js';
import { createLogger, Logger } from '../logging/Logger.js';

/**
 * DockerRunner
 * Responsibility: Manages the lifecycle of local CI/CD containers using Dockerode.
 */
export class DockerRunner {
  private docker: Docker;
  private logger: Logger;

  constructor() {
    this.docker = new Docker(); // Defaults to /var/run/docker.sock
    this.logger = createLogger('docker');
  }

  /**
   * Builds an image and runs a container to execute tests.
   * Logs are streamed to a local file.
   */
  public async runWorkflow(
    projectPath: string,
    taskId: string,
    logPath: string,
    testCommand: string[] = ['npm', 'test']
  ): Promise<void> {
    this.logger.info(`Starting workflow for task ${taskId}...`, taskId);

    try {
      // 1. Build the image from the project's Dockerfile
      // Note: This expects a Dockerfile in the project root
      const stream = await this.docker.buildImage({
        context: projectPath,
        src: ['Dockerfile']
      }, { t: `ralph-ci-${taskId}` });

      await new Promise((resolve, reject) => {
        this.docker.modem.followProgress(stream, (err, res) => err ? reject(err) : resolve(res));
      });

      // 2. Create and start the container
      const container = await this.docker.createContainer({
        Image: `ralph-ci-${taskId}`,
        Cmd: testCommand,
        name: `ralph-run-${taskId}`,
        HostConfig: {
          AutoRemove: false // We keep it for a moment to pull logs if needed, or remove manually
        }
      });

      await container.start();

      // 3. Capture logs in the background
      const logStream = await container.logs({
        follow: true,
        stdout: true,
        stderr: true
      });

      const fileStream = fs.createWriteStream(logPath);
      logStream.pipe(fileStream);

      // 4. Wait for container to exit
      const result = await container.wait();
      this.logger.info(`Workflow for ${taskId} finished with exit code ${result.StatusCode}`, taskId);

      // Optional: Tag/Status persistence could happen here or in the provider
    } catch (error) {
      this.logger.error(`Execution failed for ${taskId}: ${error}`, taskId);
      fs.appendFileSync(logPath, `\n[INTERNAL ERROR]: ${String(error)}`);
    }
  }

  /**
   * Checks if a container for a specific task is still running or its exit status.
   */
  public async getStatus(taskId: string): Promise<CheckRunStatus['conclusion']> {
    try {
      const container = this.docker.getContainer(`ralph-run-${taskId}`);
      const data = await container.inspect();
      
      if (data.State.Running) return null; // Still in progress
      
      return data.State.ExitCode === 0 ? 'success' : 'failure';
    } catch (error) {
      // If container not found, maybe it was auto-removed or never started
      return 'neutral';
    }
  }

  /**
   * Clean up containers and images for a specific task.
   */
  public async cleanup(taskId: string): Promise<void> {
    try {
      const container = this.docker.getContainer(`ralph-run-${taskId}`);
      await container.remove({ force: true });
      await this.docker.getImage(`ralph-ci-${taskId}`).remove({ force: true });
    } catch {
      // Ignore cleanup errors
    }
  }
}
