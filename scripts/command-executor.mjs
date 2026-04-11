#!/usr/bin/env node

import { spawn } from 'child_process';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Get the command type from process.argv (pnpm bot -> argv[2] is 'bot')
const commandType = process.argv[2];
const args = process.argv.slice(3);

// Map command type to compiled JS file
const commandMap = {
  'bot': 'command-executor.js',
  'watch': 'command-executor.js',
  'revalidate': 'command-executor.js',
};

const scriptFile = commandMap[commandType];

if (!scriptFile) {
  console.error(`Unknown command: ${commandType}`);
  console.error('Available: bot, watch, revalidate');
  process.exit(1);
}

const scriptPath = join(__dirname, '..', 'dist', 'scripts', scriptFile);

// Reconstruct args for the compiled script
const execArgs = [commandType, ...args];

// Execute the compiled TypeScript
const child = spawn('node', [scriptPath, ...execArgs], {
  stdio: 'inherit',
  shell: true,
});

child.on('exit', (code) => {
  process.exit(code || 0);
});

child.on('error', (error) => {
  console.error(`Failed to execute command: ${error.message}`);
  process.exit(1);
});
