import { writeFile, readFile } from 'fs/promises';
import { mkdir } from 'fs/promises';
import os from 'os';
import { join } from 'path';

const CONFIG_DIR = join(os.homedir(), '.btcmarketscanner');
const WATCH_CONFIG_FILE = join(CONFIG_DIR, 'lastwatch.json');

export type WatchConfig = {
  symbol: string;
  updatedAt: string;
};

async function ensureConfigDir() {
  await mkdir(CONFIG_DIR, { recursive: true });
}

export async function saveLastWatchedSymbol(symbol: string): Promise<void> {
  try {
    await ensureConfigDir();
    const config: WatchConfig = {
      symbol,
      updatedAt: new Date().toISOString(),
    };
    await writeFile(WATCH_CONFIG_FILE, JSON.stringify(config, null, 2), 'utf8');
  } catch (error) {
    console.error('[watch-config] Failed to save last watched symbol:', error);
  }
}

export async function loadLastWatchedSymbol(): Promise<string | null> {
  try {
    await ensureConfigDir();
    const content = await readFile(WATCH_CONFIG_FILE, 'utf8');
    const config = JSON.parse(content) as WatchConfig;
    return config.symbol ?? null;
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') {
      return null; // File doesn't exist yet
    }
    console.error('[watch-config] Failed to load last watched symbol:', error);
    return null;
  }
}
