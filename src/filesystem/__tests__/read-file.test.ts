import { jest } from '@jest/globals';
import { z } from "zod";
import path from 'path';
import type { PathLike } from 'fs';
import { FilesystemServer } from '../server.js';
import { FileSystemDependencies } from '../types.js';
import { CallToolRequestSchema, CallToolResultSchema } from "@modelcontextprotocol/sdk/types.js";

// Test helper class to access protected methods
class TestFilesystemServer extends FilesystemServer {
  async callTool(request: z.infer<typeof CallToolRequestSchema>) {
    return this.handleCallTool(request);
  }
}

type CallToolRequest = z.infer<typeof CallToolRequestSchema>;
type CallToolResult = z.infer<typeof CallToolResultSchema>;

// Test helper functions
const createMockFs = () => ({
  readFile: jest.fn(),
  stat: jest.fn(),
  realpath: jest.fn(),
  mkdir: jest.fn(),
  writeFile: jest.fn(),
  readdir: jest.fn(),
  rename: jest.fn(),
});

const createMockPath = () => ({
  ...path,
  normalize: jest.fn(),
  isAbsolute: jest.fn(),
  resolve: jest.fn(),
  dirname: jest.fn(),
  join: jest.fn(),
});

const createMockOs = () => ({
  homedir: jest.fn(),
});

const createTestServer = (deps: FileSystemDependencies) => {
  const server = new TestFilesystemServer(['/allowed/dir'], deps);
  server.setupHandlers();
  return server;
};

const setupBasicMocks = (
  mockPath: jest.Mocked<typeof path>,
  mockFs: jest.Mocked<typeof import('fs/promises')>,
  filePath: string,
  content: string
) => {
  mockPath.normalize.mockImplementation((p: string) => p);
  mockPath.isAbsolute.mockReturnValue(true);
  mockPath.resolve.mockReturnValue(filePath);
  mockFs.realpath.mockResolvedValue(filePath);
  mockFs.readFile.mockResolvedValue(content);
};

const setupErrorMocks = (
  mockPath: jest.Mocked<typeof path>,
  mockFs: jest.Mocked<typeof import('fs/promises')>,
  filePath: string,
  error: Error
) => {
  mockPath.normalize.mockImplementation((p: string) => p);
  mockPath.isAbsolute.mockReturnValue(true);
  mockPath.resolve.mockReturnValue(filePath);
  mockFs.realpath.mockRejectedValue(error);
};

describe('read_file', () => {
  let mockFs: jest.Mocked<typeof import('fs/promises')>;
  let mockPath: jest.Mocked<typeof import('path')>;
  let mockOs: jest.Mocked<typeof import('os')>;
  let server: TestFilesystemServer;
  let deps: FileSystemDependencies;

  beforeAll(() => {
    // Create initial mocks and import jest
    mockFs = createMockFs() as any;
    mockPath = createMockPath() as any;
    mockOs = createMockOs() as any;
    deps = { fs: mockFs, path: mockPath, os: mockOs };
    
    // Set up default mock implementations
    mockPath.join.mockImplementation((...paths: string[]) => paths.join('/'));
    mockPath.dirname.mockImplementation((p: string) => p.split('/').slice(0, -1).join('/'));
  });

  beforeEach(() => {
    // Reset all mocks before each test
    jest.clearAllMocks();
    server = createTestServer(deps);
  });

  afterEach(() => {
    // Clean up after each test
    server = null as unknown as TestFilesystemServer;
  });

  describe('basic functionality', () => {
    it('should read a file successfully within allowed directory', async () => {
      const testPath = '/allowed/dir/test.txt';
      setupBasicMocks(mockPath, mockFs, testPath, 'file content');

      const result = await server.callTool({
        method: 'tools/call',
        params: {
          name: 'read_file',
          arguments: {
            path: '/allowed/dir/test.txt'
          }
        }
      });

      expect(result).toEqual({
        content: [{ type: 'text', text: 'file content' }]
      });
      expect(mockFs.readFile).toHaveBeenCalledWith('/allowed/dir/test.txt', 'utf-8');
    });

    it('should handle empty files', async () => {
      const testPath = '/allowed/dir/empty.txt';
      setupBasicMocks(mockPath, mockFs, testPath, '');

      const result = await server.callTool({
        method: 'tools/call',
        params: {
          name: 'read_file',
          arguments: {
            path: '/allowed/dir/empty.txt'
          }
        }
      });

      expect(result).toEqual({
        content: [{ type: 'text', text: '' }]
      });
    });
  });

  describe('path validation', () => {
    it('should handle relative paths', async () => {
      const testPath = '/allowed/dir/subfolder/test.txt';
      mockPath.normalize.mockImplementation(p => p);
      mockPath.isAbsolute.mockReturnValue(false);
      mockPath.resolve.mockReturnValue(testPath);
      mockFs.realpath.mockResolvedValue(testPath);
      mockFs.readFile.mockResolvedValue('relative path content');

      const result = await server.callTool({
        method: 'tools/call',
        params: {
          name: 'read_file',
          arguments: {
            path: 'subfolder/test.txt'
          }
        }
      });

      expect(result).toEqual({
        content: [{ type: 'text', text: 'relative path content' }]
      });
    });

    it('should handle home directory expansion', async () => {
      const testPath = '/allowed/dir/test.txt';
      mockOs.homedir.mockReturnValue('/home/user');
      setupBasicMocks(mockPath, mockFs, testPath, 'home dir content');

      const result = await server.callTool({
        method: 'tools/call',
        params: {
          name: 'read_file',
          arguments: {
            path: '~/test.txt'
          }
        }
      });

      expect(result).toEqual({
        content: [{ type: 'text', text: 'home dir content' }]
      });
      expect(mockOs.homedir).toHaveBeenCalled();
    });
  });

  describe('security', () => {
    it('should reject paths outside allowed directories', async () => {
      const testPath = '/not/allowed/test.txt';
      setupBasicMocks(mockPath, mockFs, testPath, '');

      const result = await server.callTool({
        method: 'tools/call',
        params: {
          name: 'read_file',
          arguments: {
            path: '/not/allowed/test.txt'
          }
        }
      });

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain('Access denied');
    });

    it('should handle symlinks that point outside allowed directories', async () => {
      const sourcePath = '/allowed/dir/link.txt';
      const targetPath = '/not/allowed/target.txt';
      mockPath.normalize.mockImplementation(p => p);
      mockPath.isAbsolute.mockReturnValue(true);
      mockPath.resolve.mockReturnValue(sourcePath);
      mockFs.realpath.mockResolvedValue(targetPath);

      const result = await server.callTool({
        method: 'tools/call',
        params: {
          name: 'read_file',
          arguments: {
            path: '/allowed/dir/link.txt'
          }
        }
      });

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain('Access denied');
    });

    it('should handle non-existent files', async () => {
      const testPath = '/allowed/dir/nonexistent.txt';
      mockPath.normalize.mockImplementation(p => p);
      mockPath.isAbsolute.mockReturnValue(true);
      mockPath.resolve.mockReturnValue(testPath);
      mockFs.realpath.mockRejectedValue(new Error('ENOENT'));
      mockFs.readFile.mockRejectedValue(new Error('ENOENT'));

      const result = await server.callTool({
        method: 'tools/call',
        params: {
          name: 'read_file',
          arguments: {
            path: '/allowed/dir/nonexistent.txt'
          }
        }
      });

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain('ENOENT');
    });
  });

  describe('cross-platform', () => {
    it('should handle Windows-style paths', async () => {
      const testPath = '/allowed/dir/test.txt';
      mockPath.normalize.mockImplementation(p => p.replace(/\\/g, '/'));
      setupBasicMocks(mockPath, mockFs, testPath, 'windows path content');

      const result = await server.callTool({
        method: 'tools/call',
        params: {
          name: 'read_file',
          arguments: {
            path: '\\allowed\\dir\\test.txt'
          }
        }
      });

      expect(result).toEqual({
        content: [{ type: 'text', text: 'windows path content' }]
      });
    });

    it('should handle mixed path separators', async () => {
      const testPath = '/allowed/dir/test.txt';
      mockPath.normalize.mockImplementation(p => p.replace(/\\/g, '/'));
      setupBasicMocks(mockPath, mockFs, testPath, 'mixed path content');

      const result = await server.callTool({
        method: 'tools/call',
        params: {
          name: 'read_file',
          arguments: {
            path: '/allowed\\dir/test.txt'
          }
        }
      });

      expect(result).toEqual({
        content: [{ type: 'text', text: 'mixed path content' }]
      });
    });
  });
});
