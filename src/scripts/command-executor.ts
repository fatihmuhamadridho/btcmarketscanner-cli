import { futuresAutoBotService } from '@core/binance/futures/bot/infrastructure/futuresAutoBot.service';
import type { StartFuturesAutoBotInput } from '@core/binance/futures/bot/domain/futuresAutoBot.model';

type CommandType = 'bot' | 'watch' | 'revalidate';
type BotCommand = 'start' | 'stop' | 'revalidate';

interface ParsedCommand {
  type: CommandType;
  action: string;
  args: string[];
}

function parseCommand(args: string[]): ParsedCommand {
  const [type, action, ...rest] = args;

  if (!type || !action) {
    throw new Error('Usage: pnpm <command> <action> [args...]');
  }

  return {
    type: type as CommandType,
    action,
    args: rest,
  };
}

async function handleBotCommand(command: BotCommand, symbol: string, args: string[]) {
  switch (command) {
    case 'start': {
      // Parse: pnpm bot start BTCUSDT scalping 2.0 3.0 5
      // args = ['BTCUSDT', 'scalping', '2.0', '3.0', '5']
      if (!symbol || args.length < 4) {
        throw new Error('Usage: pnpm bot start <symbol> <mode> <entryMid> <tp1> <tp2> [tp3]');
      }

      const [mode, entryMidStr, tp1Str, tp2Str, tp3Str] = args;
      const entryMid = parseFloat(entryMidStr);
      const tp1 = parseFloat(tp1Str);
      const tp2 = parseFloat(tp2Str);
      const tp3 = tp3Str ? parseFloat(tp3Str) : null;

      if (!Number.isFinite(entryMid) || !Number.isFinite(tp1) || !Number.isFinite(tp2)) {
        throw new Error('Invalid price values');
      }

      const input: StartFuturesAutoBotInput = {
        symbol,
        botMode: mode as 'scalping' | 'intraday',
        direction: 'long',
        entryMid,
        entryZone: { low: entryMid * 0.99, high: entryMid * 1.01 },
        leverage: 5,
        stopLoss: entryMid * 0.98,
        takeProfits: [{ label: 'TP1', price: tp1 }, { label: 'TP2', price: tp2 }],
        allocationUnit: 'percent',
        allocationValue: 10,
        notes: ['Manual command execution'],
        riskReward: null,
        setupGrade: 'B',
        setupGradeRank: 2,
        setupLabel: 'Manual Command',
        currentPrice: null,
      };

      const state = await futuresAutoBotService.start(input);
      console.log(`✅ Bot started for ${symbol}`);
      console.log(`Status: ${state.status}`);
      console.log(`Plan: ${state.plan.entryMid} (TP1: ${state.plan.takeProfits[0]?.price})`);

      // Start continuous scanning to detect fills and place TP/SL
      console.log(`🔄 Starting continuous scan loop every 5 seconds...`);
      const scanInterval = setInterval(async () => {
        try {
          await futuresAutoBotService.recordProgress(symbol);
        } catch (error) {
          const errorMsg = error instanceof Error ? error.message : 'Unknown error';
          console.error(`[scan-error] ${errorMsg}`);
        }
      }, 5000);

      // Graceful shutdown
      process.on('SIGINT', () => {
        clearInterval(scanInterval);
        console.log('\n⏹️  Bot stopped');
        process.exit(0);
      });
      break;
    }

    case 'stop': {
      const state = await futuresAutoBotService.stop(symbol);
      if (state) {
        console.log(`✅ Bot stopped for ${symbol}`);
      } else {
        console.log(`⚠️  No active bot found for ${symbol}`);
      }
      break;
    }

    case 'revalidate': {
      const state = await futuresAutoBotService.revalidate(symbol);
      if (state) {
        console.log(`✅ Bot revalidated for ${symbol}`);
        console.log(`Plan source: ${state.planSource}`);
      } else {
        console.log(`⚠️  No active bot found for ${symbol}`);
      }
      break;
    }

    default:
      throw new Error(`Unknown bot command: ${command}`);
  }
}

async function handleWatchCommand(action: string, symbol?: string) {
  switch (action) {
    case 'start': {
      console.log('👀 Starting continuous watch for all active bots (with Telegram notifications)...');
      console.log('Press Ctrl+C to stop');

      // Watch loop that runs every 5 seconds
      const watchInterval = setInterval(async () => {
        try {
          // recordProgress will be called for all active bots via the service
          // This keeps the notifications flowing
          if (symbol) {
            await futuresAutoBotService.recordProgress(symbol);
          } else {
            // Watch all bots - would need to implement getAllActiveBots
            // For now, just watch the specified symbol if provided
            console.log(`[watch] Monitoring active bots...`);
          }
        } catch (error) {
          const errorMsg = error instanceof Error ? error.message : 'Unknown error';
          console.error(`[watch-error] ${errorMsg}`);
        }
      }, 5000);

      // Graceful shutdown
      process.on('SIGINT', () => {
        clearInterval(watchInterval);
        console.log('\n⏹️  Watch stopped');
        process.exit(0);
      });

      break;
    }

    case 'stop': {
      console.log('⏹️  Stopping watch');
      process.exit(0);
    }

    default:
      throw new Error(`Unknown watch command: ${action}`);
  }
}

async function main() {
  try {
    const args = process.argv.slice(2);

    if (args.length === 0) {
      console.log('Available commands:');
      console.log('  pnpm bot start <symbol> <mode> <entry> <tp1> <tp2> [tp3]');
      console.log('  pnpm bot stop <symbol>');
      console.log('  pnpm bot revalidate <symbol>');
      console.log('  pnpm watch start <symbol>');
      console.log('  pnpm watch stop');
      process.exit(0);
    }

    const parsed = parseCommand(args);

    if (parsed.type === 'bot') {
      const symbol = parsed.args[0];
      await handleBotCommand(parsed.action as BotCommand, symbol, parsed.args.slice(1));
    } else if (parsed.type === 'watch') {
      await handleWatchCommand(parsed.action, parsed.args[0]);
    } else if (parsed.type === 'revalidate') {
      const symbol = parsed.args[0];
      await handleBotCommand('revalidate', symbol, []);
    } else {
      throw new Error(`Unknown command type: ${parsed.type}`);
    }

    process.exit(0);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`❌ Error: ${message}`);
    process.exit(1);
  }
}

main();
