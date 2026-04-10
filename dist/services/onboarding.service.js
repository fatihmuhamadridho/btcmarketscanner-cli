import readline from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';
import { createDefaultConfig, hasBinanceCredentials, readAppConfig, writeAppConfig, } from '../configs/app-config.js';
function buildPromptedConfig(current, apiKey, secretKey) {
    return {
        ...current,
        auth: {
            profiles: {
                binance: {
                    api_key: apiKey.trim(),
                    secret_key: secretKey.trim(),
                },
            },
        },
    };
}
export async function ensureOnboardedConfig() {
    const existing = (await readAppConfig()) ?? createDefaultConfig();
    if (hasBinanceCredentials(existing)) {
        return existing;
    }
    const rl = readline.createInterface({ input, output });
    try {
        output.write('BTC Market Scanner onboarding\n');
        output.write('Enter Binance credentials to continue.\n');
        const apiKey = await rl.question('Binance API key: ');
        const secretKey = await rl.question('Binance secret key: ');
        const nextConfig = buildPromptedConfig(existing, apiKey, secretKey);
        await writeAppConfig(nextConfig);
        return nextConfig;
    }
    finally {
        rl.close();
    }
}
