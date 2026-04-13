import https from 'https';
import { telegramBotHandler, type TelegramGetUpdatesResponse } from './telegram-bot.handler';

export class TelegramBotService {
  private botToken: string | null;
  private isRunning = false;
  private pollInterval: NodeJS.Timeout | null = null;

  constructor() {
    this.botToken = process.env.TELEGRAM_BOT_TOKEN || null;
  }

  private async makeRequest<T>(path: string, method: string = 'GET', data?: string): Promise<T> {
    return new Promise((resolve, reject) => {
      if (!this.botToken) {
        reject(new Error('TELEGRAM_BOT_TOKEN not configured'));
        return;
      }

      const options = {
        hostname: 'api.telegram.org',
        port: 443,
        path: `/bot${this.botToken}${path}`,
        method,
        headers: {
          'Content-Type': 'application/json',
        } as Record<string, string>,
      };

      if (data) {
        options.headers['Content-Length'] = String(Buffer.byteLength(data));
      }

      const req = https.request(options, (res) => {
        let body = '';
        res.on('data', (chunk) => {
          body += chunk;
        });
        res.on('end', () => {
          try {
            resolve(JSON.parse(body));
          } catch (error) {
            reject(new Error(`Invalid JSON response: ${body}`));
          }
        });
      });

      req.on('error', reject);

      if (data) {
        req.write(data);
      }
      req.end();
    });
  }

  async setMyCommands(): Promise<boolean> {
    const commands = [
      { command: 'scan', description: 'Analyze consensus setup across timeframes' },
      { command: 'validate', description: 'Validate setup with OpenClaw AI' },
      { command: 'execute', description: 'Execute trade based on validated setup' },
      { command: 'stop', description: 'Stop active trading bot' },
      { command: 'watch', description: 'Auto scan validate execute and restart on close' },
      { command: 'watching', description: 'Show coins being watched' },
      { command: 'unwatch', description: 'Stop watching coins in auto mode' },
      { command: 'market', description: 'Market overview with aggregate stats' },
      { command: 'top_volume', description: 'Top 10 coins by 24h volume' },
      { command: 'top_gainers', description: 'Top 10 gainers in 24h' },
      { command: 'top_losers', description: 'Top 10 losers in 24h' },
      { command: 'setup', description: 'Configure trading settings' },
    ];

    console.log(`[telegram-bot-service] Registering ${commands.length} commands...`);

    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        const response = await this.makeRequest(`/setMyCommands`, 'POST', JSON.stringify({ commands }));
        console.log(`[telegram-bot-service] ✅ Commands registered successfully (attempt ${attempt})`);
        console.log(`[telegram-bot-service] Registered commands: ${commands.map((c) => `/${c.command}`).join(', ')}`);
        return true;
      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : String(error);
        console.error(`[telegram-bot-service] ❌ Attempt ${attempt}/3 failed to set commands: ${errorMsg}`);
        if (attempt < 3) {
          console.log(`[telegram-bot-service] Retrying in 2 seconds...`);
          await new Promise((resolve) => setTimeout(resolve, 2000));
        }
      }
    }

    console.error('[telegram-bot-service] ❌ Failed to register commands after 3 attempts');
    console.error('[telegram-bot-service] ℹ️  Make sure TELEGRAM_BOT_TOKEN is valid');
    return false;
  }

  async getUpdates(offset: number = 0, timeout: number = 30): Promise<TelegramGetUpdatesResponse> {
    const params = new URLSearchParams({
      offset: String(offset),
      timeout: String(timeout),
    });

    return this.makeRequest<TelegramGetUpdatesResponse>(`/getUpdates?${params.toString()}`, 'GET');
  }

  async pollUpdates(): Promise<void> {
    if (!this.botToken) {
      console.error('[telegram-bot-service] TELEGRAM_BOT_TOKEN not configured');
      return;
    }

    console.log('[telegram-bot-service] Starting Telegram bot polling...');
    this.isRunning = true;

    // Start polling loop
    const poll = async () => {
      try {
        const offset = telegramBotHandler.getLastUpdateId() + 1;
        const response = await this.getUpdates(offset, 30);

        if (!response.ok) {
          console.error('[telegram-bot-service] Telegram API error:', response);
          return;
        }

        if (response.result && response.result.length > 0) {
          console.log(`[telegram-bot-service] Received ${response.result.length} update(s)`);

          for (const update of response.result) {
            try {
              await telegramBotHandler.handleUpdate(update);
            } catch (error) {
              console.error('[telegram-bot-service] Error handling update:', error);
            }
            telegramBotHandler.setLastUpdateId(update.update_id);
          }
        }
      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : String(error);
        console.error('[telegram-bot-service] Polling error:', errorMsg);
      }

      // Schedule next poll
      if (this.isRunning) {
        this.pollInterval = setTimeout(poll, 1000);
      }
    };

    // Start the polling loop
    this.pollInterval = setTimeout(poll, 0);
  }

  async stop(): Promise<void> {
    console.log('[telegram-bot-service] Stopping Telegram bot...');
    this.isRunning = false;

    if (this.pollInterval) {
      clearTimeout(this.pollInterval);
      this.pollInterval = null;
    }
  }

  isActive(): boolean {
    return this.isRunning;
  }
}

export const telegramBotService = new TelegramBotService();
