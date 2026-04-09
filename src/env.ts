import fs from 'node:fs';
import path from 'node:path';
import dotenv from 'dotenv';

function loadEnvFile(filePath: string) {
  if (!fs.existsSync(filePath)) {
    return;
  }

  dotenv.config({ path: filePath, override: true });
}

function getEnvMode() {
  const value = process.env.NODE_ENV?.trim().toLowerCase();
  if (value === 'production') return 'production';
  if (value === 'development') return 'development';
  return 'development';
}

function loadEnvFiles() {
  const cwd = process.cwd();
  const mode = getEnvMode();
  const files =
    mode === 'production'
      ? ['.env', '.env.production', '.env.local', '.env.production.local']
      : ['.env', '.env.development', '.env.local', '.env.development.local'];

  for (const file of files) {
    loadEnvFile(path.resolve(cwd, file));
  }
}

loadEnvFiles();

