import { mkdir, readFile, writeFile, readdir, unlink } from 'fs/promises';
import os from 'os';
import { join } from 'path';
import type { FuturesAutoBotState } from '@core/binance/futures/bot/domain/futuresAutoBot.model';

const BOT_STATE_DIR = join(os.homedir(), '.btcmarketscanner', 'bot-state');

async function ensureBotStateDir() {
  await mkdir(BOT_STATE_DIR, { recursive: true });
}

function getStatePath(symbol: string): string {
  return join(BOT_STATE_DIR, `${symbol}.json`);
}

export async function loadBotState(symbol: string): Promise<FuturesAutoBotState | null> {
  try {
    await ensureBotStateDir();
    const statePath = getStatePath(symbol);
    const content = await readFile(statePath, 'utf8');
    return JSON.parse(content) as FuturesAutoBotState;
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') {
      return null;
    }
    console.error(`[bot-state] Failed to load state for ${symbol}:`, error);
    return null;
  }
}

export async function saveBotState(state: FuturesAutoBotState): Promise<void> {
  try {
    await ensureBotStateDir();
    const statePath = getStatePath(state.plan.symbol);

    // Use a replacer to handle potential circular references
    const replacer = (key: string, value: any) => {
      // Skip functions and undefined values
      if (typeof value === 'function' || value === undefined) {
        return undefined;
      }
      return value;
    };

    const jsonStr = JSON.stringify(state, replacer, 2);
    await writeFile(statePath, jsonStr, 'utf8');
  } catch (error) {
    console.error(`[bot-state] Failed to save state for ${state.plan.symbol}:`, error instanceof Error ? error.message : String(error));
    // Don't throw - just log the error so bot can continue operating
  }
}

export async function deleteBotState(symbol: string): Promise<void> {
  try {
    const statePath = getStatePath(symbol);
    await unlink(statePath);
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') {
      return; // File doesn't exist, which is fine
    }
    console.error(`[bot-state] Failed to delete state for ${symbol}:`, error);
    throw error;
  }
}

export async function getAllBotStates(): Promise<FuturesAutoBotState[]> {
  try {
    await ensureBotStateDir();
    const files = await readdir(BOT_STATE_DIR);
    const states: FuturesAutoBotState[] = [];

    for (const file of files) {
      if (file.endsWith('.json')) {
        const symbol = file.replace('.json', '');
        const state = await loadBotState(symbol);
        if (state) {
          states.push(state);
        }
      }
    }

    return states;
  } catch (error) {
    console.error('[bot-state] Failed to load all states:', error);
    return [];
  }
}
