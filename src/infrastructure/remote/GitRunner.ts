import { exec } from 'node:child_process';
import { promisify } from 'node:util';

const execAsync = promisify(exec);

/**
 * GitRunner
 * Responsibility: Executes Git commands in a specified directory.
 */
export class GitRunner {
  constructor(private readonly repoPath: string) {}

  private async runCommand(command: string): Promise<{ stdout: string; stderr: string; exitCode: number }> {
    try {
      const { stdout, stderr } = await execAsync(command, { cwd: this.repoPath });
      return { stdout, stderr, exitCode: 0 };
    } catch (error: any) {
      return {
        stdout: error.stdout || '',
        stderr: error.stderr || error.message,
        exitCode: error.code || 1,
      };
    }
  }

  public async clone(url: string, targetPath: string): Promise<void> {
    await this.runCommand(`git clone ${url} ${targetPath}`);
  }

  public async getDefaultBranch(): Promise<string> {
    const { stdout } = await this.runCommand('git rev-parse --abbrev-ref HEAD');
    return stdout.trim();
  }

  public async getCurrentBranch(): Promise<string> {
    const { stdout } = await this.runCommand('git rev-parse --abbrev-ref HEAD');
    return stdout.trim();
  }

  public async createBranch(name: string, baseBranch: string): Promise<void> {
    await this.runCommand(`git checkout ${baseBranch} && git pull origin ${baseBranch} && git checkout -b ${name}`);
  }

  public async pushBranch(branchName: string): Promise<void> {
    await this.runCommand(`git push -u origin ${branchName}`);
  }

  public async gitStatus(): Promise<string> {
    const { stdout } = await this.runCommand('git status --porcelain');
    return stdout;
  }

  public async gitAdd(files: string[]): Promise<void> {
    await this.runCommand(`git add ${files.join(' ')}`);
  }

  public async gitCommit(message: string): Promise<string> {
    const { stdout } = await this.runCommand(`git commit -m "${message}"`);
    return stdout.trim();
  }

  public async checkoutRef(ref: string): Promise<void> {
    await this.runCommand(`git checkout ${ref}`);
  }
}
