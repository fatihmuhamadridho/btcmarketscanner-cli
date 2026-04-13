import { futuresAutoBotService } from '@core/binance/futures/bot/infrastructure/futuresAutoBot.service';
import type { StartFuturesAutoBotInput } from '@core/binance/futures/bot/domain/futuresAutoBot.model';

type CommandType = 'bot' | 'watch' | 'revalidate';
type BotCommand = 'start' | 'stop' | 'revalidate';

export interface CommandResult {
  success: boolean;
  message: string;
  data?: unknown;
}

interface ParsedCommand {
  type: CommandType;
  action: string;
  args: string[];
}

function parseCommand(args: string[]): ParsedCommand {
  const [type, action, ...rest] = args;

  if (!type || !action) {
    throw new Error('Usage: <command> <action> [args...]');
  }

  return {
    type: type as CommandType,
    action,
    args: rest,
  };
}

async function handleBotCommand(command: BotCommand, symbol: string, args: string[]): Promise<CommandResult> {
  switch (command) {
    case 'start': {
      // Parse: bot start BTCUSDT scalping 2.0 3.0 5
      // args = ['BTCUSDT', 'scalping', '2.0', '3.0', '5']
      if (!symbol || args.length < 4) {
        return {
          success: false,
          message: 'Usage: bot start <symbol> <mode> <entryMid> <tp1> <tp2> [tp3]',
        };
      }

      const [mode, entryMidStr, tp1Str, tp2Str, tp3Str] = args;
      const entryMid = parseFloat(entryMidStr);
      const tp1 = parseFloat(tp1Str);
      const tp2 = parseFloat(tp2Str);
      const tp3 = tp3Str ? parseFloat(tp3Str) : null;

      if (!Number.isFinite(entryMid) || !Number.isFinite(tp1) || !Number.isFinite(tp2)) {
        return {
          success: false,
          message: 'Invalid price values. Please provide valid numbers.',
        };
      }

      const input: StartFuturesAutoBotInput = {
        symbol,
        botMode: mode as 'scalping' | 'intraday',
        direction: 'long',
        entryMid,
        entryZone: { low: entryMid * 0.99, high: entryMid * 1.01 },
        leverage: 5,
        stopLoss: entryMid * 0.98,
        takeProfits: [
          { label: 'TP1', price: tp1 },
          { label: 'TP2', price: tp2 },
        ],
        allocationUnit: 'percent',
        allocationValue: 10,
        notes: ['Telegram command execution'],
        riskReward: null,
        setupGrade: 'B',
        setupGradeRank: 2,
        setupLabel: 'Telegram Command',
        currentPrice: null,
      };

      try {
        const state = await futuresAutoBotService.start(input);
        return {
          success: true,
          message: `✅ Bot started for ${symbol}\nStatus: ${state.status}\nPlan: ${state.plan.entryMid} (TP1: ${state.plan.takeProfits[0]?.price})`,
          data: state,
        };
      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : 'Unknown error';
        return {
          success: false,
          message: `❌ Failed to start bot: ${errorMsg}`,
        };
      }
    }

    case 'stop': {
      try {
        const state = await futuresAutoBotService.stop(symbol);
        if (state) {
          return {
            success: true,
            message: `✅ Bot stopped for ${symbol}`,
            data: state,
          };
        } else {
          return {
            success: false,
            message: `⚠️  No active bot found for ${symbol}`,
          };
        }
      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : 'Unknown error';
        return {
          success: false,
          message: `❌ Failed to stop bot: ${errorMsg}`,
        };
      }
    }

    case 'revalidate': {
      try {
        const state = await futuresAutoBotService.revalidate(symbol);
        if (state) {
          return {
            success: true,
            message: `✅ Bot revalidated for ${symbol}\nPlan source: ${state.planSource}`,
            data: state,
          };
        } else {
          return {
            success: false,
            message: `⚠️  No active bot found for ${symbol}`,
          };
        }
      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : 'Unknown error';
        return {
          success: false,
          message: `❌ Failed to revalidate bot: ${errorMsg}`,
        };
      }
    }

    default:
      return {
        success: false,
        message: `Unknown bot command: ${command}`,
      };
  }
}

async function handleWatchCommand(action: string, symbol?: string): Promise<CommandResult> {
  switch (action) {
    case 'start': {
      try {
        if (symbol) {
          await futuresAutoBotService.recordProgress(symbol);
          return {
            success: true,
            message: `👀 Started monitoring ${symbol}`,
          };
        } else {
          return {
            success: false,
            message: 'Symbol required: watch start <symbol>',
          };
        }
      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : 'Unknown error';
        return {
          success: false,
          message: `❌ Failed to start watch: ${errorMsg}`,
        };
      }
    }

    case 'stop': {
      return {
        success: true,
        message: '⏹️  Stopping watch',
      };
    }

    default:
      return {
        success: false,
        message: `Unknown watch command: ${action}`,
      };
  }
}

export async function executeCommand(args: string[]): Promise<CommandResult> {
  try {
    if (args.length === 0) {
      return {
        success: false,
        message: `Available commands:\n  bot start <symbol> <mode> <entry> <tp1> <tp2> [tp3]\n  bot stop <symbol>\n  bot revalidate <symbol>\n  watch start <symbol>\n  watch stop`,
      };
    }

    const parsed = parseCommand(args);

    if (parsed.type === 'bot') {
      const symbol = parsed.args[0];
      return await handleBotCommand(parsed.action as BotCommand, symbol, parsed.args.slice(1));
    } else if (parsed.type === 'watch') {
      return await handleWatchCommand(parsed.action, parsed.args[0]);
    } else if (parsed.type === 'revalidate') {
      const symbol = parsed.args[0];
      return await handleBotCommand('revalidate', symbol, []);
    } else {
      return {
        success: false,
        message: `Unknown command type: ${parsed.type}`,
      };
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      success: false,
      message: `❌ Error: ${message}`,
    };
  }
}
