import readline from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';
import {
  createDefaultConfig,
  hasBinanceCredentials,
  type AppConfigFile,
  readAppConfig,
  writeAppConfig,
} from '@configs/app-config';

function buildPromptedConfig(
  current: AppConfigFile,
  apiKey: string,
  secretKey: string,
  telegramBotToken?: string,
  telegramChatId?: string,
): AppConfigFile {
  const config: AppConfigFile = {
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

  if (telegramBotToken && telegramChatId) {
    config.notifications = {
      telegram: {
        enabled: true,
        bot_token: telegramBotToken.trim(),
        chat_id: telegramChatId.trim(),
      },
    };
  }

  return config;
}

export async function ensureOnboardedConfig() {
  const existing = (await readAppConfig()) ?? createDefaultConfig();
  if (hasBinanceCredentials(existing)) {
    return existing;
  }

  const rl = readline.createInterface({ input, output });

  try {
    output.write('\n🤖 BTC Market Scanner Onboarding\n');
    output.write('================================\n\n');

    output.write('📊 Binance Credentials\n');
    const apiKey = await rl.question('Binance API key: ');
    const secretKey = await rl.question('Binance secret key: ');

    output.write('\n📱 Telegram Notifications (Optional)\n');
    output.write('Leave empty to skip Telegram setup.\n');
    const telegramBotToken = await rl.question('Telegram Bot Token: ');
    let telegramChatId = '';

    if (telegramBotToken.trim()) {
      telegramChatId = await rl.question('Telegram Chat ID: ');
    }

    const nextConfig = buildPromptedConfig(existing, apiKey, secretKey, telegramBotToken, telegramChatId);

    await writeAppConfig(nextConfig);

    output.write('\n✅ Configuration saved!\n');
    if (telegramBotToken.trim() && telegramChatId.trim()) {
      output.write('📱 Telegram notifications enabled\n');
    } else {
      output.write('📱 Telegram notifications skipped\n');
    }
    output.write('\n');

    return nextConfig;
  } finally {
    rl.close();
  }
}
