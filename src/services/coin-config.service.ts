import { mkdir, readFile, writeFile } from 'fs/promises';
import os from 'os';
import { join } from 'path';

export type CoinConfigAllocation = {
  type: 'percent' | 'usdt';
  value: number;
};

export type CoinConfigLastValidatedPlan = {
  direction: 'long' | 'short';
  entry_zone: [number, number];
  planned_entry: number;
  risk_reward: { tp1: number; tp2: number };
  setup_type: 'breakout_retest' | 'breakdown_retest' | 'continuation';
  stop_loss: number;
  take_profit: { tp1: number; tp2: number };
  confidence: number;
};

export type CoinConfig = {
  symbol: string;
  allocation: CoinConfigAllocation;
  leverage: number;
  marginMode: 'cross' | 'isolated';
  lastValidatedPlan?: CoinConfigLastValidatedPlan | null;
  lastValidatedAt?: string | null;
  updatedAt: string;
};

const CONFIG_DIR = join(os.homedir(), '.btcmarketscanner', 'config', 'coins');

async function ensureConfigDir() {
  await mkdir(CONFIG_DIR, { recursive: true });
}

function getConfigPath(symbol: string): string {
  return join(CONFIG_DIR, `${symbol}.json`);
}

export async function loadCoinConfig(symbol: string): Promise<CoinConfig | null> {
  try {
    await ensureConfigDir();
    const configPath = getConfigPath(symbol);
    const content = await readFile(configPath, 'utf8');
    return JSON.parse(content) as CoinConfig;
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') {
      return null;
    }
    console.error(`[coin-config] Failed to load config for ${symbol}:`, error);
    return null;
  }
}

export async function saveCoinConfig(config: CoinConfig): Promise<void> {
  try {
    await ensureConfigDir();
    const configPath = getConfigPath(config.symbol);
    const payload = {
      ...config,
      updatedAt: new Date().toISOString(),
    };
    await writeFile(configPath, JSON.stringify(payload, null, 2), 'utf8');
  } catch (error) {
    console.error(`[coin-config] Failed to save config for ${config.symbol}:`, error);
    throw error;
  }
}

export async function updateCoinConfigAllocation(
  symbol: string,
  allocation: CoinConfigAllocation,
): Promise<CoinConfig> {
  const existing = await loadCoinConfig(symbol);
  const updated: CoinConfig = {
    symbol,
    allocation,
    leverage: existing?.leverage ?? 10,
    marginMode: existing?.marginMode ?? 'isolated',
    lastValidatedPlan: existing?.lastValidatedPlan ?? null,
    lastValidatedAt: existing?.lastValidatedAt ?? null,
    updatedAt: new Date().toISOString(),
  };
  await saveCoinConfig(updated);
  return updated;
}

export async function updateCoinConfigLeverage(symbol: string, leverage: number): Promise<CoinConfig> {
  const existing = await loadCoinConfig(symbol);
  const updated: CoinConfig = {
    symbol,
    allocation: existing?.allocation ?? { type: 'percent', value: 5 },
    leverage,
    marginMode: existing?.marginMode ?? 'isolated',
    lastValidatedPlan: existing?.lastValidatedPlan ?? null,
    lastValidatedAt: existing?.lastValidatedAt ?? null,
    updatedAt: new Date().toISOString(),
  };
  await saveCoinConfig(updated);
  return updated;
}

export async function updateCoinConfigLastValidatedPlan(
  symbol: string,
  plan: CoinConfigLastValidatedPlan | null,
): Promise<CoinConfig> {
  const existing = await loadCoinConfig(symbol);
  const updated: CoinConfig = {
    symbol,
    allocation: existing?.allocation ?? { type: 'percent', value: 5 },
    leverage: existing?.leverage ?? 10,
    marginMode: existing?.marginMode ?? 'isolated',
    lastValidatedPlan: plan,
    lastValidatedAt: plan ? new Date().toISOString() : null,
    updatedAt: new Date().toISOString(),
  };
  await saveCoinConfig(updated);
  return updated;
}

export async function getOrCreateDefaultCoinConfig(symbol: string): Promise<CoinConfig> {
  const existing = await loadCoinConfig(symbol);
  if (existing) {
    return existing;
  }

  const defaultConfig: CoinConfig = {
    symbol,
    allocation: { type: 'percent', value: 5 },
    leverage: 10,
    marginMode: 'isolated',
    lastValidatedPlan: null,
    lastValidatedAt: null,
    updatedAt: new Date().toISOString(),
  };

  await saveCoinConfig(defaultConfig);
  return defaultConfig;
}

export async function updateCoinConfigMarginMode(
  symbol: string,
  marginMode: 'cross' | 'isolated',
): Promise<CoinConfig> {
  const existing = await loadCoinConfig(symbol);
  const updated: CoinConfig = {
    symbol,
    allocation: existing?.allocation ?? { type: 'percent', value: 5 },
    leverage: existing?.leverage ?? 10,
    marginMode,
    lastValidatedPlan: existing?.lastValidatedPlan ?? null,
    lastValidatedAt: existing?.lastValidatedAt ?? null,
    updatedAt: new Date().toISOString(),
  };
  await saveCoinConfig(updated);
  return updated;
}
