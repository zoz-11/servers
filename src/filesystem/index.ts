#!/usr/bin/env node

import fs from "fs/promises";
import path from "path";
import os from 'os';
import { FilesystemServer } from './server.js';

// Command line argument parsing
const args = process.argv.slice(2);
if (args.length === 0) {
  console.error("Usage: mcp-server-filesystem <allowed-directory> [additional-directories...]");
  process.exit(1);
}

const server = new FilesystemServer(args, {
  fs,
  path,
  os
});

server.start().catch((error) => {
  console.error("Fatal error running server:", error);
  process.exit(1);
});
