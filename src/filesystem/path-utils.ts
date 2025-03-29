import { FileSystemDependencies } from './types.js';

export class PathUtils {
  constructor(private deps: FileSystemDependencies) {}

  normalizePath(p: string): string {
    return this.deps.path.normalize(p);
  }

  expandHome(filepath: string): string {
    if (filepath.startsWith('~/') || filepath === '~') {
      return this.deps.path.join(this.deps.os.homedir(), filepath.slice(1));
    }
    return filepath;
  }

  async validatePath(requestedPath: string, allowedDirectories: string[]): Promise<string> {
    const expandedPath = this.expandHome(requestedPath);
    const absolute = this.deps.path.isAbsolute(expandedPath)
      ? this.deps.path.resolve(expandedPath)
      : this.deps.path.resolve(process.cwd(), expandedPath);

    const normalizedRequested = this.normalizePath(absolute);

    // First check if requested path is within allowed directories
    const isAllowed = allowedDirectories.some(dir => normalizedRequested.startsWith(dir));
    if (!isAllowed) {
      throw new Error(`Access denied - path outside allowed directories: ${absolute} not in ${allowedDirectories.join(', ')}`);
    }

    try {
      // Try to resolve the real path (handles symlinks)
      const realPath = await this.deps.fs.realpath(absolute);
      
      // If we got here, the file exists - check if its real path is allowed
      const normalizedReal = this.normalizePath(realPath);
      const isRealPathAllowed = allowedDirectories.some(dir => normalizedReal.startsWith(dir));
      if (!isRealPathAllowed) {
        throw new Error("Access denied - symlink target outside allowed directories");
      }
      
      return realPath;
    } catch (error) {
      if (error instanceof Error) {
        if (error.message.includes('ENOENT')) {
          // For non-existent files, just validate the parent directory exists
          const parentDir = this.deps.path.dirname(absolute);
          try {
            await this.deps.fs.realpath(parentDir);
            return absolute;
          } catch (parentError) {
            // If parent directory doesn't exist, propagate the original ENOENT
            throw error;
          }
        }
        // Re-throw access denied errors
        if (error.message.includes('Access denied')) {
          throw error;
        }
      }
      // Re-throw any other errors
      throw error;
    }
  }
}
