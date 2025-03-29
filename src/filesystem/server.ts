import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  ToolSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import { zodToJsonSchema } from "zod-to-json-schema";
import { FileSystemDependencies } from './types.js';
import { PathUtils } from './path-utils.js';
import { FileOperations } from './file-operations.js';
import { FileEditor } from './file-editor.js';
import {
  ReadFileArgsSchema,
  ReadMultipleFilesArgsSchema,
  WriteFileArgsSchema,
  EditFileArgsSchema,
  CreateDirectoryArgsSchema,
  ListDirectoryArgsSchema,
  DirectoryTreeArgsSchema,
  MoveFileArgsSchema,
  SearchFilesArgsSchema,
  GetFileInfoArgsSchema,
} from './types.js';

const ToolInputSchema = ToolSchema.shape.inputSchema;
type ToolInput = z.infer<typeof ToolInputSchema>;

export class FilesystemServer {
  private server: Server;
  private pathUtils: PathUtils;
  private fileOps: FileOperations;
  private fileEditor: FileEditor;

  constructor(
    private allowedDirectories: string[],
    private deps: FileSystemDependencies = {
      fs: require('fs/promises'),
      path: require('path'),
      os: require('os')
    }
  ) {
    this.pathUtils = new PathUtils(deps);
    this.fileOps = new FileOperations(deps, this.pathUtils, allowedDirectories);
    this.fileEditor = new FileEditor(deps, this.pathUtils, allowedDirectories);

    this.server = new Server(
      {
        name: "secure-filesystem-server",
        version: "0.2.0",
      },
      {
        capabilities: {
          tools: {},
        },
      }
    );
  }

  async validateDirectories(): Promise<void> {
    await Promise.all(this.allowedDirectories.map(async (dir) => {
      const expandedDir = this.pathUtils.expandHome(dir);
      try {
        const stats = await this.deps.fs.stat(expandedDir);
        if (!stats.isDirectory()) {
          throw new Error(`Error: ${dir} is not a directory`);
        }
      } catch (error) {
        throw new Error(`Error accessing directory ${dir}: ${error}`);
      }
    }));
  }

  setupHandlers(): void {
    this.server.setRequestHandler(ListToolsRequestSchema, this.handleListTools.bind(this));
    this.server.setRequestHandler(CallToolRequestSchema, this.handleCallTool.bind(this));
  }

  private async handleListTools() {
    return {
      tools: [
        {
          name: "read_file",
          description:
            "Read the complete contents of a file from the file system. " +
            "Handles various text encodings and provides detailed error messages " +
            "if the file cannot be read. Use this tool when you need to examine " +
            "the contents of a single file. Only works within allowed directories.",
          inputSchema: zodToJsonSchema(ReadFileArgsSchema) as ToolInput,
        },
        {
          name: "read_multiple_files",
          description:
            "Read the contents of multiple files simultaneously. This is more " +
            "efficient than reading files one by one when you need to analyze " +
            "or compare multiple files. Each file's content is returned with its " +
            "path as a reference. Failed reads for individual files won't stop " +
            "the entire operation. Only works within allowed directories.",
          inputSchema: zodToJsonSchema(ReadMultipleFilesArgsSchema) as ToolInput,
        },
        {
          name: "write_file",
          description:
            "Create a new file or completely overwrite an existing file with new content. " +
            "Use with caution as it will overwrite existing files without warning. " +
            "Handles text content with proper encoding. Only works within allowed directories.",
          inputSchema: zodToJsonSchema(WriteFileArgsSchema) as ToolInput,
        },
        {
          name: "edit_file",
          description:
            "Make line-based edits to a text file. Each edit replaces exact line sequences " +
            "with new content. Returns a git-style diff showing the changes made. " +
            "Only works within allowed directories.",
          inputSchema: zodToJsonSchema(EditFileArgsSchema) as ToolInput,
        },
        {
          name: "create_directory",
          description:
            "Create a new directory or ensure a directory exists. Can create multiple " +
            "nested directories in one operation. If the directory already exists, " +
            "this operation will succeed silently. Perfect for setting up directory " +
            "structures for projects or ensuring required paths exist. Only works within allowed directories.",
          inputSchema: zodToJsonSchema(CreateDirectoryArgsSchema) as ToolInput,
        },
        {
          name: "list_directory",
          description:
            "Get a detailed listing of all files and directories in a specified path. " +
            "Results clearly distinguish between files and directories with [FILE] and [DIR] " +
            "prefixes. This tool is essential for understanding directory structure and " +
            "finding specific files within a directory. Only works within allowed directories.",
          inputSchema: zodToJsonSchema(ListDirectoryArgsSchema) as ToolInput,
        },
        {
          name: "directory_tree",
          description:
            "Get a recursive tree view of files and directories as a JSON structure. " +
            "Each entry includes 'name', 'type' (file/directory), and 'children' for directories. " +
            "Files have no children array, while directories always have a children array (which may be empty). " +
            "The output is formatted with 2-space indentation for readability. Only works within allowed directories.",
          inputSchema: zodToJsonSchema(DirectoryTreeArgsSchema) as ToolInput,
        },
        {
          name: "move_file",
          description:
            "Move or rename files and directories. Can move files between directories " +
            "and rename them in a single operation. If the destination exists, the " +
            "operation will fail. Works across different directories and can be used " +
            "for simple renaming within the same directory. Both source and destination must be within allowed directories.",
          inputSchema: zodToJsonSchema(MoveFileArgsSchema) as ToolInput,
        },
        {
          name: "search_files",
          description:
            "Recursively search for files and directories matching a pattern. " +
            "Searches through all subdirectories from the starting path. The search " +
            "is case-insensitive and matches partial names. Returns full paths to all " +
            "matching items. Great for finding files when you don't know their exact location. " +
            "Only searches within allowed directories.",
          inputSchema: zodToJsonSchema(SearchFilesArgsSchema) as ToolInput,
        },
        {
          name: "get_file_info",
          description:
            "Retrieve detailed metadata about a file or directory. Returns comprehensive " +
            "information including size, creation time, last modified time, permissions, " +
            "and type. This tool is perfect for understanding file characteristics " +
            "without reading the actual content. Only works within allowed directories.",
          inputSchema: zodToJsonSchema(GetFileInfoArgsSchema) as ToolInput,
        },
        {
          name: "list_allowed_directories",
          description:
            "Returns the list of directories that this server is allowed to access. " +
            "Use this to understand which directories are available before trying to access files.",
          inputSchema: {
            type: "object",
            properties: {},
            required: [],
          },
        },
      ],
    };
  }

  protected async handleCallTool(request: z.infer<typeof CallToolRequestSchema>) {
    try {
      const { name, arguments: args } = request.params;

      switch (name) {
        case "read_file": {
          const parsed = ReadFileArgsSchema.safeParse(args);
          if (!parsed.success) {
            throw new Error(`Invalid arguments for read_file: ${parsed.error}`);
          }
          const validPath = await this.pathUtils.validatePath(parsed.data.path, this.allowedDirectories);
          const content = await this.deps.fs.readFile(validPath, "utf-8");
          return {
            content: [{ type: "text", text: content }],
          };
        }

        case "read_multiple_files": {
          const parsed = ReadMultipleFilesArgsSchema.safeParse(args);
          if (!parsed.success) {
            throw new Error(`Invalid arguments for read_multiple_files: ${parsed.error}`);
          }
          const results = await Promise.all(
            parsed.data.paths.map(async (filePath: string) => {
              try {
                const validPath = await this.pathUtils.validatePath(filePath, this.allowedDirectories);
                const content = await this.deps.fs.readFile(validPath, "utf-8");
                return `${filePath}:\n${content}\n`;
              } catch (error) {
                const errorMessage = error instanceof Error ? error.message : String(error);
                return `${filePath}: Error - ${errorMessage}`;
              }
            }),
          );
          return {
            content: [{ type: "text", text: results.join("\n---\n") }],
          };
        }

        case "write_file": {
          const parsed = WriteFileArgsSchema.safeParse(args);
          if (!parsed.success) {
            throw new Error(`Invalid arguments for write_file: ${parsed.error}`);
          }
          const validPath = await this.pathUtils.validatePath(parsed.data.path, this.allowedDirectories);
          await this.deps.fs.writeFile(validPath, parsed.data.content, "utf-8");
          return {
            content: [{ type: "text", text: `Successfully wrote to ${parsed.data.path}` }],
          };
        }

        case "edit_file": {
          const parsed = EditFileArgsSchema.safeParse(args);
          if (!parsed.success) {
            throw new Error(`Invalid arguments for edit_file: ${parsed.error}`);
          }
          const result = await this.fileEditor.applyFileEdits(parsed.data.path, parsed.data.edits, parsed.data.dryRun);
          return {
            content: [{ type: "text", text: result }],
          };
        }

        case "create_directory": {
          const parsed = CreateDirectoryArgsSchema.safeParse(args);
          if (!parsed.success) {
            throw new Error(`Invalid arguments for create_directory: ${parsed.error}`);
          }
          const validPath = await this.pathUtils.validatePath(parsed.data.path, this.allowedDirectories);
          await this.deps.fs.mkdir(validPath, { recursive: true });
          return {
            content: [{ type: "text", text: `Successfully created directory ${parsed.data.path}` }],
          };
        }

        case "list_directory": {
          const parsed = ListDirectoryArgsSchema.safeParse(args);
          if (!parsed.success) {
            throw new Error(`Invalid arguments for list_directory: ${parsed.error}`);
          }
          const validPath = await this.pathUtils.validatePath(parsed.data.path, this.allowedDirectories);
          const entries = await this.deps.fs.readdir(validPath, { withFileTypes: true });
          const formatted = entries
            .map((entry) => `${entry.isDirectory() ? "[DIR]" : "[FILE]"} ${entry.name}`)
            .join("\n");
          return {
            content: [{ type: "text", text: formatted }],
          };
        }

        case "directory_tree": {
          const parsed = DirectoryTreeArgsSchema.safeParse(args);
          if (!parsed.success) {
            throw new Error(`Invalid arguments for directory_tree: ${parsed.error}`);
          }

          interface TreeEntry {
            name: string;
            type: 'file' | 'directory';
            children?: TreeEntry[];
          }

          const buildTree = async (currentPath: string): Promise<TreeEntry[]> => {
            const validPath = await this.pathUtils.validatePath(currentPath, this.allowedDirectories);
            const entries = await this.deps.fs.readdir(validPath, { withFileTypes: true });
            const result: TreeEntry[] = [];

            for (const entry of entries) {
              const entryData: TreeEntry = {
                name: entry.name,
                type: entry.isDirectory() ? 'directory' : 'file'
              };

              if (entry.isDirectory()) {
                const subPath = this.deps.path.join(currentPath, entry.name);
                entryData.children = await buildTree(subPath);
              }

              result.push(entryData);
            }

            return result;
          };

          const treeData = await buildTree(parsed.data.path);
          return {
            content: [{
              type: "text",
              text: JSON.stringify(treeData, null, 2)
            }],
          };
        }

        case "move_file": {
          const parsed = MoveFileArgsSchema.safeParse(args);
          if (!parsed.success) {
            throw new Error(`Invalid arguments for move_file: ${parsed.error}`);
          }
          const validSourcePath = await this.pathUtils.validatePath(parsed.data.source, this.allowedDirectories);
          const validDestPath = await this.pathUtils.validatePath(parsed.data.destination, this.allowedDirectories);
          await this.deps.fs.rename(validSourcePath, validDestPath);
          return {
            content: [{ type: "text", text: `Successfully moved ${parsed.data.source} to ${parsed.data.destination}` }],
          };
        }

        case "search_files": {
          const parsed = SearchFilesArgsSchema.safeParse(args);
          if (!parsed.success) {
            throw new Error(`Invalid arguments for search_files: ${parsed.error}`);
          }
          const results = await this.fileOps.searchFiles(parsed.data.path, parsed.data.pattern, parsed.data.excludePatterns);
          return {
            content: [{ type: "text", text: results.length > 0 ? results.join("\n") : "No matches found" }],
          };
        }

        case "get_file_info": {
          const parsed = GetFileInfoArgsSchema.safeParse(args);
          if (!parsed.success) {
            throw new Error(`Invalid arguments for get_file_info: ${parsed.error}`);
          }
          const info = await this.fileOps.getFileStats(parsed.data.path);
          return {
            content: [{ type: "text", text: Object.entries(info)
              .map(([key, value]) => `${key}: ${value}`)
              .join("\n") }],
          };
        }

        case "list_allowed_directories": {
          return {
            content: [{
              type: "text",
              text: `Allowed directories:\n${this.allowedDirectories.join('\n')}`
            }],
          };
        }

        default:
          throw new Error(`Unknown tool: ${name}`);
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      return {
        content: [{ type: "text", text: `Error: ${errorMessage}` }],
        isError: true,
      };
    }
  }

  async start(): Promise<void> {
    await this.validateDirectories();
    this.setupHandlers();
    const transport = new StdioServerTransport();
    await this.server.connect(transport);
    console.error("Secure MCP Filesystem Server running on stdio");
    console.error("Allowed directories:", this.allowedDirectories);
  }
}
