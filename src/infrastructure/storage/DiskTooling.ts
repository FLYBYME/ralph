import * as fs from 'fs/promises';
import * as path from 'path';

/**
 * DiskTooling
 * Responsibility: Low-level file system utilities for code manipulation and validation.
 * Isolated from State Data storage.
 */
export class DiskTooling {
  /**
   * Checks if a file exists.
   */
  public async fileExists(filePath: string): Promise<boolean> {
    try {
      await fs.access(filePath);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Reads raw file content for context compilation.
   */
  public async readFile(filePath: string): Promise<string> {
    return await fs.readFile(filePath, 'utf8');
  }

  /**
   * Atomically overwrites a file.
   */
  public async writeFile(filePath: string, content: string): Promise<void> {
    const tmpPath = `${filePath}.${Date.now()}.tmp`;
    await fs.writeFile(tmpPath, content, 'utf8');
    await fs.rename(tmpPath, filePath);
  }

  /**
   * Scans a directory (recursive opt-in) for discovery.
   */
  public async listFiles(dir: string, recursive: boolean = true): Promise<string[]> {
    const results: string[] = [];
    const entries = await fs.readdir(dir, { withFileTypes: true });

    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
          if (recursive) {
              const children = await this.listFiles(fullPath, recursive);
              results.push(...children);
          }
      } else {
          results.push(fullPath);
      }
    }
    return results;
  }
}
