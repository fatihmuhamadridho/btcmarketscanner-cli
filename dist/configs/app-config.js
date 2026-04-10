import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
export const APP_CONFIG_DIR = path.join(os.homedir(), '.btcmarketscanner');
export const APP_CONFIG_PATH = path.join(APP_CONFIG_DIR, 'btcmarketscanner.json');
const DEFAULT_CONFIG = {
    auth: {
        profiles: {
            binance: {
                api_key: '',
                secret_key: '',
            },
        },
    },
};
export function getBinanceWebsocketBaseUrl() {
    return 'wss://fstream.binance.com/ws';
}
export function hasBinanceCredentials(config) {
    return Boolean(config.auth.profiles.binance.api_key.trim() &&
        config.auth.profiles.binance.secret_key.trim());
}
export function normalizeConfig(input) {
    const apiKey = input?.auth?.profiles?.binance?.api_key ?? '';
    const secretKey = input?.auth?.profiles?.binance?.secret_key ?? '';
    return {
        auth: {
            profiles: {
                binance: {
                    api_key: typeof apiKey === 'string' ? apiKey : '',
                    secret_key: typeof secretKey === 'string' ? secretKey : '',
                },
            },
        },
    };
}
export async function readAppConfig() {
    try {
        const raw = await fs.readFile(APP_CONFIG_PATH, 'utf8');
        return normalizeConfig(JSON.parse(raw));
    }
    catch {
        return null;
    }
}
export async function writeAppConfig(config) {
    await fs.mkdir(APP_CONFIG_DIR, { recursive: true });
    await fs.writeFile(APP_CONFIG_PATH, `${JSON.stringify(normalizeConfig(config), null, 2)}\n`, 'utf8');
}
export function createDefaultConfig() {
    return normalizeConfig(DEFAULT_CONFIG);
}
