import { mkdir, readFile, writeFile, readdir } from 'fs/promises';
import os from 'os';
import { join } from 'path';

export type CoinConfigAllocation = {
  type: 'percent' | 'usdt';
  value: number;
};

export type CoinConfig = {
  symbol: string;
  allocation: CoinConfigAllocation;
  leverage: number;
  marginMode: 'cross' | 'isolated';
  botMode?: 'scalping' | 'intraday';
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

export async function getAllCoinConfigs(): Promise<CoinConfig[]> {
  try {
    await ensureConfigDir();
    const files = await readdir(CONFIG_DIR);
    const configs: CoinConfig[] = [];

    for (const file of files) {
      if (file.endsWith('.json')) {
        const symbol = file.replace('.json', '');
        const config = await loadCoinConfig(symbol);
        if (config) {
          configs.push(config);
        }
      }
    }

    // Sort: GLOBAL first, then others alphabetically
    configs.sort((a, b) => {
      if (a.symbol === 'GLOBAL') return -1;
      if (b.symbol === 'GLOBAL') return 1;
      return a.symbol.localeCompare(b.symbol);
    });

    return configs;
  } catch (error) {
    console.error('[coin-config] Failed to load all configs:', error);
    return [];
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
    botMode: existing?.botMode ?? 'scalping',
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
    botMode: existing?.botMode ?? 'scalping',
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
    botMode: 'scalping',
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
    botMode: existing?.botMode ?? 'scalping',
    updatedAt: new Date().toISOString(),
  };
  await saveCoinConfig(updated);
  return updated;
}

export async function updateCoinConfigBotMode(
  symbol: string,
  botMode: 'scalping' | 'intraday',
): Promise<CoinConfig> {
  const existing = await loadCoinConfig(symbol);
  const updated: CoinConfig = {
    symbol,
    allocation: existing?.allocation ?? { type: 'percent', value: 5 },
    leverage: existing?.leverage ?? 10,
    marginMode: existing?.marginMode ?? 'isolated',
    botMode,
    updatedAt: new Date().toISOString(),
  };
  await saveCoinConfig(updated);
  return updated;
}
