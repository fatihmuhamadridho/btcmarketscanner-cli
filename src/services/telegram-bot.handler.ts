import { telegramService } from './telegram.service';
import { executeTelegramCommand } from '@lib/telegram-command-handler';

export interface TelegramMessage {
  message_id: number;
  text: string;
  chat: {
    id: number;
    type: string;
  };
  from: {
    id: number;
    is_bot: boolean;
    first_name: string;
  };
}

export interface TelegramUpdate {
  update_id: number;
  message?: TelegramMessage;
}

export interface TelegramGetUpdatesResponse {
  ok: boolean;
  result: TelegramUpdate[];
}

export class TelegramBotHandler {
  private lastUpdateId = 0;
  private allowedChatIds: Set<number>;

  constructor(allowedChatIds?: number[]) {
    // By default, only allow the configured chat ID
    const configuredChatId = process.env.TELEGRAM_CHAT_ID ? parseInt(process.env.TELEGRAM_CHAT_ID, 10) : null;
    this.allowedChatIds = new Set(allowedChatIds || (configuredChatId ? [configuredChatId] : []));
  }

  private isAllowed(chatId: number): boolean {
    return this.allowedChatIds.size === 0 || this.allowedChatIds.has(chatId);
  }

  private parseCommand(text: string): string[] {
    // Support both formats:
    // 1. /bot start BTCUSDT scalping 2.0 3.0 5
    // 2. bot start BTCUSDT scalping 2.0 3.0 5
    const trimmed = text.trim();
    const withoutSlash = trimmed.startsWith('/') ? trimmed.slice(1) : trimmed;
    return withoutSlash.split(/\s+/);
  }

  async handleUpdate(update: TelegramUpdate): Promise<void> {
    const message = update.message;
    if (!message || !message.text) {
      return;
    }

    // Only process text that looks like a command
    if (
      !message.text.match(
        /^\/?(scan|validate|execute|stop|setup|bot|watch|watching|unwatch|market|top_volume|top_gainers|top_losers|revalidate)\b/i,
      )
    ) {
      return;
    }

    // Check if chat is allowed
    if (!this.isAllowed(message.chat.id)) {
      console.log(`[telegram-bot] Unauthorized chat ID: ${message.chat.id}`);
      await telegramService.sendMessage(
        `❌ Unauthorized. Your chat ID (${message.chat.id}) is not allowed to execute commands.`,
      );
      return;
    }

    const args = this.parseCommand(message.text);
    console.log(`[telegram-bot] Received command: ${args.join(' ')} from ${message.from.first_name}`);

    try {
      // Show typing indicator while processing
      await telegramService.sendTypingIndicator();

      const result = await executeTelegramCommand(args);
      const responseText = result.message;

      // Debug: log before sending
      console.log(`[telegram-bot] About to send message for command: ${args[0]}`);
      console.log(`[telegram-bot] Message length: ${responseText.length}`);
      console.log(`[telegram-bot] Contains HTML tags: ${responseText.includes('<')}`);

      // Send response back to Telegram
      await telegramService.sendMessage(responseText);

      if (result.success) {
        console.log(`[telegram-bot] Command executed successfully`);
      } else {
        console.warn(`[telegram-bot] Command returned error: ${result.message}`);
      }
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : 'Unknown error';
      const errorText = `❌ Command execution failed: ${errorMsg}`;

      console.error(`[telegram-bot] Error:`, errorMsg);
      await telegramService.sendMessage(errorText);
    }
  }

  setLastUpdateId(updateId: number): void {
    this.lastUpdateId = Math.max(this.lastUpdateId, updateId);
  }

  getLastUpdateId(): number {
    return this.lastUpdateId;
  }
}

export const telegramBotHandler = new TelegramBotHandler();
