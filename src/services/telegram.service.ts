import https from 'https';
import { readFileSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';

// Get credentials from .env (dev) or config file (prod)
function getTelegramCredentials() {
  // Priority 1: Environment variables
  if (process.env.TELEGRAM_BOT_TOKEN && process.env.TELEGRAM_CHAT_ID) {
    return {
      botToken: process.env.TELEGRAM_BOT_TOKEN,
      chatId: process.env.TELEGRAM_CHAT_ID,
    };
  }

  // Priority 2: Config file
  try {
    const configPath = join(homedir(), '.btcmarketscanner', 'btcmarketscanner.json');
    const configFile = readFileSync(configPath, 'utf-8');
    const config = JSON.parse(configFile);
    const telegramConfig = config?.notifications?.telegram;

    if (telegramConfig?.enabled && telegramConfig?.bot_token && telegramConfig?.chat_id) {
      return {
        botToken: telegramConfig.bot_token,
        chatId: telegramConfig.chat_id,
      };
    }
  } catch (error) {
    // Config file not found or invalid, continue
  }

  return { botToken: null, chatId: null };
}

export class TelegramService {
  async sendMessage(message: string): Promise<boolean> {
    const { botToken, chatId } = getTelegramCredentials();

    if (!botToken || !chatId) {
      console.warn('[telegram] Bot token or chat ID not configured');
      console.warn(`[telegram] botToken: ${botToken ? '***' : 'null'}, chatId: ${chatId ? '***' : 'null'}`);
      return false;
    }

    console.log('[telegram] Sending message to Telegram...');

    return new Promise((resolve) => {
      const postData = JSON.stringify({
        chat_id: chatId,
        text: message,
        parse_mode: 'HTML',
      });

      const options = {
        hostname: 'api.telegram.org',
        port: 443,
        path: `/bot${botToken}/sendMessage`,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(postData),
        },
      };

      const req = https.request(options, (res) => {
        let data = '';
        res.on('data', (chunk) => {
          data += chunk;
        });
        res.on('end', () => {
          if (res.statusCode === 200) {
            console.log('[telegram] Message sent successfully');
            resolve(true);
          } else {
            console.error('[telegram] Failed to send message', res.statusCode);
            resolve(false);
          }
        });
      });

      req.on('error', (error) => {
        console.error('[telegram] Error sending message:', error);
        resolve(false);
      });

      req.write(postData);
      req.end();
    });
  }

  async sendPriceAlert(symbol: string, alertType: string, price: number, details: string): Promise<boolean> {
    const emoji: Record<string, string> = {
      entry_zone: '📍',
      planned_entry: '🎯',
      tp1: '✅',
      tp2: '✅',
      tp3: '✅',
      stop_loss: '❌',
    };

    const message = `${emoji[alertType] || '🔔'} <b>${symbol} ${alertType.toUpperCase()}</b>\n` +
      `Price: <code>${price.toFixed(4)}</code>\n` +
      `${details}`;

    return this.sendMessage(message);
  }
}

export const telegramService = new TelegramService();
