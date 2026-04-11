import { readAppConfig, writeAppConfig, createDefaultConfig } from '@configs/app-config';

export type WatchConfig = {
  symbol: string;
  updatedAt: string;
};

export async function saveLastWatchedSymbol(symbol: string): Promise<void> {
  try {
    const config = (await readAppConfig()) ?? createDefaultConfig();
    config.lastWatch = {
      symbol,
      updatedAt: new Date().toISOString(),
    };
    await writeAppConfig(config);
  } catch (error) {
    console.error('[watch-config] Failed to save last watched symbol:', error);
  }
}

export async function loadLastWatchedSymbol(): Promise<string | null> {
  try {
    const config = await readAppConfig();
    return config?.lastWatch?.symbol ?? null;
  } catch (error) {
    console.error('[watch-config] Failed to load last watched symbol:', error);
    return null;
  }
}
