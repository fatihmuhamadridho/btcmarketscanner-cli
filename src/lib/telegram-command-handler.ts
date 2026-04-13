import { futuresAutoBotService } from '@core/binance/futures/bot/infrastructure/futuresAutoBot.service';
import { futuresAutoConsensusService } from '@core/binance/futures/bot/infrastructure/futuresAutoConsensus.service';
import { futuresAutoValidationService } from '@core/binance/futures/bot/infrastructure/futuresAutoValidation.service';
import { futuresAutoTradeService } from '@core/binance/futures/bot/infrastructure/futuresAutoTrade.service';
import { FuturesMarketController } from '@core/binance/futures/market/domain/futuresMarket.controller';
import { telegramService } from '@services/telegram.service';
import { BINANCE_API_KEY, BINANCE_SECRET_KEY, HAS_BINANCE_CREDENTIALS } from '@configs/base.config';
import {
  loadCoinConfig,
  getOrCreateDefaultCoinConfig,
  getAllCoinConfigs,
  updateCoinConfigLeverage,
  updateCoinConfigAllocation,
  updateCoinConfigMarginMode,
  updateCoinConfigBotMode,
} from '@services/coin-config.service';

export interface CommandResult {
  success: boolean;
  message: string;
  data?: unknown;
}

const futuresMarketController = new FuturesMarketController();

// Temporary storage for validation state (symbol -> consensus + validation data)
function stripHtmlTags(html: string | null | undefined): string {
  if (!html) return '';
  return String(html)
    .replace(/<[^>]*>/g, '') // Remove all HTML tags
    .replace(/<[\s\S]*?>/g, '') // Remove multiline tags as fallback
    .replace(/&lt;[^&]*?&gt;/g, '') // Remove encoded HTML tags like &lt;b&gt;
    .replace(/&lt;/g, '') // Remove leftover &lt;
    .replace(/&gt;/g, '') // Remove leftover &gt;
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/\*\*/g, '') // Remove markdown bold
    .replace(/__/g, '') // Remove markdown underline
    .trim(); // Remove extra whitespace
}

// Recursively strip HTML from all string fields in an object
function stripHtmlFromObject(obj: any): any {
  if (typeof obj === 'string') {
    return stripHtmlTags(obj);
  }
  if (Array.isArray(obj)) {
    return obj.map((item) => stripHtmlFromObject(item));
  }
  if (obj !== null && typeof obj === 'object') {
    const cleaned: any = {};
    for (const key in obj) {
      cleaned[key] = stripHtmlFromObject(obj[key]);
    }
    return cleaned;
  }
  return obj;
}

// Send typing indicator every 2 seconds while processing
function startTypingIndicator(): NodeJS.Timeout {
  console.log('[typing-indicator] Starting typing indicator...');
  telegramService.sendTypingIndicator().catch((err) => {
    console.error('[typing-indicator] Failed to send initial typing:', err);
  });

  return setInterval(() => {
    telegramService.sendTypingIndicator().catch((err) => {
      console.error('[typing-indicator] Failed to send typing:', err);
    });
  }, 1500); // Send every 1.5 seconds for more responsive feel
}

function stopTypingIndicator(interval: NodeJS.Timeout): void {
  console.log('[typing-indicator] Stopping typing indicator');
  clearInterval(interval);
}

const pendingValidations = new Map<
  string,
  {
    symbol: string;
    consensus: Awaited<ReturnType<typeof futuresAutoConsensusService.buildConsensus>>;
    currentPrice: number;
    timestamp: number;
    validationResult?: any;
  }
>();

// Track monitoring intervals to cleanup later
const monitoringIntervals = new Map<string, NodeJS.Timeout>();

// Track watched coins for auto-restart (symbol -> { isWatched, lastBotStatus, isProcessing, entryOrderPlacedAt, positionClosedAt })
const watchedCoins = new Map<
  string,
  {
    isWatched: boolean;
    lastBotStatus?: string;
    autoRestartInterval?: NodeJS.Timeout;
    isProcessing?: boolean;
    entryOrderPlacedAt?: number; // Timestamp when entry order was placed
    positionClosedAt?: number; // Timestamp when position was last closed (for cooldown)
  }
>();

// Cleanup expired validations every 5 minutes
setInterval(
  () => {
    const now = Date.now();
    const expiredSymbols: string[] = [];

    for (const [symbol, data] of pendingValidations.entries()) {
      // Expire after 30 minutes
      if (now - data.timestamp > 30 * 60 * 1000) {
        expiredSymbols.push(symbol);
      }
    }

    if (expiredSymbols.length > 0) {
      console.log(`[cleanup] Removing expired validations: ${expiredSymbols.join(', ')}`);
      expiredSymbols.forEach((symbol) => pendingValidations.delete(symbol));
    }
  },
  5 * 60 * 1000,
);

// Cleanup function to call on shutdown
export function cleanupResources(): void {
  console.log('[cleanup] Cleaning up all resources...');

  // Clear all monitoring intervals
  for (const [symbol, interval] of monitoringIntervals.entries()) {
    console.log(`[cleanup] Clearing interval for ${symbol}`);
    clearInterval(interval);
  }
  monitoringIntervals.clear();

  // Clear all auto-restart intervals for watched coins
  for (const [symbol, data] of watchedCoins.entries()) {
    if (data.autoRestartInterval) {
      console.log(`[cleanup] Clearing auto-restart interval for ${symbol}`);
      clearInterval(data.autoRestartInterval);
    }
  }
  watchedCoins.clear();

  // Clear all pending validations
  pendingValidations.clear();

  console.log('[cleanup] Resources cleanup complete');
}

function formatSetupSummary(setup: any): string {
  const lines: string[] = [];

  // Handle both formats (consensus vs openclaw)
  const entryZone = setup.entryZone || setup.entry_zone;
  const stopLoss = setup.stopLoss || setup.stop_loss;
  const takeProfit =
    setup.takeProfits ||
    (setup.take_profit
      ? [
          { label: 'TP1', price: setup.take_profit.tp1 },
          { label: 'TP2', price: setup.take_profit.tp2 },
        ]
      : []);
  const riskReward = setup.riskReward || setup.risk_reward?.tp2;

  const label = stripHtmlTags(setup.label || 'Setup');
  const grade = stripHtmlTags(setup.grade || 'N/A');
  const direction = stripHtmlTags(setup.direction || 'UNKNOWN');

  lines.push(`Setup: ${label}`);
  lines.push(`Grade: ${grade}`);
  lines.push(`Direction: ${direction.toUpperCase()}`);

  if (entryZone) {
    const low = Array.isArray(entryZone) ? entryZone[0] : entryZone.low;
    const high = Array.isArray(entryZone) ? entryZone[1] : entryZone.high;
    if (low !== undefined && high !== undefined) {
      lines.push(`Entry Zone: ${parseFloat(low).toFixed(4)} - ${parseFloat(high).toFixed(4)}`);
    }
  }

  if (stopLoss !== undefined && stopLoss !== null) {
    lines.push(`Stop Loss: ${parseFloat(stopLoss).toFixed(4)}`);
  }

  if (takeProfit && takeProfit.length > 0) {
    const tp1 = takeProfit[0]?.price || takeProfit[0]?.tp1;
    const tp2 = takeProfit[1]?.price || takeProfit[1]?.tp2;
    if (tp1) lines.push(`TP1: ${parseFloat(tp1).toFixed(4)}`);
    if (tp2) lines.push(`TP2: ${parseFloat(tp2).toFixed(4)}`);
  }

  if (riskReward) {
    lines.push(`Risk/Reward: 1:${parseFloat(riskReward).toFixed(2)}`);
  }

  return lines.join('\n');
}

function formatConsensusSummary(consensus: any): string {
  const lines: string[] = [];
  lines.push(`📊 Consensus Summary`);
  lines.push(`Consensus Label: ${consensus.executionConsensusLabel}`);
  lines.push(`\n${formatSetupSummary(consensus.consensusSetup)}`);
  lines.push(`\nTimeframes analyzed: ${consensus.executionBasisLabel}`);
  return lines.join('\n');
}

function formatDetailedConsensusData(consensus: any): string {
  const lines: string[] = [];
  lines.push(`📊 Detailed Consensus Data\n`);
  lines.push(`Consensus Setup: ${consensus.executionConsensusLabel}\n`);

  // Show consensus setup details first
  lines.push(`${formatSetupSummary(consensus.consensusSetup)}\n`);

  // Show per-timeframe data
  lines.push(`\n📈 Timeframe Analysis:`);

  if (consensus.summaries && consensus.summaries.length > 0) {
    consensus.summaries.forEach((summary: any) => {
      const consensusMarker = summary.isConsensus ? ' ⭐' : '';
      lines.push(`\n${summary.interval.toUpperCase()}${consensusMarker}`);
      lines.push(`├ Direction: ${summary.direction?.toUpperCase() || 'N/A'}`);
      lines.push(`├ Support: ${summary.entryZoneLabel?.split(' - ')[0] || 'N/A'}`);
      lines.push(`├ Resistance: ${summary.entryZoneLabel?.split(' - ')[1] || 'N/A'}`);
      lines.push(`├ ATR: ${summary.atrLabel || 'N/A'}`);
      lines.push(`├ RSI: ${summary.rsiLabel || 'N/A'}`);
      lines.push(`└ Grade: ${summary.setupGrade || 'N/A'}`);
    });
  }

  return lines.join('\n');
}

async function handleScanCommand(symbol: string): Promise<CommandResult> {
  try {
    symbol = symbol.toUpperCase();
    console.log(`[telegram-bot] Scanning ${symbol} for consensus...`);

    const typingInterval = startTypingIndicator();

    try {
      // Get current price
      const snapshotResponse = await futuresMarketController.getMarketSymbolSnapshot(symbol);
      const currentPrice = parseFloat(snapshotResponse.data.symbol.ticker.lastPrice as string);

      // Build consensus across all timeframes
      const consensus = await futuresAutoConsensusService.buildConsensus(symbol);

      // Store for later validation
      pendingValidations.set(symbol, {
        symbol,
        consensus,
        currentPrice,
        timestamp: Date.now(),
      });

      const message =
        `✅ Consensus built for ${symbol}\n` +
        `Current Price: ${currentPrice.toFixed(2)}\n\n` +
        `${formatConsensusSummary(consensus)}\n\n` +
        `Next step: /validate ${symbol}`;

      return {
        success: true,
        message,
        data: { consensus, currentPrice },
      };
    } finally {
      stopTypingIndicator(typingInterval);
    }
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : 'Unknown error';
    return {
      success: false,
      message: `❌ Failed to scan ${symbol}: ${errorMsg}`,
    };
  }
}

async function handleValidateCommand(
  symbol: string,
  mode: 'scalping' | 'intraday' = 'scalping',
): Promise<CommandResult> {
  try {
    symbol = symbol.toUpperCase();
    const pendingData = pendingValidations.get(symbol);

    if (!pendingData) {
      return {
        success: false,
        message: `⚠️ No consensus data found for ${symbol}. Please run /scan ${symbol} first.`,
      };
    }

    // Check if data is stale (older than 30 minutes)
    if (Date.now() - pendingData.timestamp > 30 * 60 * 1000) {
      pendingValidations.delete(symbol);
      return {
        success: false,
        message: `⚠️ Consensus data expired. Please run /scan ${symbol} again.`,
      };
    }

    console.log(`[telegram-bot] Validating ${symbol} with OpenClaw...`);

    const typingInterval = startTypingIndicator();

    try {
      const { consensus, currentPrice } = pendingData;

      // Validate with OpenClaw
      const rawValidationResult = await futuresAutoValidationService.validateSetup(
        {
          symbol,
          botMode: mode,
          consensusSetup: consensus.consensusSetup,
          currentPrice,
          leverage: 5,
          accountSize: null,
          isPerpetual: true,
          timeframeSnapshots: consensus.snapshots,
        },
        { bypassCache: true },
      );

      // Strip HTML from the entire validation result
      const validationResult = stripHtmlFromObject(rawValidationResult);

      // Use validated setup if accepted, otherwise try suggested setup
      const setupToUse =
        validationResult.validation_result === 'accepted'
          ? validationResult.validated_setup
          : validationResult.suggested_setup;

      if (setupToUse) {
        // Store validation result for execute command
        const pendingData = pendingValidations.get(symbol);
        if (pendingData) {
          pendingData.validationResult = validationResult;
          pendingValidations.set(symbol, pendingData);
        }

        const statusEmoji = validationResult.validation_result === 'accepted' ? '✅' : '⚠️';
        const statusText = validationResult.validation_result === 'accepted' ? 'APPROVED' : 'SUGGESTED';

        const notes = (validationResult.adjustment_notes || [])
          .map((note: string) => stripHtmlTags(note))
          .filter((note: string) => note.trim());
        const notesText = notes.length > 0 ? `\nNotes:\n${notes.map((n: string) => `• ${n}`).join('\n')}` : '';

        // Add volatility warning if available
        let volatilityWarning = '';
        const validationRawData = rawValidationResult as any;
        if (validationRawData?.current_context?.volatility_state === 'high') {
          volatilityWarning = '\n⚠️ HIGH VOLATILITY: Use tight stops & close profits!';
        } else if (validationRawData?.current_context?.volatility_state === 'extreme') {
          volatilityWarning = '\n🔴 EXTREME VOLATILITY: Very risky. Use tiny stops only!';
        }

        const message =
          `${statusEmoji} OpenClaw ${statusText} a setup!\n` +
          `Confidence: ${(validationResult.confidence * 100).toFixed(0)}%\n` +
          `Next Action: ${validationResult.next_action}${volatilityWarning}\n\n` +
          `${formatSetupSummary(setupToUse)}${notesText}\n\n` +
          `Execute trade: /execute ${symbol}`;

        // Debug: log message content to check for HTML
        console.log(`[validate-debug] Message to send (length: ${message.length}):`);
        console.log(`[validate-debug] Contains <b>: ${message.includes('<b>')}`);
        console.log(`[validate-debug] Contains <code>: ${message.includes('<code>')}`);
        if (message.includes('<')) {
          console.log(`[validate-debug] Full message:\n${message}`);
        }

        return {
          success: true,
          message,
          data: validationResult,
        };
      } else {
        const reasons = (validationResult.adjustment_notes || []).map((note: string) => stripHtmlTags(note)).join('\n');

        const reasonText = stripHtmlTags(validationResult.reason || '');

        const message =
          `❌ OpenClaw could not provide a setup\n` +
          `Confidence: ${(validationResult.confidence * 100).toFixed(0)}%\n` +
          `Reason: ${reasonText || reasons || 'No details provided'}\n\n` +
          `Next Action: ${validationResult.next_action}`;

        return {
          success: false,
          message,
          data: validationResult,
        };
      }
    } finally {
      stopTypingIndicator(typingInterval);
    }
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : 'Unknown error';
    return {
      success: false,
      message: `❌ Validation failed: ${errorMsg}`,
    };
  }
}

async function handleExecuteCommand(symbol: string): Promise<CommandResult> {
  try {
    symbol = symbol.toUpperCase();
    const pendingData = pendingValidations.get(symbol);

    if (!pendingData) {
      return {
        success: false,
        message: `⚠️ No consensus data found for ${symbol}. Please run /scan ${symbol} first.`,
      };
    }

    console.log(`[telegram-bot] Executing trade for ${symbol}...`);

    // Load coin config for settings
    const coinConfig = await loadCoinConfig(symbol);
    const globalConfig = await loadCoinConfig('GLOBAL');
    const marginMode = (coinConfig?.marginMode || globalConfig?.marginMode || 'isolated') as 'isolated' | 'cross';

    const { consensus, currentPrice, validationResult } = pendingData;

    // Use validated setup if available, otherwise use consensus
    let setupToExecute: any;
    let setupSource = 'Consensus';

    if (validationResult?.validation_result === 'accepted') {
      setupToExecute = validationResult.validated_setup;
      setupSource = 'OpenClaw Validated';
    } else if (validationResult?.suggested_setup) {
      setupToExecute = validationResult.suggested_setup;
      setupSource = 'OpenClaw Suggested';
    } else {
      setupToExecute = consensus.consensusSetup;
      setupSource = 'Consensus';
    }

    // Execute the bot with validated setup
    const state = await futuresAutoBotService.start({
      symbol,
      botMode: 'scalping',
      direction: setupToExecute.direction as 'long' | 'short',
      entryMid: setupToExecute.entry_zone
        ? setupToExecute.entry_zone[0] + (setupToExecute.entry_zone[1] - setupToExecute.entry_zone[0]) / 2
        : setupToExecute.entryZone.low + (setupToExecute.entryZone.high - setupToExecute.entryZone.low) / 2,
      entryZone: setupToExecute.entry_zone
        ? {
            low: Math.min(setupToExecute.entry_zone[0], setupToExecute.entry_zone[1]),
            high: Math.max(setupToExecute.entry_zone[0], setupToExecute.entry_zone[1]),
          }
        : {
            low: setupToExecute.entryZone.low,
            high: setupToExecute.entryZone.high,
          },
      leverage: 5,
      marginMode,
      stopLoss: setupToExecute.stop_loss ?? setupToExecute.stopLoss,
      takeProfits: setupToExecute.take_profit
        ? [
            { label: 'TP1', price: setupToExecute.take_profit.tp1 },
            { label: 'TP2', price: setupToExecute.take_profit.tp2 },
          ]
        : setupToExecute.takeProfits.filter((tp: any) => tp.price !== null),
      allocationUnit: 'percent',
      allocationValue: 10,
      notes: [`Executed via Telegram bot (${setupSource}, marginMode: ${marginMode})`],
      riskReward: setupToExecute.risk_reward?.tp2 ?? setupToExecute.riskReward,
      setupGrade: setupToExecute.grade || 'A',
      setupGradeRank: setupToExecute.gradeRank || 1,
      setupLabel: `${setupSource} Setup`,
      currentPrice,
    });

    // Clear pending validation
    pendingValidations.delete(symbol);

    // Check credentials first
    console.log(`[telegram-bot] Checking Binance credentials...`);
    const hasCredentials = HAS_BINANCE_CREDENTIALS();
    const apiKey = BINANCE_API_KEY();
    const secretKey = BINANCE_SECRET_KEY();

    if (!hasCredentials) {
      console.error(`[telegram-bot] ❌ CRITICAL: Binance credentials missing!`);
      console.error(`[telegram-bot] API Key: ${apiKey ? '✅ SET' : '❌ MISSING'}`);
      console.error(`[telegram-bot] Secret Key: ${secretKey ? '✅ SET' : '❌ MISSING'}`);
    } else {
      console.log(`[telegram-bot] ✅ Binance credentials OK`);
      console.log(`[telegram-bot] API Key: ${apiKey?.substring(0, 10)}...`);
    }

    // Start monitoring loop with logging
    console.log(`[telegram-bot] Starting monitoring loop for ${symbol}...`);
    let scanCount = 0;
    let lastErrorLogged = '';

    const monitorInterval = setInterval(async () => {
      scanCount++;
      try {
        const snapshot = await futuresMarketController.getMarketSymbolSnapshot(symbol);
        const currentPrice = parseFloat(snapshot.data.symbol.ticker.lastPrice as string);
        const entryLow = state.plan.entryZone.low ?? 0;
        const entryHigh = state.plan.entryZone.high ?? 0;
        const inZone = currentPrice >= entryLow && currentPrice <= entryHigh;

        console.log(
          `[scan #${scanCount}] ${symbol} @ ${currentPrice.toFixed(4)} | ` +
            `Zone: ${entryLow.toFixed(4)}-${entryHigh.toFixed(4)} | ` +
            `${inZone ? '🎯 IN ZONE' : '⏳ Waiting'}`,
        );

        try {
          const botState = await futuresAutoBotService.recordProgress(symbol);

          // Check if position was closed (transitioned from entry_placed to no execution)
          if (botState && state.status === 'entry_placed' && !botState.execution) {
            console.log(`[scan #${scanCount}] 📊 Position closed detected for ${symbol}`);
            clearInterval(monitorInterval);
            monitoringIntervals.delete(symbol);
            await telegramService.sendMessage(
              `📊 Position Closed for ${symbol}\n` +
              `Status: ${botState.status}\n` +
              `Monitoring stopped.`,
            );
            return;
          }

          if (lastErrorLogged) {
            console.log(`[scan #${scanCount}] ✅ recordProgress recovered - error cleared`);
            lastErrorLogged = '';
          }
        } catch (progressError) {
          const progressErrorMsg = progressError instanceof Error ? progressError.message : String(progressError);

          // Only log if error changed (avoid spam)
          if (progressErrorMsg !== lastErrorLogged) {
            console.error(`[scan #${scanCount}] ❌ recordProgress FAILED`);
            console.error(`[scan #${scanCount}] Error Details: ${progressErrorMsg}`);

            if (progressError instanceof Error && progressError.stack) {
              console.error(`[scan #${scanCount}] Stack Trace:`);
              progressError.stack.split('\n').forEach((line) => {
                console.error(`[scan #${scanCount}]   ${line}`);
              });
            }
            lastErrorLogged = progressErrorMsg;
          }
        }
      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : 'Unknown error';
        console.error(`[scan #${scanCount}] ❌ CRITICAL ERROR: ${errorMsg}`);

        if (error instanceof Error && error.stack) {
          console.error(`[scan #${scanCount}] Stack Trace:`);
          error.stack.split('\n').forEach((line) => {
            console.error(`[scan #${scanCount}]   ${line}`);
          });
        }
      }
    }, 5000); // Scan setiap 5 detik

    // Store interval ID untuk cleanup later
    // If there's an old interval, clear it first
    const oldInterval = monitoringIntervals.get(symbol);
    if (oldInterval) {
      console.log(`[cleanup] Clearing old monitoring interval for ${symbol}`);
      clearInterval(oldInterval);
    }
    monitoringIntervals.set(symbol, monitorInterval);

    const message =
      `🚀 Bot started for ${symbol}\n` +
      `Setup Source: ${setupSource}\n` +
      `Status: ${state.status}\n` +
      `Direction: ${state.plan.direction.toUpperCase()}\n` +
      `Entry Zone: ${(state.plan.entryZone.low ?? 0).toFixed(4)} - ${(state.plan.entryZone.high ?? 0).toFixed(4)}\n` +
      `Stop Loss: ${(state.plan.stopLoss ?? 0).toFixed(4)}\n` +
      `TP1: ${state.plan.takeProfits[0]?.price?.toFixed(4) || 'n/a'}\n` +
      `TP2: ${state.plan.takeProfits[1]?.price?.toFixed(4) || 'n/a'}\n\n` +
      `🔄 Scanning every 5 seconds...`;

    return {
      success: true,
      message,
      data: state,
    };
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : 'Unknown error';
    return {
      success: false,
      message: `❌ Failed to execute trade: ${errorMsg}`,
    };
  }
}

async function handleStopCommand(symbol: string): Promise<CommandResult> {
  try {
    symbol = symbol.toUpperCase();

    // Cleanup monitoring interval
    const interval = monitoringIntervals.get(symbol);
    if (interval) {
      console.log(`[cleanup] Clearing monitoring interval for ${symbol}`);
      clearInterval(interval);
      monitoringIntervals.delete(symbol);
    }

    // Cleanup pending validation data
    pendingValidations.delete(symbol);

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
        message: `⚠️ No active bot found for ${symbol}`,
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

async function handleSetupCommand(subcommand: string, ...args: string[]): Promise<CommandResult> {
  try {
    if (!subcommand) {
      return {
        success: false,
        message:
          `Setup Commands:\n\n` +
          `Global (for all coins):\n` +
          `/setup show - Show current settings\n` +
          `/setup mode <scalping|intraday> - Set trading mode\n` +
          `/setup leverage <value> - Set leverage (1, 2, 5, 10, 20)\n` +
          `/setup allocation <unit> <value> - Set allocation\n` +
          `/setup margin <mode> - Set margin mode\n\n` +
          `Per-Coin (specific coin only):\n` +
          `/setup show <symbol> - Show settings for coin\n` +
          `/setup mode <scalping|intraday> <symbol> - Set mode for coin\n` +
          `/setup leverage <value> <symbol> - Set leverage for coin\n` +
          `/setup allocation <unit> <value> <symbol> - Set allocation for coin\n` +
          `/setup margin <mode> <symbol> - Set margin mode for coin`,
      };
    }

    const command = subcommand.toLowerCase();

    // Determine if this is per-coin or global
    // For leverage: /setup leverage <value> [symbol]
    // For allocation: /setup allocation <unit> <value> [symbol]
    // For margin: /setup margin <mode> [symbol]
    // For show: /setup show [symbol]

    let targetSymbol = 'GLOBAL';
    let configArgs = args;

    // Check if last argument is a valid symbol (all uppercase, not a number/unit)
    if (args.length > 0) {
      const lastArg = args[args.length - 1];
      // Check if it looks like a symbol (contains letters, 3-6 chars, ends with USDT/BUSD etc)
      if (/^[A-Z]{2,}USDT$|^[A-Z]{2,}BUSD$|^[A-Z]{2,}USDC$/.test(lastArg)) {
        targetSymbol = lastArg;
        configArgs = args.slice(0, -1);
      }
    }

    if (command === 'show') {
      // If no symbol specified, show ALL coins
      if (configArgs.length === 0 && !args.some((arg) => /^[A-Z]{2,}USDT$|^[A-Z]{2,}BUSD$|^[A-Z]{2,}USDC$/.test(arg))) {
        const allConfigs = await getAllCoinConfigs();
        let msg = `📊 All Coin Settings\n\n`;

        if (allConfigs.length === 0) {
          msg += `No coin configs found. Using global defaults.\n\n`;
          const globalConfig = await getOrCreateDefaultCoinConfig('GLOBAL');
          msg += `🌍 Global Settings:\n`;
          msg += `Mode: ${globalConfig.botMode || 'scalping'}\n`;
          msg += `Leverage: ${globalConfig.leverage || 5}x\n`;
          msg += `Allocation: ${globalConfig.allocation.value || 10} ${globalConfig.allocation.type || 'percent'}\n`;
          msg += `Margin Mode: ${globalConfig.marginMode || 'isolated'}`;
        } else {
          for (const config of allConfigs) {
            const leverage = config.leverage || 5;
            const allocationUnit = config.allocation.type || 'percent';
            const allocationValue = config.allocation.value || 10;
            const marginMode = config.marginMode || 'isolated';
            const botMode = config.botMode || 'scalping';
            const isGlobal = config.symbol === 'GLOBAL';

            const leverageSource = !isGlobal && config.leverage ? '(coin-specific)' : isGlobal ? '' : '(using global)';
            const allocationSource = !isGlobal && config.allocation?.value ? '(coin-specific)' : isGlobal ? '' : '(using global)';
            const marginSource = !isGlobal && config.marginMode ? '(coin-specific)' : isGlobal ? '' : '(using global)';
            const modeSource = !isGlobal && config.botMode ? '(coin-specific)' : isGlobal ? '' : '(using global)';

            const label = isGlobal ? '🌍 Global Settings' : `💰 ${config.symbol}`;
            msg += `${label}:\n`;
            msg += `Mode: ${botMode} ${modeSource}\n`;
            msg += `Leverage: ${leverage}x ${leverageSource}\n`;
            msg += `Allocation: ${allocationValue} ${allocationUnit} ${allocationSource}\n`;
            msg += `Margin Mode: ${marginMode} ${marginSource}\n\n`;
          }
        }

        return {
          success: true,
          message: msg.trim(),
        };
      }

      // Show specific coin
      const config = await getOrCreateDefaultCoinConfig(targetSymbol);
      const globalConfig = await getOrCreateDefaultCoinConfig('GLOBAL');

      const leverage = config.leverage || 5;
      const allocationUnit = config.allocation.type || 'percent';
      const allocationValue = config.allocation.value || 10;
      const marginMode = config.marginMode || 'isolated';
      const botMode = config.botMode || 'scalping';

      const scopeLabel = targetSymbol === 'GLOBAL' ? 'Global Settings' : `${targetSymbol} Settings`;
      const isGlobal = targetSymbol === 'GLOBAL';

      // Show source of each setting (coin-specific or global default)
      const leverageSource = !isGlobal && config.leverage ? '(coin-specific)' : isGlobal ? '' : '(using global)';
      const allocationSource = !isGlobal && config.allocation?.value ? '(coin-specific)' : isGlobal ? '' : '(using global)';
      const marginSource = !isGlobal && config.marginMode ? '(coin-specific)' : isGlobal ? '' : '(using global)';
      const modeSource = !isGlobal && config.botMode ? '(coin-specific)' : isGlobal ? '' : '(using global)';

      let msg = `📊 ${scopeLabel}\n\n`;
      msg += `Mode: ${botMode} ${modeSource}\n`;
      msg += `Leverage: ${leverage}x ${leverageSource}\n`;
      msg += `Allocation: ${allocationValue} ${allocationUnit} ${allocationSource}\n`;
      msg += `Margin Mode: ${marginMode} ${marginSource}`;

      // If showing a coin, also show global defaults for reference
      if (!isGlobal) {
        const globalLeverage = globalConfig.leverage || 5;
        const globalAllocationValue = globalConfig.allocation.value || 10;
        const globalAllocationUnit = globalConfig.allocation.type || 'percent';
        const globalMarginMode = globalConfig.marginMode || 'isolated';
        const globalBotMode = globalConfig.botMode || 'scalping';

        msg += `\n\n🌍 Global Defaults (for reference):\n`;
        msg += `Mode: ${globalBotMode}\n`;
        msg += `Leverage: ${globalLeverage}x\n`;
        msg += `Allocation: ${globalAllocationValue} ${globalAllocationUnit}\n`;
        msg += `Margin Mode: ${globalMarginMode}`;
      }

      return {
        success: true,
        message: msg,
      };
    }

    if (command === 'leverage') {
      const leverage = parseInt(configArgs[0], 10);

      if (!leverage || ![1, 2, 5, 10, 20].includes(leverage)) {
        return {
          success: false,
          message: `❌ Invalid leverage. Available: 1, 2, 5, 10, 20`,
        };
      }

      await updateCoinConfigLeverage(targetSymbol, leverage);
      const scope = targetSymbol === 'GLOBAL' ? 'Global leverage' : `${targetSymbol} leverage`;
      return {
        success: true,
        message: `✅ ${scope} updated to ${leverage}x`,
      };
    }

    if (command === 'allocation') {
      const unit = configArgs[0]?.toLowerCase();
      const value = parseFloat(configArgs[1]);

      if (!unit || !['percent', 'usdt'].includes(unit)) {
        return {
          success: false,
          message: `❌ Invalid unit. Use: percent or usdt`,
        };
      }

      if (!Number.isFinite(value) || value <= 0) {
        return {
          success: false,
          message: `❌ Invalid value. Must be a positive number`,
        };
      }

      await updateCoinConfigAllocation(targetSymbol, {
        type: unit as 'percent' | 'usdt',
        value,
      });
      const scope = targetSymbol === 'GLOBAL' ? 'Global allocation' : `${targetSymbol} allocation`;
      return {
        success: true,
        message: `✅ ${scope} updated to ${value} ${unit}`,
      };
    }

    if (command === 'mode') {
      const botMode = configArgs[0]?.toLowerCase();

      if (!botMode || !['scalping', 'intraday'].includes(botMode)) {
        return {
          success: false,
          message: `❌ Invalid mode. Use: scalping or intraday`,
        };
      }

      await updateCoinConfigBotMode(targetSymbol, botMode as 'scalping' | 'intraday');
      const scope = targetSymbol === 'GLOBAL' ? 'Global mode' : `${targetSymbol} mode`;
      return {
        success: true,
        message: `✅ ${scope} updated to ${botMode}`,
      };
    }

    if (command === 'margin') {
      const mode = configArgs[0]?.toLowerCase();

      if (!mode || !['isolated', 'cross'].includes(mode)) {
        return {
          success: false,
          message: `❌ Invalid margin mode. Use: isolated or cross`,
        };
      }

      await updateCoinConfigMarginMode(targetSymbol, mode as 'isolated' | 'cross');
      const scope = targetSymbol === 'GLOBAL' ? 'Global margin mode' : `${targetSymbol} margin mode`;
      return {
        success: true,
        message: `✅ ${scope} updated to ${mode}`,
      };
    }

    return {
      success: false,
      message: `❌ Unknown setup command: ${command}`,
    };
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : 'Unknown error';
    return {
      success: false,
      message: `❌ Setup failed: ${errorMsg}`,
    };
  }
}

async function handleMarketCommand(subcommand: string): Promise<CommandResult> {
  try {
    const typingInterval = startTypingIndicator();

    try {
      const overview = await futuresMarketController.getMarketOverview();
      const items = overview.data;

      if (!items || items.length === 0) {
        return {
          success: false,
          message: `❌ No market data available`,
        };
      }

      const lowerSub = subcommand?.toLowerCase();

      switch (lowerSub) {
        case 'volume':
        case 'top_volume': {
          const top = items.slice(0, 10);
          const lines = ['📊 TOP 10 BY VOLUME (24H)\n'];
          top.forEach((item: any, idx: number) => {
            const price = parseFloat(item.ticker.lastPrice as string).toFixed(4);
            const change = item.ticker.displayChange;
            const changeEmoji =
              item.ticker.priceChangePercent && parseFloat(item.ticker.priceChangePercent as string) >= 0 ? '📈' : '📉';
            lines.push(
              `${idx + 1}. ${item.symbol}\n` +
                `   Price: $${price} ${changeEmoji} ${change}\n` +
                `   Volume: $${item.ticker.displayVolume}\n`,
            );
          });
          return {
            success: true,
            message: lines.join(''),
          };
        }

        case 'gainers':
        case 'top_gainers': {
          const sorted = [...items].sort((a, b) => {
            const aChange = parseFloat(a.ticker.priceChangePercent as string) || 0;
            const bChange = parseFloat(b.ticker.priceChangePercent as string) || 0;
            return bChange - aChange;
          });
          const top = sorted.slice(0, 10);
          const lines = ['🚀 TOP 10 GAINERS (24H)\n'];
          top.forEach((item: any, idx: number) => {
            const price = parseFloat(item.ticker.lastPrice as string).toFixed(4);
            const change = item.ticker.displayChange;
            lines.push(
              `${idx + 1}. ${item.symbol}\n` +
                `   Price: $${price} 📈 ${change}\n` +
                `   Volume: $${item.ticker.displayVolume}\n`,
            );
          });
          return {
            success: true,
            message: lines.join(''),
          };
        }

        case 'losers':
        case 'top_losers': {
          const sorted = [...items].sort((a, b) => {
            const aChange = parseFloat(a.ticker.priceChangePercent as string) || 0;
            const bChange = parseFloat(b.ticker.priceChangePercent as string) || 0;
            return aChange - bChange;
          });
          const top = sorted.slice(0, 10);
          const lines = ['📉 TOP 10 LOSERS (24H)\n'];
          top.forEach((item: any, idx: number) => {
            const price = parseFloat(item.ticker.lastPrice as string).toFixed(4);
            const change = item.ticker.displayChange;
            lines.push(
              `${idx + 1}. ${item.symbol}\n` +
                `   Price: $${price} 📉 ${change}\n` +
                `   Volume: $${item.ticker.displayVolume}\n`,
            );
          });
          return {
            success: true,
            message: lines.join(''),
          };
        }

        default: {
          // Quick market overview
          const totalVolume = items.reduce((sum: number, item: any) => {
            return sum + (parseFloat(item.ticker.quoteVolume as string) || 0);
          }, 0);

          const gainers = items.filter((item: any) => {
            const change = parseFloat(item.ticker.priceChangePercent as string) || 0;
            return change > 0;
          }).length;

          const losers = items.length - gainers;
          const avgChange =
            items.reduce((sum: number, item: any) => {
              return sum + (parseFloat(item.ticker.priceChangePercent as string) || 0);
            }, 0) / items.length;

          const topVolume = items.slice(0, 3);
          const topGainers = [...items]
            .sort((a, b) => {
              const aChange = parseFloat(a.ticker.priceChangePercent as string) || 0;
              const bChange = parseFloat(b.ticker.priceChangePercent as string) || 0;
              return bChange - aChange;
            })
            .slice(0, 3);

          const topLosers = [...items]
            .sort((a, b) => {
              const aChange = parseFloat(a.ticker.priceChangePercent as string) || 0;
              const bChange = parseFloat(b.ticker.priceChangePercent as string) || 0;
              return aChange - bChange;
            })
            .slice(0, 3);

          const lines = [
            '📊 MARKET OVERVIEW\n',
            `Total Symbols: ${items.length}`,
            `Total 24h Volume: $${(totalVolume / 1e9).toFixed(2)}B`,
            `Gainers: ${gainers} | Losers: ${losers}`,
            `Avg Change: ${avgChange >= 0 ? '+' : ''}${avgChange.toFixed(2)}%\n`,
            `🔝 TOP 3 BY VOLUME:`,
            ...topVolume.map((item, idx) => `${idx + 1}. ${item.symbol}: $${item.ticker.displayVolume}`),
            `\n🚀 TOP 3 GAINERS:`,
            ...topGainers.map((item, idx) => `${idx + 1}. ${item.symbol}: ${item.ticker.displayChange}`),
            `\n📉 TOP 3 LOSERS:`,
            ...topLosers.map((item, idx) => `${idx + 1}. ${item.symbol}: ${item.ticker.displayChange}`),
          ];

          return {
            success: true,
            message: lines.join('\n'),
          };
        }
      }
    } finally {
      stopTypingIndicator(typingInterval);
    }
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : 'Unknown error';
    return {
      success: false,
      message: `❌ Market command failed: ${errorMsg}`,
    };
  }
}

async function handleWatchingCommand(): Promise<CommandResult> {
  try {
    const watchedList = Array.from(watchedCoins.entries())
      .filter(([, data]) => data.isWatched)
      .map(([symbol]) => symbol);

    // Also check for coins with active positions (might be watched but lost in memory after restart)
    const activePositions: string[] = [];
    for (const [symbol, data] of watchedCoins.entries()) {
      if (data.isWatched) continue; // Already counted above
      try {
        const botState = await futuresAutoBotService.recordProgress(symbol);
        if (botState?.status && botState.status !== 'idle') {
          activePositions.push(symbol);
        }
      } catch (error) {
        // No active position for this symbol
      }
    }

    const allWatched = [...new Set([...watchedList, ...activePositions])];

    if (allWatched.length === 0) {
      return {
        success: true,
        message: `📭 No coins are currently being watched\n\nStart watching with: /watch <symbol>`,
      };
    }

    const lines = ['👁️ Currently Watching:\n'];
    allWatched.forEach((symbol, idx) => {
      const isInMemory = watchedList.includes(symbol);
      const status = isInMemory ? '✅' : '⚠️ (needs re-add)';
      lines.push(`${idx + 1}. ${symbol} ${status}`);
    });
    lines.push(`\n💡 Stop watching: /unwatch <symbol>`);
    lines.push(`💡 Re-add after restart: /watch <symbol>`);

    return {
      success: true,
      message: lines.join('\n'),
    };
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : 'Unknown error';
    return {
      success: false,
      message: `❌ Failed to get watched coins: ${errorMsg}`,
    };
  }
}

async function handleWatchCommand(symbols: string[]): Promise<CommandResult> {
  try {
    if (symbols.length === 0) {
      return {
        success: false,
        message: `❌ Please provide at least one symbol\nUsage: /watch <symbol> [symbol2] [symbol3] ...`,
      };
    }

    const upperSymbols = symbols.map((s) => s.toUpperCase());
    const alreadyWatched: string[] = [];
    const nowWatching: string[] = [];

    for (const symbol of upperSymbols) {
      const watched = watchedCoins.get(symbol);
      if (watched?.isWatched) {
        alreadyWatched.push(symbol);
      } else {
        // Start watching this symbol - first check if there's an active position
        let currentBotStatus = 'idle';
        try {
          const botState = await futuresAutoBotService.recordProgress(symbol);
          if (botState?.status) {
            currentBotStatus = botState.status;
            console.log(`[watch] Found existing position for ${symbol} with status: ${currentBotStatus}`);
          }
        } catch (error) {
          console.log(`[watch] No existing position for ${symbol}, starting fresh`);
        }

        watchedCoins.set(symbol, {
          isWatched: true,
          lastBotStatus: currentBotStatus,
          isProcessing: false,
        });
        nowWatching.push(symbol);

        // If there's an active position, setup monitoring. Otherwise, trigger initial scan
        if (currentBotStatus !== 'idle') {
          console.log(`[watch] Position already active for ${symbol}, setting up monitoring`);
          setupWatchModeMonitoring(symbol);
        } else {
          // Trigger initial scan for this symbol
          console.log(`[watch] Starting watch for ${symbol} - no active position`);
          void triggerAutoScanValidateExecute(symbol);
        }
      }
    }

    let message = `🔍 Watch mode activated\n\n`;
    if (nowWatching.length > 0) {
      message += `Started watching: ${nowWatching.join(', ')}\n`;
      message += `Initial scan will start now...\n\n`;
    }
    if (alreadyWatched.length > 0) {
      message += `Already watching: ${alreadyWatched.join(', ')}\n`;
    }

    return {
      success: true,
      message,
    };
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : 'Unknown error';
    return {
      success: false,
      message: `❌ Watch failed: ${errorMsg}`,
    };
  }
}

async function handleUnwatchCommand(symbols: string[]): Promise<CommandResult> {
  try {
    if (symbols.length === 0) {
      return {
        success: false,
        message: `❌ Please provide at least one symbol\nUsage: /unwatch <symbol> [symbol2] [symbol3] ...`,
      };
    }

    const upperSymbols = symbols.map((s) => s.toUpperCase());
    const wasWatched: string[] = [];
    const notWatched: string[] = [];

    for (const symbol of upperSymbols) {
      const watched = watchedCoins.get(symbol);
      if (watched?.isWatched) {
        // Stop watching
        if (watched.autoRestartInterval) {
          clearInterval(watched.autoRestartInterval);
        }
        watchedCoins.delete(symbol);
        wasWatched.push(symbol);
        console.log(`[unwatch] Stopped watching ${symbol}`);
      } else {
        notWatched.push(symbol);
      }
    }

    let message = `⏹️ Watch mode stopped\n\n`;
    if (wasWatched.length > 0) {
      message += `Stopped watching: ${wasWatched.join(', ')}\n`;
    }
    if (notWatched.length > 0) {
      message += `Not being watched: ${notWatched.join(', ')}\n`;
    }

    return {
      success: true,
      message,
    };
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : 'Unknown error';
    return {
      success: false,
      message: `❌ Unwatch failed: ${errorMsg}`,
    };
  }
}

// Auto scan-validate-execute cycle for watched coins
async function triggerAutoScanValidateExecute(symbol: string): Promise<void> {
  try {
    // Prevent multiple simultaneous validations - SET FLAG IMMEDIATELY to block race conditions
    let watched = watchedCoins.get(symbol);
    if (watched?.isProcessing) {
      console.log(`[auto-cycle] ${symbol} is already processing, skipping...`);
      return;
    }

    // Mark as processing IMMEDIATELY to prevent race conditions
    if (watched) {
      watched.isProcessing = true;
      watchedCoins.set(symbol, watched);
      console.log(`[auto-cycle] Locked ${symbol} for processing (race condition protection)`);
    }

    // Check if position close cooldown (3 minutes) has passed
    const POSITION_CLOSE_COOLDOWN_MS = 3 * 60 * 1000; // 3 minutes
    if (watched?.positionClosedAt) {
      const timeSinceClose = Date.now() - watched.positionClosedAt;
      if (timeSinceClose < POSITION_CLOSE_COOLDOWN_MS) {
        const remainingSeconds = Math.ceil((POSITION_CLOSE_COOLDOWN_MS - timeSinceClose) / 1000);
        console.log(
          `[auto-cycle] Position close cooldown still active for ${symbol}, ${remainingSeconds}s remaining. Skipping cycle start.`,
        );
        // UNLOCK before returning since we're not processing
        if (watched) {
          watched.isProcessing = false;
          watchedCoins.set(symbol, watched);
        }
        // Reschedule for after cooldown expires
        const timeoutId = setTimeout(() => {
          if (watchedCoins.get(symbol)?.isWatched) {
            void triggerAutoScanValidateExecute(symbol);
          }
        }, POSITION_CLOSE_COOLDOWN_MS - timeSinceClose + 1000);

        watched.autoRestartInterval = timeoutId;
        watchedCoins.set(symbol, watched);
        return;
      } else {
        // Cooldown expired, clear the timestamp
        watched.positionClosedAt = undefined;
        watchedCoins.set(symbol, watched);
      }
    }

    console.log(`[auto-cycle] Starting auto-cycle for ${symbol}`);

    // Load per-coin settings (or fall back to global)
    const coinConfig = await loadCoinConfig(symbol);
    const globalConfig = await loadCoinConfig('GLOBAL');
    const leverage = coinConfig?.leverage || globalConfig?.leverage || 5;
    const allocationUnit = coinConfig?.allocation?.type || globalConfig?.allocation?.type || 'percent';
    const allocationValue = coinConfig?.allocation?.value || globalConfig?.allocation?.value || 10;
    const botMode = (coinConfig?.botMode || globalConfig?.botMode || 'scalping') as 'scalping' | 'intraday';
    const marginMode = (coinConfig?.marginMode || globalConfig?.marginMode || 'isolated') as 'isolated' | 'cross';

    console.log(`[auto-cycle] Using settings for ${symbol}: mode=${botMode}, leverage=${leverage}, allocation=${allocationValue}${allocationUnit}, marginMode=${marginMode}`);

    // Get account size for validation
    let accountSize: number | null = null;
    try {
      const account = await futuresAutoTradeService.getAccount();
      if (account?.totalWalletBalance) {
        accountSize = parseFloat(account.totalWalletBalance);
        console.log(`[auto-cycle] Account balance: ${accountSize} USDT`);
      }
    } catch (error) {
      console.warn(`[auto-cycle] Failed to get account balance: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }

    // Step 1: Scan
    console.log(`[auto-cycle] Scanning ${symbol}...`);
    const snapshotResponse = await futuresMarketController.getMarketSymbolSnapshot(symbol);
    const currentPrice = parseFloat(snapshotResponse.data.symbol.ticker.lastPrice as string);

    const consensus = await futuresAutoConsensusService.buildConsensus(symbol);

    // Store consensus data for potential /validate command usage
    pendingValidations.set(symbol, {
      symbol,
      consensus,
      currentPrice,
      timestamp: Date.now(),
    });

    // Send detailed consensus data to Telegram before validation
    const consensusMessage = formatDetailedConsensusData(consensus);
    await telegramService.sendMessage(`🔍 Scanning ${symbol}...\n\n${consensusMessage}`);

    // Step 2: Validate
    console.log(`[auto-cycle] Validating ${symbol} (${botMode}) with accountSize=${accountSize}...`);
    const rawValidationResult = await futuresAutoValidationService.validateSetup(
      {
        symbol,
        botMode,
        consensusSetup: consensus.consensusSetup,
        currentPrice,
        leverage,
        accountSize,
        isPerpetual: true,
        timeframeSnapshots: consensus.snapshots,
      },
      { bypassCache: true },
    );

    console.log(`[auto-cycle] Validation result received for ${symbol}`);

    const validationResult = stripHtmlFromObject(rawValidationResult);
    const setupToUse =
      validationResult.validation_result === 'accepted'
        ? validationResult.validated_setup
        : validationResult.suggested_setup;

    if (!setupToUse) {
      console.log(`[auto-cycle] No setup available for ${symbol}, will retry in 2 minutes`);
      const statusEmoji = '⚠️';
      const reasons = (validationResult.adjustment_notes || []).map((note: string) => stripHtmlTags(note)).join('\n');
      const reasonText = stripHtmlTags(validationResult.reason || '');
      const message = `${statusEmoji} OpenClaw validation rejected for ${symbol}\nConfidence: ${(validationResult.confidence * 100).toFixed(0)}%\nReason: ${reasonText || reasons || 'No details provided'}`;
      await telegramService.sendMessage(message);
      scheduleNextAutoRetry(symbol, 2 * 60 * 1000);
      return;
    }

    // Send validation approval to Telegram
    const statusEmoji = validationResult.validation_result === 'accepted' ? '✅' : '⚠️';
    const statusText = validationResult.validation_result === 'accepted' ? 'APPROVED' : 'SUGGESTED';
    const notes = (validationResult.adjustment_notes || [])
      .map((note: string) => stripHtmlTags(note))
      .filter((note: string) => note.trim());
    const notesText = notes.length > 0 ? `\nNotes:\n${notes.map((n: string) => `• ${n}`).join('\n')}` : '';

    // Add volatility warning if available
    let volatilityWarning = '';
    const validationRawData = rawValidationResult as any;
    if (validationRawData?.current_context?.volatility_state === 'high') {
      volatilityWarning = '\n⚠️ HIGH VOLATILITY: Use tight stops & close profits!';
    } else if (validationRawData?.current_context?.volatility_state === 'extreme') {
      volatilityWarning = '\n🔴 EXTREME VOLATILITY: Very risky. Use tiny stops only!';
    }

    const validationMessage =
      `${statusEmoji} OpenClaw ${statusText} the setup!\n` +
      `Confidence: ${(validationResult.confidence * 100).toFixed(0)}%\n` +
      `${formatSetupSummary(setupToUse)}${notesText}${volatilityWarning}`;
    await telegramService.sendMessage(validationMessage);

    // Step 3: Execute with per-coin settings
    console.log(`[auto-cycle] Executing trade for ${symbol} (${botMode}) with leverage=${leverage}, marginMode=${marginMode}...`);
    const setup = setupToUse as any;
    const entryZone = setup.entry_zone || [setup.entryZone?.low, setup.entryZone?.high];
    const state = await futuresAutoBotService.start({
      symbol,
      botMode,
      direction: setup.direction as 'long' | 'short',
      entryMid: setup.entry_zone
        ? setup.entry_zone[0] + (setup.entry_zone[1] - setup.entry_zone[0]) / 2
        : setup.entryZone?.low && setup.entryZone?.high
          ? setup.entryZone.low + (setup.entryZone.high - setup.entryZone.low) / 2
          : 0,
      entryZone: {
        low: Math.min(entryZone[0], entryZone[1]),
        high: Math.max(entryZone[0], entryZone[1]),
      },
      leverage,
      marginMode,
      stopLoss: setup.stop_loss ?? setup.stopLoss,
      takeProfits: setup.take_profit
        ? [
            { label: 'TP1', price: setup.take_profit.tp1 },
            { label: 'TP2', price: setup.take_profit.tp2 },
          ]
        : (setup.takeProfits || []).filter((tp: any) => tp.price !== null),
      allocationUnit: allocationUnit as 'percent' | 'usdt',
      allocationValue,
      notes: [`Auto-executed via watch mode (leverage: ${leverage}x, allocation: ${allocationValue}${allocationUnit}, marginMode: ${marginMode})`],
      riskReward: setup.risk_reward?.tp2 ?? setup.riskReward,
      setupGrade: setup.grade || 'A',
      setupGradeRank: setup.gradeRank || 1,
      setupLabel: `Watch Mode Setup`,
      currentPrice,
    });

    // Update watched coin status
    let watchedData = watchedCoins.get(symbol);
    if (watchedData) {
      watchedData.lastBotStatus = state.status;
      // Track when entry order was placed for timeout detection (15 min expiry)
      if (state.status === 'watching') {
        watchedData.entryOrderPlacedAt = Date.now();
        console.log(`[auto-cycle] Entry order placed for ${symbol} at ${new Date().toISOString()}`);
      }
      watchedCoins.set(symbol, watchedData);
    }

    // Update pendingValidations with validation result
    const pendingData = pendingValidations.get(symbol);
    if (pendingData) {
      pendingData.validationResult = validationResult;
      pendingValidations.set(symbol, pendingData);
    }

    console.log(`[auto-cycle] Bot started for ${symbol}, status: ${state.status}`);

    // Send notification to user
    const message =
      `✅ Watch Mode: Auto-executed ${symbol}\n` +
      `Direction: ${state.plan.direction.toUpperCase()}\n` +
      `Entry Zone: ${(state.plan.entryZone.low ?? 0).toFixed(4)} - ${(state.plan.entryZone.high ?? 0).toFixed(4)}\n` +
      `TP1: ${state.plan.takeProfits[0]?.price?.toFixed(4) || 'n/a'}\n` +
      `TP2: ${state.plan.takeProfits[1]?.price?.toFixed(4) || 'n/a'}\n\n` +
      `⏳ Waiting for position to close...`;

    await telegramService.sendMessage(message);

    // Set up monitoring to detect position close and restart
    setupWatchModeMonitoring(symbol);

    // Clear processing flag - cycle complete, monitoring handles the rest
    const watchedDataAfter = watchedCoins.get(symbol);
    if (watchedDataAfter) {
      watchedDataAfter.isProcessing = false;
      watchedCoins.set(symbol, watchedDataAfter);
      console.log(`[auto-cycle] Released ${symbol} lock - cycle complete, monitoring active`);
    }
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : 'Unknown error';
    console.error(`[auto-cycle] Error for ${symbol}: ${errorMsg}`);

    // Clear processing flag
    const watchedData = watchedCoins.get(symbol);
    if (watchedData) {
      watchedData.isProcessing = false;
      watchedCoins.set(symbol, watchedData);
    }

    // Retry in 2 minutes
    scheduleNextAutoRetry(symbol, 2 * 60 * 1000);
  }
}

// Monitor watched coin and restart cycle when position closes
function setupWatchModeMonitoring(symbol: string): void {
  console.log(`[watch-monitor] Setting up monitoring for ${symbol}`);

  const monitorInterval = setInterval(async () => {
    try {
      const botState = await futuresAutoBotService.recordProgress(symbol);

      if (!botState) {
        console.log(`[watch-monitor] No bot state for ${symbol}, will retry next cycle`);
        return;
      }

      // Check if position was filled but now closed
      const watched = watchedCoins.get(symbol);
      if (!watched || !watched.isWatched) {
        console.log(`[watch-monitor] ${symbol} is no longer watched, clearing monitoring`);
        clearInterval(monitorInterval);
        return;
      }

      // Check for entry order timeout (15 minutes waiting for entry fill)
      const ENTRY_ORDER_TIMEOUT_MS = 15 * 60 * 1000; // 15 minutes
      if (
        watched.lastBotStatus === 'watching' &&
        watched.entryOrderPlacedAt &&
        Date.now() - watched.entryOrderPlacedAt > ENTRY_ORDER_TIMEOUT_MS
      ) {
        console.log(`[watch-monitor] Entry order timeout detected for ${symbol} (15 min)`);

        // IMPORTANT: Double-check that position hasn't filled while we were monitoring
        // If entry filled, botState.execution will be present
        if (botState.execution) {
          console.log(`[watch-monitor] Entry actually filled for ${symbol}, skipping timeout cancel`);
          // Update status since entry did fill
          watched.lastBotStatus = 'entry_placed';
          watched.entryOrderPlacedAt = undefined;
          watchedCoins.set(symbol, watched);
          // RETURN from entire monitoring callback, not just the if block
          return;
        }

        console.log(`[watch-monitor] Confirming entry still waiting for ${symbol}, cancelling order`);

        // Clear this monitoring interval
        clearInterval(monitorInterval);

        // Clear auto-restart interval tracking
        if (watched.autoRestartInterval) {
          clearInterval(watched.autoRestartInterval);
        }

        watched.isProcessing = false;
        watched.entryOrderPlacedAt = undefined;
        watchedCoins.set(symbol, watched);

        // Cancel orders (only safe because we confirmed no execution)
        try {
          console.log(`[watch-monitor] Cancelling expired entry orders for ${symbol}...`);
          await futuresAutoTradeService.cancelOpenOrders(symbol);
          console.log(`[watch-monitor] Expired orders cancelled for ${symbol}`);
        } catch (error) {
          const errorMsg = error instanceof Error ? error.message : 'Unknown error';
          console.warn(`[watch-monitor] Failed to cancel expired orders for ${symbol}: ${errorMsg}`);
        }

        // Send notification
        await telegramService.sendMessage(
          `⏰ Watch Mode: Entry order expired for ${symbol}\n` +
            `Status: Waiting 15+ minutes for entry fill\n` +
            `Action: Cancelled orders, revalidating with OpenClaw...`,
        );

        // Immediately revalidate and suggest new setup
        console.log(`[watch-monitor] Revalidating ${symbol} for new setup`);
        void triggerAutoScanValidateExecute(symbol);

        // RESET timestamp for next 15-min timeout check (don't return - continue monitoring)
        watched.entryOrderPlacedAt = Date.now();
        watchedCoins.set(symbol, watched);
        console.log(`[watch-monitor] Reset entry order timestamp for ${symbol}, will check timeout again in 15 min`);
        return;
      }

      // Detect position close: was entry_placed and now verify it's actually closed in Binance
      if (watched.lastBotStatus === 'entry_placed' && !botState.execution) {
        // IMPORTANT: Verify position is actually closed in Binance, not just missing from memory
        // (happens on bot restart when in-memory state is lost but Binance position still exists)
        let actuallyHasPosition = false;
        try {
          const openPositions = await futuresAutoTradeService.getOpenPositions(symbol);
          actuallyHasPosition = openPositions.some((p) => {
            const amt = parseFloat(String(p.positionAmt || '0')) || 0;
            return amt !== 0;
          });
          console.log(`[watch-monitor] Verified position status for ${symbol}: actuallyHasPosition=${actuallyHasPosition}`);
        } catch (checkError) {
          console.warn(`[watch-monitor] Failed to check actual position for ${symbol}, will assume it exists`);
          actuallyHasPosition = true; // Assume position exists on error
        }

        // Only proceed with close logic if position truly doesn't exist
        if (!actuallyHasPosition) {
          console.log(`[watch-monitor] Position closed for ${symbol}, scheduling new cycle in 3 minutes`);

          // Clear this monitoring interval
          clearInterval(monitorInterval);

          // Clear auto-restart interval tracking to prevent double monitoring
          if (watched.autoRestartInterval) {
            clearInterval(watched.autoRestartInterval);
          }

          // Clear the processing flag from previous cycle
          watched.isProcessing = false;
          // Mark position close time for 3-minute cooldown
          watched.positionClosedAt = Date.now();
          // Clear entry order timestamp since position is now closed
          watched.entryOrderPlacedAt = undefined;
          watchedCoins.set(symbol, watched);

          // Cancel any open orders before restart
          try {
            console.log(`[watch-monitor] Cancelling open orders for ${symbol}...`);
            await futuresAutoTradeService.cancelOpenOrders(symbol);
            console.log(`[watch-monitor] Orders cancelled for ${symbol}`);
          } catch (error) {
            const errorMsg = error instanceof Error ? error.message : 'Unknown error';
            console.warn(`[watch-monitor] Failed to cancel orders for ${symbol}: ${errorMsg}`);
          }

          // Send notification
          const delaySeconds = 180; // 3 minutes
          await telegramService.sendMessage(
            `📊 Watch Mode: Position closed for ${symbol}\n` +
              `Status: ${botState.status}\n` +
              `⏳ Waiting ${delaySeconds / 60} minutes before next scan (market cooldown)...`,
          );

          // Restart the cycle after 3 minutes delay
          const cooldownTimeoutId = setTimeout(() => {
            console.log(`[watch-monitor] ${delaySeconds / 60}-minute cooldown expired for ${symbol}, restarting scan`);
            void triggerAutoScanValidateExecute(symbol);
          }, delaySeconds * 1000);

          // Track timeout for cleanup
          watched.autoRestartInterval = cooldownTimeoutId;
          watchedCoins.set(symbol, watched);

          return;
        } else {
          // Position still exists, restore execution record if needed
          console.log(`[watch-monitor] Position still exists for ${symbol}, but execution record was lost - will restore on next update`);
          watched.lastBotStatus = 'entry_placed';
          watchedCoins.set(symbol, watched);
        }
      }

      // Update last known status
      if (watched) {
        watched.lastBotStatus = botState.status;
        watchedCoins.set(symbol, watched);
      }
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : 'Unknown error';
      console.error(`[watch-monitor] Error monitoring ${symbol}: ${errorMsg}`);
    }
  }, 10 * 1000); // Check every 10 seconds

  // Store the interval for cleanup
  const watched = watchedCoins.get(symbol);
  if (watched) {
    if (watched.autoRestartInterval) {
      clearInterval(watched.autoRestartInterval);
    }
    watched.autoRestartInterval = monitorInterval;
    watchedCoins.set(symbol, watched);
  }
}

// Schedule next auto-retry after a delay
function scheduleNextAutoRetry(symbol: string, delayMs: number): void {
  const watched = watchedCoins.get(symbol);
  if (!watched || !watched.isWatched) {
    return;
  }

  console.log(`[watch-retry] Scheduling retry for ${symbol} in ${(delayMs / 1000).toFixed(0)}s`);

  if (watched.autoRestartInterval) {
    clearInterval(watched.autoRestartInterval);
  }

  watched.autoRestartInterval = setTimeout(() => {
    if (watchedCoins.get(symbol)?.isWatched) {
      void triggerAutoScanValidateExecute(symbol);
    }
  }, delayMs);

  watchedCoins.set(symbol, watched);
}

export async function executeTelegramCommand(args: string[]): Promise<CommandResult> {
  try {
    const [command, ...rest] = args;

    if (!command) {
      return {
        success: false,
        message:
          `📱 Available Commands:\n\n` +
          `Trading:\n` +
          `/scan <symbol> - Build consensus across timeframes\n` +
          `/validate <symbol> [mode] - Validate with OpenClaw\n` +
          `/execute <symbol> - Execute trade\n` +
          `/stop <symbol> - Stop active bot\n\n` +
          `Auto Mode (Watch):\n` +
          `/watch <symbol> [symbol2] ... - Auto scan validate execute and restart\n` +
          `/watching - Show coins being watched\n` +
          `/unwatch <symbol> [symbol2] ... - Stop watching coins\n\n` +
          `Market Data:\n` +
          `/market - Market overview with top 3s\n` +
          `/top_volume - Top 10 coins by 24h volume\n` +
          `/top_gainers - Top 10 gainers in 24h\n` +
          `/top_losers - Top 10 losers in 24h\n\n` +
          `Configuration:\n` +
          `/setup show [symbol] - Show settings (global or per-coin)\n` +
          `/setup leverage <value> [symbol] - Set leverage\n` +
          `/setup allocation <unit> <value> [symbol] - Set allocation\n` +
          `/setup margin <mode> [symbol] - Set margin mode`,
      };
    }

    const lowerCommand = command.toLowerCase();

    // Handle setup command (special case - doesn't need symbol)
    if (lowerCommand === 'setup') {
      return await handleSetupCommand(rest[0], ...rest.slice(1));
    }

    // Handle watching command (show watched coins)
    if (lowerCommand === 'watching') {
      return await handleWatchingCommand();
    }

    // Handle market commands
    if (
      lowerCommand === 'market' ||
      lowerCommand === 'top_volume' ||
      lowerCommand === 'top_gainers' ||
      lowerCommand === 'top_losers'
    ) {
      const subcommand = lowerCommand === 'market' ? rest[0] : lowerCommand;
      return await handleMarketCommand(subcommand);
    }

    // Handle watch/unwatch commands (can accept multiple symbols)
    if (lowerCommand === 'watch') {
      return await handleWatchCommand(rest);
    }

    if (lowerCommand === 'unwatch') {
      return await handleUnwatchCommand(rest);
    }

    // Other commands need symbol as second argument
    const symbol = rest[0];
    const additionalArgs = rest.slice(1);

    if (!symbol && lowerCommand !== 'setup') {
      return {
        success: false,
        message: `❌ Missing symbol argument\nUsage: /${lowerCommand} <symbol> ${additionalArgs.length > 0 ? '[options]' : ''}`,
      };
    }

    const mode = additionalArgs[0]?.toLowerCase() as 'scalping' | 'intraday' | undefined;

    switch (lowerCommand) {
      case 'scan':
        return await handleScanCommand(symbol);

      case 'validate':
        return await handleValidateCommand(symbol, mode || 'scalping');

      case 'execute':
        return await handleExecuteCommand(symbol);

      case 'stop':
        return await handleStopCommand(symbol);

      default:
        return {
          success: false,
          message: `❌ Unknown command: ${command}. Type / to see available commands.`,
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
