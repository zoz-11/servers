import { FileSystemDependencies, FileInfo } from './types.js';
import { PathUtils } from './path-utils.js';
import { minimatch } from 'minimatch';
import path from 'path';

export class FileOperations {
  constructor(
    private deps: FileSystemDependencies,
    private pathUtils: PathUtils,
    private allowedDirectories: string[]
  ) {}

  async getFileStats(filePath: string): Promise<FileInfo> {
    const validPath = await this.pathUtils.validatePath(filePath, this.allowedDirectories);
    const stats = await this.deps.fs.stat(validPath);
    return {
      size: stats.size,
      created: stats.birthtime,
      modified: stats.mtime,
      accessed: stats.atime,
      isDirectory: stats.isDirectory(),
      isFile: stats.isFile(),
      permissions: stats.mode.toString(8).slice(-3),
    };
  }

  async searchFiles(
    rootPath: string,
    pattern: string,
    excludePatterns: string[] = []
  ): Promise<string[]> {
    const results: string[] = [];
    const validRootPath = await this.pathUtils.validatePath(rootPath, this.allowedDirectories);

    const search = async (currentPath: string): Promise<void> => {
      const entries = await this.deps.fs.readdir(currentPath, { withFileTypes: true });

      for (const entry of entries) {
        const fullPath = this.deps.path.join(currentPath, entry.name);

        try {
          // Validate each path before processing
          await this.pathUtils.validatePath(fullPath, this.allowedDirectories);

          // Check if path matches any exclude pattern
          const relativePath = this.deps.path.relative(rootPath, fullPath);
          const shouldExclude = excludePatterns.some(pattern => {
            const globPattern = pattern.includes('*') ? pattern : `**/${pattern}/**`;
            return minimatch(relativePath, globPattern, { dot: true });
          });

          if (shouldExclude) {
            continue;
          }

          if (entry.name.toLowerCase().includes(pattern.toLowerCase())) {
            results.push(fullPath);
          }

          if (entry.isDirectory()) {
            await search(fullPath);
          }
        } catch (error) {
          // Skip invalid paths during search
          continue;
        }
      }
    };

    await search(validRootPath);
    return results;
  }
}
