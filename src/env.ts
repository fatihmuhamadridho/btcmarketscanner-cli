import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import dotenv from 'dotenv';

function loadEnvFile(filePath: string) {
  if (!fs.existsSync(filePath)) {
    return;
  }

  dotenv.config({ path: filePath, override: true });
}

const moduleDir = path.dirname(fileURLToPath(import.meta.url));
const cliRootDir = path.resolve(moduleDir, '..');

loadEnvFile(path.resolve(process.cwd(), '.env'));
loadEnvFile(path.resolve(cliRootDir, '.env'));
