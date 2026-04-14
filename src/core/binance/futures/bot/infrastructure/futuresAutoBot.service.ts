import { randomUUID } from 'crypto';
import { appendFile, mkdir } from 'fs/promises';
import os from 'os';
import { join } from 'path';
import { BASE_API_BINANCE } from '@configs/base.config';
import { formatDecimalString } from '@utils/format-number.util';
import { loadCoinConfig, saveCoinConfig } from '@services/coin-config.service';
import { loadBotState, saveBotState, deleteBotState } from '@services/bot-state.service';
import type { CoinValidationSnapshotSetupCandidate } from '@features/coin/interface/CoinValidationSnapshot.interface';
import type {
  FuturesAutoBotExecutionRecord,
  FuturesAutoBotLogEntry,
  FuturesAutoBotState,
  StartFuturesAutoBotInput,
} from '../domain/futuresAutoBot.model';
import { futuresAutoConsensusService } from './futuresAutoConsensus.service';
import type { FuturesAutoBotOpenClawValidationResult } from './futuresAutoValidation.service';
import { futuresAutoValidationService } from './futuresAutoValidation.service';
import { futuresAutoTradeService } from './futuresAutoTrade.service';
import { telegramService } from '@services/telegram.service';

const inMemoryBots = new Map<string, FuturesAutoBotState>();
const inMemoryLogs = new Map<string, FuturesAutoBotLogEntry[]>();
const inFlightProgressChecks = new Set<string>();
const OPENCLAW_PLAN_LOCK_TTL_MS = 45 * 60 * 1000;
const OPENCLAW_REVALIDATION_COOLDOWN_MS = 10 * 60 * 1000;
const ORDER_EXPIRATION_TIME_MS = 15 * 60 * 1000; // 15 minutes
const POSITION_CLOSURE_COOLDOWN_MS = 3 * 60 * 1000; // 3 minutes after position closes
const USER_TIME_ZONE = 'Asia/Jakarta';

function createBotId(symbol: string) {
  return `${symbol}-${randomUUID()}`;
}

function createLog(level: FuturesAutoBotLogEntry['level'], message: string): FuturesAutoBotLogEntry {
  return {
    id: randomUUID(),
    level,
    message,
    timestamp: new Date().toISOString(),
  };
}

function setBotState(symbol: string, state: FuturesAutoBotState) {
  inMemoryBots.set(symbol, state);
  // Save to disk asynchronously, don't await to avoid blocking
  saveBotState(state).catch((error) => {
    console.error(`[bot-state] Failed to persist state for ${symbol}:`, error);
  });
}

async function storeLogEntry(symbol: string, log: FuturesAutoBotLogEntry, _persistToRedis = true) {
  void _persistToRedis;
  const currentLogs = inMemoryLogs.get(symbol) ?? [];
  inMemoryLogs.set(symbol, [...currentLogs, log].slice(-50));
  try {
    const logsDir = join(os.homedir(), '.btcmarketscanner', 'logs');
    await mkdir(logsDir, { recursive: true });
    const date = log.timestamp.slice(0, 10);
    const logFile = join(logsDir, `${symbol}-${date}.log`);
    const line = `[${log.timestamp}] [${log.level.toUpperCase()}] ${log.message}\n`;
    await appendFile(logFile, line, 'utf8');
  } catch {
    // never block bot logic on logging failures
  }
}

function formatDirectionLabel(direction: 'long' | 'short') {
  return direction === 'long' ? 'LONG' : 'SHORT';
}

function parseNumber(value?: string | null) {
  if (value === undefined || value === null || value.trim().length === 0) {
    return null;
  }

  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function formatLogPrice(value: number | null | undefined) {
  if (value === null || value === undefined || Number.isNaN(value)) {
    return 'n/a';
  }

  const absoluteValue = Math.abs(value);
  const decimals =
    absoluteValue >= 1000
      ? 2
      : absoluteValue >= 100
        ? 3
        : absoluteValue >= 1
          ? 4
          : absoluteValue >= 0.1
            ? 5
            : absoluteValue >= 0.01
              ? 7
              : absoluteValue >= 0.001
                ? 8
                : 10;

  return formatDecimalString(value.toFixed(decimals));
}

function formatLogPriceRange(min: number | null, max: number | null) {
  return `${formatLogPrice(min)} - ${formatLogPrice(max)}`;
}

function formatUserDateTime(value?: string | null) {
  if (!value) {
    return 'the TTL expires';
  }

  const parsed = new Date(value);

  if (Number.isNaN(parsed.getTime())) {
    return value;
  }

  return new Intl.DateTimeFormat('en-GB', {
    dateStyle: 'medium',
    timeStyle: 'medium',
    timeZone: USER_TIME_ZONE,
  }).format(parsed);
}

function isProtectionOrderType(type?: string | null) {
  return Boolean(type && (type.includes('STOP') || type.includes('TAKE_PROFIT')));
}

function matchesPositionSide(orderPositionSide: string | undefined, positionSide?: 'BOTH' | 'LONG' | 'SHORT') {
  if (!positionSide || positionSide === 'BOTH') {
    return true;
  }

  return orderPositionSide === positionSide || orderPositionSide === 'BOTH';
}

function getPositionSideFromAmount(positionAmt: number, fallback?: 'BOTH' | 'LONG' | 'SHORT') {
  if (fallback === 'LONG' || fallback === 'SHORT') {
    return fallback;
  }

  if (positionAmt > 0) {
    return 'LONG';
  }

  if (positionAmt < 0) {
    return 'SHORT';
  }

  return 'BOTH';
}

function buildPlanFromOpenClawSetup(
  plan: FuturesAutoBotState['plan'],
  setup: FuturesAutoBotOpenClawValidationResult['validated_setup'],
) {
  const takeProfits: FuturesAutoBotState['plan']['takeProfits'] = [
    { label: 'TP1', price: setup.take_profit.tp1 },
    { label: 'TP2', price: setup.take_profit.tp2 },
    { label: 'TP3', price: null },
  ];

  // Verify setup has required fields
  if (!setup || !setup.entry_zone || !setup.planned_entry) {
    console.log(`[buildPlan-WARN] ${plan.symbol}: Invalid setup structure!`, setup);
    return plan; // Return original plan if setup is invalid
  }

  // CRITICAL: Always set entryMid explicitly from setup.planned_entry
  // This MUST NOT be null or the fallback will use entry zone values!
  const entryMidValue = Number(setup.planned_entry);
  if (!Number.isFinite(entryMidValue)) {
    console.log(`[buildPlan-ERROR] ${plan.symbol}: planned_entry is not a valid number!`, setup.planned_entry);
    return plan;
  }

  const builtPlan = {
    ...plan,
    direction: setup.direction,
    entryMid: entryMidValue, // MUST be set from setup.planned_entry
    entryZone: {
      high: Math.max(setup.entry_zone[0], setup.entry_zone[1]),
      low: Math.min(setup.entry_zone[0], setup.entry_zone[1]),
    },
    riskReward: setup.risk_reward.tp2 ?? setup.risk_reward.tp1 ?? plan.riskReward,
    setupLabel: `OpenClaw Suggested ${setup.direction === 'long' ? 'Long' : 'Short'} Setup`,
    setupType: setup.setup_type,
    stopLoss: setup.stop_loss,
    takeProfits,
  };

  console.log(
    `[buildPlan-openclaw] ${plan.symbol}: BUILT setup.entry_zone=${JSON.stringify(setup.entry_zone)}, setup.planned_entry=${setup.planned_entry}, setup.stop_loss=${setup.stop_loss} -> entryMid=${builtPlan.entryMid}, entryZone=[${builtPlan.entryZone.low}, ${builtPlan.entryZone.high}], builtStopLoss=${builtPlan.stopLoss}`,
  );

  return builtPlan;
}

function getLockedOpenClawPlan(current: FuturesAutoBotState, suggestedPlan: FuturesAutoBotState['plan'] | null) {
  return suggestedPlan ?? current.openClawLockedPlan ?? null;
}

function createWatchingStateFromConsensus(params: {
  current: FuturesAutoBotState;
  consensus: Awaited<ReturnType<typeof futuresAutoConsensusService.buildConsensus>>;
  currentPrice: number;
}) {
  const { current, consensus, currentPrice } = params;
  const consensusSetup = consensus.consensusSetup ?? current.plan;

  return {
    ...current,
    execution: null,
    executionHistory: current.executionHistory ?? [],
    lastOpenClawValidationAt: null,
    lastOpenClawValidationFingerprint: null,
    openClawLockedPlan: null,
    plan: {
      ...current.plan,
      currentPrice,
      direction: consensusSetup.direction,
      entryMid: consensusSetup.entryMid,
      entryZone: {
        high: consensusSetup.entryZone.high,
        low: consensusSetup.entryZone.low,
      },
      notes: consensusSetup.reasons,
      riskReward: consensusSetup.riskReward,
      setupGrade: consensusSetup.grade,
      setupGradeRank: consensusSetup.gradeRank,
      setupLabel: consensusSetup.label,
      setupType: consensusSetup.pathMode === 'breakout' ? 'breakout_retest' : 'continuation',
      stopLoss: consensusSetup.stopLoss,
      takeProfits: consensusSetup.takeProfits,
    },
    planLockedAt: null,
    planLockExpiresAt: null,
    planSource: 'consensus' as const,
    status: 'watching' as const,
    updatedAt: new Date().toISOString(),
  } satisfies FuturesAutoBotState;
}

async function checkAndSendPriceNotifications(
  state: FuturesAutoBotState,
  currentPrice: number,
): Promise<FuturesAutoBotState> {
  if (!state.sentNotifications) {
    state.sentNotifications = {};
  }

  const symbol = state.plan.symbol;
  const plan = state.plan;
  const notifications = state.sentNotifications;

  console.log(`[DEBUG] Checking price notifications for ${symbol}. Current price: ${currentPrice}`);
  console.log(`[DEBUG] Entry zone: ${plan.entryZone.low?.toFixed(4)} - ${plan.entryZone.high?.toFixed(4)}`);
  console.log(`[DEBUG] Entry: ${plan.entryMid?.toFixed(4)}, SL: ${plan.stopLoss?.toFixed(4)}`);
  console.log(`[DEBUG] TP1: ${plan.takeProfits[0]?.price?.toFixed(4)}, TP2: ${plan.takeProfits[1]?.price?.toFixed(4)}`);

  // Check entry zone
  const entryLow = plan.entryZone.low ?? null;
  const entryHigh = plan.entryZone.high ?? null;
  if (entryLow !== null && entryHigh !== null && !notifications.entryZone) {
    const inZone = currentPrice >= Math.min(entryLow, entryHigh) && currentPrice <= Math.max(entryLow, entryHigh);
    if (inZone) {
      console.log(`[DEBUG] Entry zone touched, sending notification`);
      await telegramService.sendPriceAlert(
        symbol,
        'entry_zone',
        currentPrice,
        `Entry zone: ${entryLow.toFixed(4)} - ${entryHigh.toFixed(4)}`,
      );
      notifications.entryZone = true;
    }
  }

  // Check planned entry
  if (plan.entryMid !== null && !notifications.plannedEntry && Math.abs(currentPrice - plan.entryMid) < 0.001) {
    await telegramService.sendPriceAlert(symbol, 'planned_entry', currentPrice, `Entry: ${plan.entryMid.toFixed(4)}`);
    notifications.plannedEntry = true;
  }

  // Only send TP/SL notifications if position is actually open
  const isPositionOpen = state.status === 'entry_placed' && state.execution;

  if (!isPositionOpen) {
    console.log(
      `[DEBUG] Skipping TP/SL notifications for ${symbol}: position not open (status=${state.status}, hasExecution=${Boolean(state.execution)})`,
    );
  }

  // Check TP levels (only if position is open)
  if (isPositionOpen) {
    for (let i = 0; i < plan.takeProfits.length; i++) {
      const tp = plan.takeProfits[i];
      const notifKey = `tp${i + 1}` as keyof typeof notifications;
      if (tp?.price !== null && !notifications[notifKey] && Math.abs(currentPrice - tp.price) < 0.001) {
        console.log(`[DEBUG] TP${i + 1} price touched for ${symbol}, sending notification`);
        await telegramService.sendPriceAlert(symbol, notifKey, currentPrice, `TP${i + 1}: ${tp.price.toFixed(4)}`);
        notifications[notifKey] = true;
      }
    }
  }

  // Check SL (only if position is open)
  if (isPositionOpen) {
    if (plan.stopLoss !== null && !notifications.stopLoss && Math.abs(currentPrice - plan.stopLoss) < 0.001) {
      console.log(`[DEBUG] SL price touched for ${symbol}, sending notification`);
      await telegramService.sendPriceAlert(symbol, 'stop_loss', currentPrice, `SL: ${plan.stopLoss.toFixed(4)}`);
      notifications.stopLoss = true;
    }
  }

  return { ...state, sentNotifications: notifications };
}

function buildValidationSetupCandidateFromPlan(
  plan: FuturesAutoBotState['plan'],
  currentPrice: number,
  currentResistance: number | null,
  currentSupport: number | null,
): CoinValidationSnapshotSetupCandidate {
  const entryLow = plan.entryZone.low ?? plan.entryMid ?? currentPrice;
  const entryHigh = plan.entryZone.high ?? plan.entryMid ?? currentPrice;
  const plannedEntry = plan.entryMid ?? entryLow;
  const stopLoss = plan.stopLoss ?? currentPrice;
  const tp1 = plan.takeProfits[0]?.price ?? null;
  const tp2 = plan.takeProfits[1]?.price ?? null;
  const risk = plan.direction === 'short' ? stopLoss - plannedEntry : plannedEntry - stopLoss;
  const tp1Distance = tp1 === null ? null : plan.direction === 'short' ? plannedEntry - tp1 : tp1 - plannedEntry;
  const tp2Distance = tp2 === null ? null : plan.direction === 'short' ? plannedEntry - tp2 : tp2 - plannedEntry;

  return {
    direction: plan.direction,
    distance_to_resistance: currentResistance !== null ? Math.abs(currentResistance - currentPrice) : null,
    distance_to_support: currentSupport !== null ? Math.abs(currentPrice - currentSupport) : null,
    entry_zone: [entryLow, entryHigh],
    planned_entry: plannedEntry,
    risk_reward: {
      tp1: risk > 0 && tp1Distance !== null ? tp1Distance / risk : plan.riskReward,
      tp2: risk > 0 && tp2Distance !== null ? tp2Distance / risk : plan.riskReward,
    },
    setup_type: plan.setupType ?? 'continuation',
    sl_distance: Math.abs(plannedEntry - stopLoss),
    stop_loss: stopLoss,
    take_profit: {
      tp1,
      tp2,
    },
    tp_distance: {
      tp1: tp1Distance !== null ? Math.abs(tp1Distance) : null,
      tp2: tp2Distance !== null ? Math.abs(tp2Distance) : null,
    },
  };
}

async function runInitialOpenClawValidation(params: {
  baseState: FuturesAutoBotState;
  consensus: Awaited<ReturnType<typeof futuresAutoConsensusService.buildConsensus>>;
  currentAccountSize: number | null;
  currentPrice: number;
  currentSymbol: string;
}) {
  const { baseState, consensus, currentAccountSize, currentPrice, currentSymbol } = params;
  const timestamp = new Date().toISOString();
  const validationFingerprint = buildOpenClawValidationFingerprint({ consensus });
  const fifteenMinuteSnapshot = consensus.snapshots.find((snapshot) => snapshot.interval === '15m');

  const validation = await futuresAutoValidationService.validateSetup(
    {
      accountSize: currentAccountSize,
      botMode: baseState.plan.botMode,
      consensusSetup: consensus.consensusSetup,
      setupCandidateOverride: buildValidationSetupCandidateFromPlan(
        baseState.plan,
        currentPrice,
        fifteenMinuteSnapshot?.supportResistance?.resistance ?? null,
        fifteenMinuteSnapshot?.supportResistance?.support ?? null,
      ),
      currentPrice,
      isPerpetual: true,
      leverage: baseState.plan.leverage,
      symbol: currentSymbol,
      timeframeSnapshots: consensus.snapshots,
    },
    { bypassCache: true },
  );

  if (validation.validation_result === 'accepted') {
    const validatedPlan = buildPlanFromOpenClawSetup(baseState.plan, validation.validated_setup);
    const acceptedState: FuturesAutoBotState = {
      ...baseState,
      lastOpenClawValidationAt: timestamp,
      lastOpenClawValidationFingerprint: validationFingerprint,
      openClawLockedPlan: validatedPlan,
      plan: validatedPlan,
      planLockedAt: timestamp,
      planLockExpiresAt: new Date(Date.now() + OPENCLAW_PLAN_LOCK_TTL_MS).toISOString(),
      planSource: 'openclaw',
      updatedAt: timestamp,
    };

    setBotState(currentSymbol, acceptedState);


    await storeLogEntry(
      currentSymbol,
      createLog(
        'success',
        `Initial OpenClaw validation accepted for ${currentSymbol} (${validation.confidence.toFixed(2)} confidence): ${validation.reason} The plan is now locked to the OpenClaw suggestion before entry monitoring continues.`,
      ),
      true,
    );

    return acceptedState;
  }

  const suggestedPlan = validation.suggested_setup
    ? buildPlanFromOpenClawSetup(baseState.plan, validation.suggested_setup)
    : null;
  const lockedPlan = getLockedOpenClawPlan(baseState, suggestedPlan);

  // If there's a suggested plan, place the order immediately instead of just locking it
  if (suggestedPlan && !baseState.execution && baseState.status !== 'entry_placed') {
    await storeLogEntry(
      currentSymbol,
      createLog(
        'success',
        `OpenClaw rejected the initial setup but provided a suggestion for ${currentSymbol}. Placing entry order immediately with suggested setup.`,
      ),
      true,
    );

    try {
      const execution = (await futuresAutoTradeService.executeTrade(suggestedPlan, currentPrice)) as {
        entryOrder: { orderId: number; status?: string | null; avgPrice?: string | null };
        entryPrice: number | null;
        entryFilled: boolean;
        algoOrderClientIds: string[];
        allocatedMargin: number;
        positionSide: 'LONG' | 'SHORT' | null;
        quantity: number;
        stopLossAlgoOrder: { algoId: number } | null;
        takeProfitAlgoOrders: Array<{ algoId: number }>;
      };

      const executionRecord: FuturesAutoBotExecutionRecord = {
        allocatedMargin: execution.allocatedMargin,
        algoOrderClientIds: execution.algoOrderClientIds,
        entryOrderId: execution.entryOrder.orderId,
        entryOrderStatus: execution.entryOrder.status ?? null,
        entryPrice: execution.entryPrice ?? currentPrice,
        executedAt: new Date().toISOString(),
        positionSide: execution.positionSide,
        stopLossAlgoOrderId: execution.stopLossAlgoOrder?.algoId ?? null,
        takeProfitAlgoOrderIds: execution.takeProfitAlgoOrders.map((order) => order.algoId),
        quantity: execution.quantity,
      };

      const executedState: FuturesAutoBotState = {
        ...baseState,
        plan: suggestedPlan,
        execution: executionRecord,
        status: execution.entryFilled ? 'entry_placed' : 'entry_pending',
        planSource: 'openclaw',
        openClawLockedPlan: lockedPlan,
        lastOpenClawValidationAt: timestamp,
        lastOpenClawValidationFingerprint: validationFingerprint,
        planLockedAt: timestamp,
        planLockExpiresAt: new Date(Date.now() + OPENCLAW_PLAN_LOCK_TTL_MS).toISOString(),
        updatedAt: timestamp,
      };

      setBotState(currentSymbol, executedState);

      await storeLogEntry(
        currentSymbol,
        createLog(
          'success',
          execution.entryFilled
            ? `Initial OpenClaw suggestion executed for ${currentSymbol}. Entry order #${executionRecord.entryOrderId} at ${formatLogPrice(executionRecord.entryPrice)}, TP algo orders ${executionRecord.takeProfitAlgoOrderIds.join(', ') || 'n/a'}, SL algo order ${executionRecord.stopLossAlgoOrderId ?? 'n/a'}.`
            : `Initial OpenClaw suggestion placed for ${currentSymbol} at ${formatLogPrice(executionRecord.entryPrice)}. Waiting for fill.`,
        ),
        true,
      );

      return executedState;
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : 'Unknown error';
      await storeLogEntry(
        currentSymbol,
        createLog('error', `Initial OpenClaw suggestion execution failed for ${currentSymbol}: ${errorMsg}`),
        true,
      );
      // Fall through to create rejected state
    }
  }

  const finalPlan = lockedPlan
    ? { ...lockedPlan, notes: [...lockedPlan.notes, ...validation.adjustment_notes] }
    : baseState.plan;

  const rejectedState: FuturesAutoBotState = {
    ...baseState,
    lastOpenClawValidationAt: timestamp,
    lastOpenClawValidationFingerprint: validationFingerprint,
    openClawLockedPlan: lockedPlan,
    plan: finalPlan,
    planLockedAt: lockedPlan ? timestamp : null,
    planLockExpiresAt: lockedPlan ? new Date(Date.now() + OPENCLAW_PLAN_LOCK_TTL_MS).toISOString() : null,
    planSource: lockedPlan ? 'openclaw' : 'consensus',
    updatedAt: timestamp,
  };

  setBotState(currentSymbol, rejectedState);
  await storeLogEntry(
    currentSymbol,
    createLog(
      'warn',
      suggestedPlan
        ? `Initial OpenClaw validation rejected for ${currentSymbol} (${validation.confidence.toFixed(2)} confidence): ${validation.reason} Applying the suggested setup before monitoring starts.`
        : `Initial OpenClaw validation rejected for ${currentSymbol} (${validation.confidence.toFixed(2)} confidence): ${validation.reason}`,
    ),
    true,
  );

  if (suggestedPlan) {
    await storeLogEntry(
      currentSymbol,
      createLog(
        'info',
        `Initial OpenClaw suggestion for ${currentSymbol}: ${validation.adjustment_notes.join(' ') || 'No adjustment notes provided.'}`,
      ),
      true,
    );
  }

  return rejectedState;
}

function getOpenClawUnlockReason(params: {
  current: FuturesAutoBotState;
  consensusSetup: NonNullable<Awaited<ReturnType<typeof futuresAutoConsensusService.buildConsensus>>['consensusSetup']>;
  now: number;
}) {
  const { consensusSetup, current, now } = params;

  if (current.planSource !== 'openclaw') {
    return null;
  }

  const lockedAt = current.planLockedAt ? Date.parse(current.planLockedAt) : null;
  const expiresAt = current.planLockExpiresAt ? Date.parse(current.planLockExpiresAt) : null;
  const lockAgeMs = lockedAt !== null && Number.isFinite(lockedAt) ? now - lockedAt : null;

  if (
    (expiresAt !== null && Number.isFinite(expiresAt) && now >= expiresAt) ||
    (lockAgeMs !== null && lockAgeMs >= OPENCLAW_PLAN_LOCK_TTL_MS)
  ) {
    return 'OpenClaw lock expired and needs a fresh validation.';
  }

  const lockedPlan = current.openClawLockedPlan ?? current.plan;

  if (
    consensusSetup &&
    lockedPlan &&
    consensusSetup.direction !== lockedPlan.direction &&
    consensusSetup.gradeRank >= lockedPlan.setupGradeRank + 1
  ) {
    return `Consensus shifted to a stronger ${consensusSetup.direction} setup (${consensusSetup.label}) while the locked OpenClaw plan was ${lockedPlan.direction}.`;
  }

  return null;
}

function buildOpenClawValidationFingerprint(params: {
  consensus: Awaited<ReturnType<typeof futuresAutoConsensusService.buildConsensus>>;
}) {
  const { consensus } = params;
  const fingerprintPayload = {
    timeframes: consensus.snapshots
      .filter((snapshot) => snapshot.interval === '15m' || snapshot.interval === '1h' || snapshot.interval === '4h')
      .map((snapshot) => ({
        direction: snapshot.trend.direction,
        gradeRank: snapshot.setup.gradeRank,
        interval: snapshot.interval,
        label: snapshot.setup.label,
        structurePattern: snapshot.trend.structurePattern,
      })),
  };

  return JSON.stringify(fingerprintPayload);
}

function shouldSkipOpenClawValidation(current: FuturesAutoBotState, now: number, fingerprint: string) {
  if (current.planSource !== 'openclaw') {
    return false;
  }

  const lastValidationAt = current.lastOpenClawValidationAt ? Date.parse(current.lastOpenClawValidationAt) : null;

  if (lastValidationAt === null || !Number.isFinite(lastValidationAt)) {
    return false;
  }

  if (current.lastOpenClawValidationFingerprint !== fingerprint) {
    return false;
  }

  return now - lastValidationAt < OPENCLAW_REVALIDATION_COOLDOWN_MS;
}

function hasOpenProtectionOrder(
  regularOrders: Array<{ positionSide?: string; type?: string }>,
  algoOrders: Array<{ closePosition?: boolean; positionSide?: string; reduceOnly?: boolean; type?: string }>,
  positionSide: 'BOTH' | 'LONG' | 'SHORT',
) {
  const regularHasProtection = regularOrders.some(
    (order) => isProtectionOrderType(order.type) && matchesPositionSide(order.positionSide, positionSide),
  );
  const algoHasProtection = algoOrders.some(
    (order) =>
      (order.reduceOnly === true || isProtectionOrderType(order.type) || order.closePosition === true) &&
      matchesPositionSide(order.positionSide, positionSide),
  );

  return regularHasProtection || algoHasProtection;
}

function inferFilledTakeProfitCount(params: { executionQuantity: number; currentQuantity: number }) {
  const { currentQuantity, executionQuantity } = params;

  if (
    !Number.isFinite(executionQuantity) ||
    executionQuantity <= 0 ||
    !Number.isFinite(currentQuantity) ||
    currentQuantity <= 0
  ) {
    return 0;
  }

  const remainingRatio = currentQuantity / executionQuantity;

  if (remainingRatio <= 0.18) {
    return 3;
  }

  if (remainingRatio <= 0.48) {
    return 2;
  }

  if (remainingRatio <= 0.82) {
    return 1;
  }

  return 0;
}

export class FuturesAutoBotService {
  get(symbol: string) {
    return inMemoryBots.get(symbol) ?? null;
  }

  hydrate(symbol: string, state: FuturesAutoBotState | null) {
    if (state === null) {
      inMemoryBots.delete(symbol);
      // Delete from disk asynchronously
      deleteBotState(symbol).catch((error) => {
        console.error(`[bot-state] Failed to delete state for ${symbol}:`, error);
      });
      return null;
    }

    setBotState(symbol, state);
    return state;
  }

  async getResolved(symbol: string) {
    return inMemoryBots.get(symbol) ?? null;
  }

  async getLogs(symbol: string) {
    return inMemoryLogs.get(symbol) ?? [];
  }

  async recordProgress(symbol: string) {
    let current = inMemoryBots.get(symbol) ?? null;

    // If state not in memory, try loading from disk
    if (!current) {
      current = await loadBotState(symbol);
      if (current) {
        // Just load to memory without re-saving (to avoid potential circular ref issues)
        inMemoryBots.set(symbol, current);
        console.log(`[recordProgress] ${symbol}: loaded state from disk, status=${current.status}`);
      }
    }

    if (!current || current.status === 'stopped') {
      return current;
    }

    if (inFlightProgressChecks.has(symbol)) {
      console.log(`[recordProgress] ${symbol}: already checking in flight`);
      return current;
    }

    inFlightProgressChecks.add(symbol);

    try {
      console.log(`[recordProgress] ${symbol}: starting scan, status=${current.status}`);
      const consensus = await futuresAutoConsensusService.buildConsensus(symbol);
      const now = Date.now();
      let nextState: FuturesAutoBotState = current;
      const isOpenClawLockedPlan = current.planSource === 'openclaw';
      const openClawUnlockReason = getOpenClawUnlockReason({
        consensusSetup: consensus.consensusSetup,
        current,
        now,
      });
      const lockedOpenClawPlan = current.openClawLockedPlan ?? null;
      const openPositions = await futuresAutoTradeService.getOpenPositions(symbol);
      console.log(`[recordProgress] ${symbol}: fetched open positions, count=${openPositions.length}`);
      const activePosition = openPositions.find((position) => {
        if (position.symbol !== symbol) {
          return false;
        }

        const positionAmt = parseNumber(position.positionAmt) ?? 0;

        return positionAmt !== 0;
      });
      const activePositionAmt = parseNumber(activePosition?.positionAmt) ?? 0;
      const activePositionSide = activePosition
        ? getPositionSideFromAmount(activePositionAmt, activePosition.positionSide)
        : null;
      const isPositionOpen = current.status === 'entry_placed' || Boolean(activePosition);

      const shouldPersistLogs = !isPositionOpen && current.status !== 'entry_placed';

      // If position was previously open but is now closed, cancel any remaining TP/SL orders
      if (current.status === 'entry_placed' && !activePosition) {
        try {
          await futuresAutoTradeService.cancelProtectionOrders(symbol, 'BOTH');
          await storeLogEntry(
            symbol,
            createLog('info', `Position closed. TP/SL protection orders removed.`),
            shouldPersistLogs,
          );
        } catch (error) {
          const errorMsg = error instanceof Error ? error.message : 'Unknown error';
          console.log(`[DEBUG] Failed to cancel protection orders on position closure: ${errorMsg}`);
          // Don't fail the scan, just log it
        }
      }

      if (isOpenClawLockedPlan && lockedOpenClawPlan) {
        nextState = {
          ...nextState,
          plan: lockedOpenClawPlan,
        };
      }

      if (!isPositionOpen && consensus.consensusSetup && isOpenClawLockedPlan && openClawUnlockReason === null) {
        await storeLogEntry(
          symbol,
          createLog(
            'info',
            `OpenClaw locked plan is active for ${symbol}. Revalidation will unlock after ${formatUserDateTime(current.planLockExpiresAt)} unless it is manually reset.`,
          ),
        );
      } else if (!isPositionOpen && !consensus.consensusSetup) {
        await storeLogEntry(
          symbol,
          createLog(
            'warn',
            `Consensus unavailable for ${symbol}. Keeping current plan until enough market data loads.`,
          ),
        );
      }

      const ticker = await futuresAutoTradeService.getCurrentPrice(symbol);
      const currentPrice = Number(ticker.price);

      if (!Number.isFinite(currentPrice)) {
        throw new Error('Unable to parse current market price.');
      }

      const activePlan = nextState.plan;
      // IMPORTANT: Only use explicit entryZone boundaries, never fallback to entryMid for zone check
      // entryMid is just a reference price, not the zone itself
      const entryLow = activePlan.entryZone.low ?? null;
      const entryHigh = activePlan.entryZone.high ?? null;
      const entryMin = entryLow !== null && entryHigh !== null ? Math.min(entryLow, entryHigh) : null;
      const entryMax = entryLow !== null && entryHigh !== null ? Math.max(entryLow, entryHigh) : null;
      const inEntryZone =
        entryMin !== null && entryMax !== null ? currentPrice >= entryMin && currentPrice <= entryMax : false;

      // Debug logging for entry zone check
      if (activePlan.botMode === 'scalping') {
        console.log(
          `[bot-entry-check] ${symbol}: source=${current.planSource}, entryZone=[${activePlan.entryZone.low}, ${activePlan.entryZone.high}], entryMid=${activePlan.entryMid}, price=${currentPrice}, inZone=${inEntryZone}, status=${current.status}`,
        );
        if (entryLow === null || entryHigh === null) {
          console.log(`[bot-entry-check-invalid] ${symbol}: NO VALID ENTRY ZONE BOUNDARIES`);
        }
      }
      const hasActivePosition = Boolean(activePosition);
      if (current.status === 'entry_placed') {
        console.log(
          `[DEBUG] Checking position for ${symbol}: status=${current.status}, hasActivePosition=${hasActivePosition}, activePosition=${activePosition ? `amt=${activePosition.positionAmt}` : 'null'}`,
        );
      }
      const openClawValidationFingerprint = buildOpenClawValidationFingerprint({
        consensus,
      });
      const shouldBootstrapOpenClawValidation =
        current.status === 'watching' && current.lastOpenClawValidationAt === null && current.planSource !== 'openclaw';
      const scanMessage = hasActivePosition
        ? `Position open for ${symbol}: price ${formatLogPrice(currentPrice)}, tracking market bias ${consensus.consensusSetup ? formatDirectionLabel(consensus.consensusSetup.direction) : 'n/a'} from ${consensus.executionConsensusLabel}. Keeping focus on this position and making sure TP/SL stay attached.`
        : `Progress check for ${symbol}: price ${formatLogPrice(currentPrice)}, entry zone ${formatLogPriceRange(entryMin, entryMax)}, TP1 ${formatLogPrice(activePlan.takeProfits[0]?.price)}, SL ${formatLogPrice(activePlan.stopLoss)}.`;

      await storeLogEntry(symbol, createLog('info', scanMessage), shouldPersistLogs);

      let scannedState: FuturesAutoBotState = {
        ...nextState,
        lastScanPrice: currentPrice,
        updatedAt: new Date().toISOString(),
      };

      // Check and send price notifications
      scannedState = await checkAndSendPriceNotifications(scannedState, currentPrice);

      if (hasActivePosition && activePositionSide) {
        console.log(
          `[DEBUG] Existing position detected for ${symbol}: side=${activePositionSide}, amt=${activePositionAmt}`,
        );
        const [regularOrders, algoOrders] = await futuresAutoTradeService.getOpenOrders(symbol);
        const hasProtectionOrders = hasOpenProtectionOrder(regularOrders, algoOrders, activePositionSide);
        console.log(
          `[DEBUG] Protection orders check for ${symbol}: hasProtectionOrders=${hasProtectionOrders}, regularOrders=${regularOrders.length}, algoOrders=${algoOrders.length}`,
        );
        const protectionQuantity = Math.abs(activePositionAmt);
        const takeProfitStartIndex = Math.min(
          inferFilledTakeProfitCount({
            currentQuantity: protectionQuantity,
            executionQuantity: current.execution?.quantity ?? protectionQuantity,
          }),
          activePlan.takeProfits.length,
        );
        const focusedState: FuturesAutoBotState = {
          ...scannedState,
          execution: nextState.execution ?? current.execution ?? undefined,
          status: 'entry_placed',
        };

        setBotState(symbol, focusedState);

        if (!hasProtectionOrders) {
          console.log(
            `[DEBUG] Placing protection orders for ${symbol}: SL=${activePlan.stopLoss}, TP1=${activePlan.takeProfits[0]?.price}, TP2=${activePlan.takeProfits[1]?.price}`,
          );
          // Use OpenClaw locked plan if available for protection orders on existing position
          const protectionPlan = isOpenClawLockedPlan && lockedOpenClawPlan ? lockedOpenClawPlan : activePlan;
          const protectionOrders = await futuresAutoTradeService.placeProtectionOrders(
            protectionPlan,
            protectionQuantity,
            {
              takeProfitStartIndex,
            },
          );

          // Validate that both SL and TPs were placed
          const hasSL = Boolean(protectionOrders.stopLossAlgoOrder);
          const hasTP = protectionOrders.takeProfitAlgoOrders.length > 0;

          console.log(
            `[protection-orders-existing] ${symbol}: SL=${hasSL ? `✓ ID: ${protectionOrders.stopLossAlgoOrder?.algoId}` : '✗ MISSING'}, TPs=${hasTP ? `✓ IDs: ${protectionOrders.takeProfitAlgoOrders.map((o) => o.algoId).join(', ')}` : '✗ MISSING'}`,
          );

          if (!hasSL || !hasTP) {
            const missingParts = [!hasSL && 'SL', !hasTP && 'TP'].filter(Boolean).join(' and ');
            await storeLogEntry(
              symbol,
              createLog(
                'warn',
                `Existing position detected for ${symbol}. TP/SL were partially missing: ${missingParts} NOT placed! This position is at risk!`,
              ),
              false,
            );
          }

          const protectionState: FuturesAutoBotState = {
            ...focusedState,
            execution: focusedState.execution
              ? {
                  ...focusedState.execution,
                  algoOrderClientIds: protectionOrders.algoOrderClientIds,
                  positionSide: activePositionSide === 'BOTH' ? null : activePositionSide,
                  stopLossAlgoOrderId: protectionOrders.stopLossAlgoOrder?.algoId ?? null,
                  takeProfitAlgoOrderIds: protectionOrders.takeProfitAlgoOrders.map((order) => order.algoId),
                  quantity: protectionQuantity,
                }
              : null,
          };

          setBotState(symbol, protectionState);
          await storeLogEntry(
            symbol,
            createLog(
              'success',
              `Existing position detected for ${symbol}. TP/SL were missing, so protection orders were attached from TP${takeProfitStartIndex + 1} onward and the bot will keep tracking this trade only.`,
            ),
            false,
          );

          return protectionState;
        }

        await storeLogEntry(
          symbol,
          createLog(
            'info',
            `Existing position detected for ${symbol}. TP/SL already attached, so the bot will keep tracking this trade only.`,
          ),
          false,
        );

        return focusedState;
      }

      if (nextState.execution && nextState.status === 'entry_pending') {
        console.log(
          `[recordProgress] ${symbol}: checking for filled entry_pending order, direction=${nextState.plan.direction}`,
        );
        const filledPosition = openPositions.find((position) => {
          if (position.symbol !== symbol) {
            return false;
          }

          const positionAmt = parseNumber(position.positionAmt) ?? 0;

          return nextState.plan.direction === 'long' ? positionAmt > 0 : positionAmt < 0;
        });

        console.log(
          `[recordProgress] ${symbol}: filledPosition=${filledPosition ? `yes, amt=${filledPosition.positionAmt}` : 'no'}`,
        );
        if (filledPosition) {
          console.log(`[recordProgress] ${symbol}: FILL DETECTED! Placing TP/SL protection orders`);
          try {
            // Use OpenClaw locked plan if available to ensure TP/SL from validated setup are used
            const protectionPlan = isOpenClawLockedPlan && lockedOpenClawPlan ? lockedOpenClawPlan : nextState.plan;
            const filledQuantity = Math.abs(parseNumber(filledPosition.positionAmt) ?? nextState.execution.quantity);
            console.log(
              `[recordProgress] ${symbol}: placing with plan SL=${protectionPlan.stopLoss}, TP1=${protectionPlan.takeProfits[0]?.price}, TP2=${protectionPlan.takeProfits[1]?.price}, filledQty=${filledQuantity}`,
            );

            const protectionOrders = await futuresAutoTradeService.placeProtectionOrders(
              protectionPlan,
              filledQuantity,
            );

            // Validate that both SL and TPs were placed
            const hasSL = Boolean(protectionOrders.stopLossAlgoOrder);
            const hasTP = protectionOrders.takeProfitAlgoOrders.length > 0;

            console.log(
              `[protection-orders] ${symbol}: SL=${hasSL ? `✓ ID: ${protectionOrders.stopLossAlgoOrder?.algoId}` : '✗ MISSING'}, TPs=${hasTP ? `✓ IDs: ${protectionOrders.takeProfitAlgoOrders.map((o) => o.algoId).join(', ')}` : '✗ MISSING'}`,
            );

            if (!hasSL || !hasTP) {
              const missingParts = [!hasSL && 'SL', !hasTP && 'TP'].filter(Boolean).join(' and ');
              await storeLogEntry(
                symbol,
                createLog(
                  'warn',
                  `Entry filled for ${symbol} but ${missingParts} order(s) are MISSING! SL=${hasSL}, TP count=${protectionOrders.takeProfitAlgoOrders.length}. This position is at risk!`,
                ),
              );
            }

            const filledState: FuturesAutoBotState = {
              ...scannedState,
              execution: {
                ...nextState.execution,
                stopLossAlgoOrderId: protectionOrders.stopLossAlgoOrder?.algoId ?? null,
                takeProfitAlgoOrderIds: protectionOrders.takeProfitAlgoOrders.map((order) => order.algoId),
                algoOrderClientIds: protectionOrders.algoOrderClientIds,
              },
              status: 'entry_placed',
              lastClosureAt: null,
            };

            setBotState(symbol, filledState);
            await storeLogEntry(
              symbol,
              createLog(
                'success',
                `Entry filled for ${symbol} at ${formatLogPrice(filledState.execution?.entryPrice ?? currentPrice)}. TP/SL protection orders placed: SL=${protectionPlan.stopLoss}, TP1=${protectionPlan.takeProfits[0]?.price}, TP2=${protectionPlan.takeProfits[1]?.price}`,
              ),
            );

            return filledState;
          } catch (error) {
            const errorMsg = error instanceof Error ? error.message : 'Unknown error';
            console.error(`[recordProgress] ${symbol}: FAILED to place protection orders: ${errorMsg}`);
            await storeLogEntry(
              symbol,
              createLog('error', `Entry filled for ${symbol} but failed to place TP/SL protection orders: ${errorMsg}`),
            );
            throw error;
          }
        }

        // Check if order has expired (been pending for more than 15 minutes)
        const executedAtTime = Date.parse(nextState.execution.executedAt);
        const now = Date.now();
        const orderAgeMsec = now - executedAtTime;

        if (orderAgeMsec > ORDER_EXPIRATION_TIME_MS) {
          console.log(
            `[recordProgress] ${symbol}: Entry order expired (pending for ${(orderAgeMsec / 1000 / 60).toFixed(1)} minutes). Canceling order.`,
          );

          try {
            await futuresAutoTradeService.cancelOpenOrders(symbol);
            await storeLogEntry(
              symbol,
              createLog(
                'warn',
                `Entry order for ${symbol} expired after 15 minutes and has been cancelled. Order was placed at ${formatLogPrice(nextState.execution.entryPrice)}.`,
              ),
            );
          } catch (error) {
            const errorMsg = error instanceof Error ? error.message : 'Unknown error';
            console.error(`[recordProgress] ${symbol}: FAILED to cancel expired order: ${errorMsg}`);
            await storeLogEntry(
              symbol,
              createLog('error', `Failed to cancel expired entry order for ${symbol}: ${errorMsg}`),
            );
          }

          // Reset to watching state since the order has been cancelled
          const resetState = createWatchingStateFromConsensus({
            current: scannedState,
            consensus,
            currentPrice,
          });

          // Reset notifications for next cycle
          resetState.sentNotifications = {};

          setBotState(symbol, resetState);
          return resetState;
        }

        setBotState(symbol, scannedState);
        await storeLogEntry(
          symbol,
          createLog(
            'info',
            `Limit entry for ${symbol} remains pending at ${formatLogPrice(nextState.execution.entryPrice)}. Waiting for fill before placing TP/SL.`,
          ),
        );

        return scannedState;
      }

      if (nextState.status === 'entry_placed' && !hasActivePosition) {
        console.log(
          `[DEBUG] Position closure detected for ${symbol}. Status: ${nextState.status}, hasActivePosition: ${hasActivePosition}`,
        );

        const executionHistory = [
          ...(current.executionHistory ?? []),
          ...(current.execution ? [current.execution] : []),
        ].slice(-20);

        try {
          console.log(`[DEBUG] Canceling protection orders for ${symbol}`);
          await futuresAutoTradeService.cancelProtectionOrders(symbol, 'BOTH');
        } catch (error) {
          const errorMessage = error instanceof Error ? error.message : 'Unknown protection-order cancellation error.';
          await storeLogEntry(
            symbol,
            createLog(
              'warn',
              `Position for ${symbol} is flat, but some protection orders may still be lingering: ${errorMessage}`,
            ),
            shouldPersistLogs,
          );
        }

        const now = new Date().toISOString();
        const resetState = createWatchingStateFromConsensus({
          current: scannedState,
          consensus,
          currentPrice,
        });

        resetState.executionHistory = executionHistory;
        resetState.lastClosureAt = now;
        // Reset notifications for next cycle
        resetState.sentNotifications = {};

        setBotState(symbol, resetState);
        await storeLogEntry(
          symbol,
          createLog(
            'info',
            `Position for ${symbol} is fully closed. Starting 3-minute cooldown before attempting next entry.`,
          ),
          shouldPersistLogs,
        );

        // Don't immediately open new position - wait for cooldown
        return resetState;
      }

      if (nextState.status === 'entry_placed') {
        setBotState(symbol, scannedState);
        return scannedState;
      }

      // Check if we're still in cooldown after position closure
      const isInClosureCooldown = current.lastClosureAt
        ? Date.now() - Date.parse(current.lastClosureAt) < POSITION_CLOSURE_COOLDOWN_MS
        : false;

      if (isInClosureCooldown) {
        const timeSinceClosure = Date.now() - Date.parse(current.lastClosureAt!);
        const cooldownRemainingMs = POSITION_CLOSURE_COOLDOWN_MS - timeSinceClosure;
        const cooldownRemainingMin = (cooldownRemainingMs / 1000 / 60).toFixed(1);

        console.log(
          `[recordProgress] ${symbol}: In cooldown after position closure. Remaining: ${cooldownRemainingMin} minutes`,
        );
        await storeLogEntry(
          symbol,
          createLog(
            'info',
            `Position closed. Cooldown active - waiting ${cooldownRemainingMin} minutes before next entry.`,
          ),
        );

        setBotState(symbol, scannedState);
        return scannedState;
      }

      if (shouldBootstrapOpenClawValidation) {
        const account = await futuresAutoTradeService.getAccount().catch(() => null);

        return await runInitialOpenClawValidation({
          baseState: scannedState,
          consensus,
          currentAccountSize: account
            ? (parseNumber(account.availableBalance ?? account.totalWalletBalance) ?? null)
            : null,
          currentPrice,
          currentSymbol: symbol,
        });
      }

      // Aggressive scalping entry: if in scalping mode and price is in entry zone with ANY valid plan, enter immediately
      const isScalpingMode = activePlan.botMode === 'scalping';
      const shouldAggressiveEntry =
        isScalpingMode && inEntryZone && activePlan.entryZone.low !== null && activePlan.entryZone.high !== null;

      console.log(
        `[bot-progress] ${symbol}: scalping=${isScalpingMode}, inZone=${inEntryZone}, entryZone=${formatLogPriceRange(entryMin, entryMax)}, price=${formatLogPrice(currentPrice)}, planSource=${current.planSource}, locked=${isOpenClawLockedPlan}`,
      );

      // Aggressive auto-entry for scalping: Enter immediately if price in zone AND in scalping mode
      if (isScalpingMode && inEntryZone && !current.execution && current.status !== 'entry_placed') {
        // Before placing new order, cancel any existing open orders to prevent duplicates
        try {
          const [regularOrders, algoOrders] = await futuresAutoTradeService.getOpenOrders(symbol);
          if (regularOrders.length > 0 || algoOrders.length > 0) {
            console.log(`[recordProgress] ${symbol}: Canceling ${regularOrders.length} regular + ${algoOrders.length} algo orders before placing new scalping entry`);
            await futuresAutoTradeService.cancelOpenOrders(symbol);
          }
        } catch (cancelError) {
          console.warn(`[recordProgress] ${symbol}: Warning - failed to cancel existing orders: ${cancelError instanceof Error ? cancelError.message : 'unknown error'}`);
        }

        await storeLogEntry(
          symbol,
          createLog(
            'success',
            `Scalping auto-entry triggered for ${symbol} at ${formatLogPrice(currentPrice)}. Price ${formatLogPrice(currentPrice)} is in entry zone ${formatLogPriceRange(entryMin, entryMax)}. Executing market order immediately.`,
          ),
          shouldPersistLogs,
        );

        try {
          const execution = (await futuresAutoTradeService.executeTrade(activePlan, currentPrice)) as {
            entryOrder: { orderId: number; status?: string | null; avgPrice?: string | null };
            entryPrice: number | null;
            entryFilled: boolean;
            algoOrderClientIds: string[];
            allocatedMargin: number;
            positionSide: 'LONG' | 'SHORT' | null;
            quantity: number;
            stopLossAlgoOrder: { algoId: number } | null;
            takeProfitAlgoOrders: Array<{ algoId: number }>;
          };

          const executionRecord: FuturesAutoBotExecutionRecord = {
            allocatedMargin: execution.allocatedMargin,
            algoOrderClientIds: execution.algoOrderClientIds,
            entryOrderId: execution.entryOrder.orderId,
            entryOrderStatus: execution.entryOrder.status ?? null,
            entryPrice: execution.entryPrice ?? currentPrice,
            executedAt: new Date().toISOString(),
            positionSide: execution.positionSide,
            stopLossAlgoOrderId: execution.stopLossAlgoOrder?.algoId ?? null,
            takeProfitAlgoOrderIds: execution.takeProfitAlgoOrders.map((order) => order.algoId),
            quantity: execution.quantity,
          };

          const autoEntryState: FuturesAutoBotState = {
            ...scannedState,
            execution: executionRecord,
            status: execution.entryFilled ? 'entry_placed' : 'entry_pending',
            lastClosureAt: null,
            updatedAt: new Date().toISOString(),
          };

          setBotState(symbol, autoEntryState);

          await storeLogEntry(
            symbol,
            createLog(
              'success',
              execution.entryFilled
                ? `Scalping auto-entry executed for ${symbol}. Entry order #${executionRecord.entryOrderId} at ${formatLogPrice(executionRecord.entryPrice)}, TP algo orders ${executionRecord.takeProfitAlgoOrderIds.join(', ') || 'n/a'}, SL algo order ${executionRecord.stopLossAlgoOrderId ?? 'n/a'}.`
                : `Scalping auto-entry placed for ${symbol} at ${formatLogPrice(executionRecord.entryPrice)}. Waiting for fill.`,
            ),
            shouldPersistLogs,
          );

          return autoEntryState;
        } catch (error) {
          const errorMsg = error instanceof Error ? error.message : 'Unknown error';
          await storeLogEntry(
            symbol,
            createLog('error', `Scalping auto-entry failed for ${symbol}: ${errorMsg}`),
            shouldPersistLogs,
          );
          // Continue with normal flow if execution fails
        }
      }

      if (isOpenClawLockedPlan && openClawUnlockReason === null) {
        if (!inEntryZone) {
          setBotState(symbol, scannedState);
          return scannedState;
        }

        await storeLogEntry(
          symbol,
          createLog(
            'success',
            `OpenClaw locked plan triggered for ${symbol} at ${formatLogPrice(currentPrice)}. Using the locked suggestion directly instead of revalidating it again.`,
          ),
        );

        // Before placing new order, cancel any existing open orders to prevent duplicates
        try {
          const [regularOrders, algoOrders] = await futuresAutoTradeService.getOpenOrders(symbol);
          if (regularOrders.length > 0 || algoOrders.length > 0) {
            console.log(`[recordProgress] ${symbol}: Canceling ${regularOrders.length} regular + ${algoOrders.length} algo orders before locked plan execution`);
            await futuresAutoTradeService.cancelOpenOrders(symbol);
          }
        } catch (cancelError) {
          console.warn(`[recordProgress] ${symbol}: Warning - failed to cancel existing orders: ${cancelError instanceof Error ? cancelError.message : 'unknown error'}`);
        }

        const execution = (await futuresAutoTradeService.executeTrade(activePlan, currentPrice)) as {
          entryOrder: { orderId: number; status?: string | null; avgPrice?: string | null };
          entryPrice: number | null;
          entryFilled: boolean;
          algoOrderClientIds: string[];
          allocatedMargin: number;
          positionSide: 'LONG' | 'SHORT' | null;
          quantity: number;
          stopLossAlgoOrder: { algoId: number } | null;
          takeProfitAlgoOrders: Array<{ algoId: number }>;
        };

        const executionRecord: FuturesAutoBotExecutionRecord = {
          allocatedMargin: execution.allocatedMargin,
          algoOrderClientIds: execution.algoOrderClientIds,
          entryOrderId: execution.entryOrder.orderId,
          entryOrderStatus: execution.entryOrder.status ?? null,
          entryPrice: execution.entryPrice ?? currentPrice,
          executedAt: new Date().toISOString(),
          positionSide: execution.positionSide,
          stopLossAlgoOrderId: execution.stopLossAlgoOrder?.algoId ?? null,
          takeProfitAlgoOrderIds: execution.takeProfitAlgoOrders.map((order) => order.algoId),
          quantity: execution.quantity,
        };

        const lockedExecutionState: FuturesAutoBotState = {
          ...scannedState,
          planSource: 'openclaw',
          openClawLockedPlan: activePlan,
          executionHistory: current.executionHistory ?? [],
          planLockedAt: current.planLockedAt ?? new Date().toISOString(),
          planLockExpiresAt:
            current.planLockExpiresAt ?? new Date(Date.now() + OPENCLAW_PLAN_LOCK_TTL_MS).toISOString(),
          execution: executionRecord,
          plan: activePlan,
          status: execution.entryFilled ? 'entry_placed' : 'entry_pending',
          lastClosureAt: null,
        };

        setBotState(symbol, lockedExecutionState);

        await storeLogEntry(
          symbol,
          createLog(
            'success',
            execution.entryFilled
              ? `OpenClaw locked plan accepted for ${symbol}. Entry order #${executionRecord.entryOrderId}, TP algo orders ${executionRecord.takeProfitAlgoOrderIds.join(', ') || 'n/a'}, SL algo order ${executionRecord.stopLossAlgoOrderId ?? 'n/a'}.`
              : `OpenClaw locked plan placed for ${symbol} at ${formatLogPrice(executionRecord.entryPrice)}. Waiting for fill before placing TP/SL.`,
          ),
          shouldPersistLogs,
        );

        return lockedExecutionState;
      }

      const shouldRevalidateOutsideZone = isOpenClawLockedPlan && openClawUnlockReason;

      if (!inEntryZone && !shouldRevalidateOutsideZone) {
        setBotState(symbol, scannedState);
        return scannedState;
      }

      if (
        inEntryZone &&
        isOpenClawLockedPlan &&
        !openClawUnlockReason &&
        shouldSkipOpenClawValidation(current, now, openClawValidationFingerprint)
      ) {
        await storeLogEntry(
          symbol,
          createLog(
            'info',
            `OpenClaw validation cooldown is active for ${symbol}. Waiting before asking again so the same locked plan is not revalidated every poll.`,
          ),
          shouldPersistLogs,
        );

        setBotState(symbol, scannedState);
        return scannedState;
      }

      if (shouldRevalidateOutsideZone) {
        await storeLogEntry(
          symbol,
          createLog(
            'info',
            `Refreshing OpenClaw plan for ${symbol} at ${formatLogPrice(currentPrice)} — ${openClawUnlockReason}`,
          ),
          shouldPersistLogs,
        );
      } else if (inEntryZone) {
        await storeLogEntry(
          symbol,
          createLog(
            'success',
            `Entry trigger hit for ${symbol} at ${formatLogPrice(currentPrice)}. Placing limit entry at the zone edge and waiting for fill.`,
          ),
        );
      }

      const account = await futuresAutoTradeService.getAccount();
      const validation = await futuresAutoValidationService.validateSetup(
        {
          accountSize: parseNumber(account.availableBalance ?? account.totalWalletBalance) ?? null,
          botMode: activePlan.botMode,
          consensusSetup: consensus.consensusSetup,
          setupCandidateOverride: buildValidationSetupCandidateFromPlan(
            activePlan,
            currentPrice,
            consensus.snapshots.find((snapshot) => snapshot.interval === '15m')?.supportResistance?.resistance ?? null,
            consensus.snapshots.find((snapshot) => snapshot.interval === '15m')?.supportResistance?.support ?? null,
          ),
          currentPrice,
          isPerpetual: true,
          leverage: activePlan.leverage,
          symbol,
          timeframeSnapshots: consensus.snapshots,
        },
        {
          bypassCache: openClawUnlockReason !== null,
        },
      );

      if (validation.validation_result !== 'accepted') {
        const suggestedPlan = validation.suggested_setup
          ? buildPlanFromOpenClawSetup(activePlan, validation.suggested_setup)
          : null;
        const lockedPlan = getLockedOpenClawPlan(current, suggestedPlan);

        // If there's a suggested plan, place the order immediately instead of waiting
        if (suggestedPlan && !current.execution && current.status !== 'entry_placed') {
          // Before placing new order, cancel any existing open orders to prevent duplicates
          try {
            const [regularOrders, algoOrders] = await futuresAutoTradeService.getOpenOrders(symbol);
            if (regularOrders.length > 0 || algoOrders.length > 0) {
              console.log(`[recordProgress] ${symbol}: Canceling ${regularOrders.length} regular + ${algoOrders.length} algo orders before placing suggested plan order`);
              await futuresAutoTradeService.cancelOpenOrders(symbol);
            }
          } catch (cancelError) {
            console.warn(`[recordProgress] ${symbol}: Warning - failed to cancel existing orders: ${cancelError instanceof Error ? cancelError.message : 'unknown error'}`);
          }

          await storeLogEntry(
            symbol,
            createLog(
              'success',
              `OpenClaw rejected the current plan but provided a suggestion for ${symbol}. Placing entry order immediately with the suggested setup.`,
            ),
          );

          try {
            const execution = (await futuresAutoTradeService.executeTrade(suggestedPlan, currentPrice)) as {
              entryOrder: { orderId: number; status?: string | null; avgPrice?: string | null };
              entryPrice: number | null;
              entryFilled: boolean;
              algoOrderClientIds: string[];
              allocatedMargin: number;
              positionSide: 'LONG' | 'SHORT' | null;
              quantity: number;
              stopLossAlgoOrder: { algoId: number } | null;
              takeProfitAlgoOrders: Array<{ algoId: number }>;
            };

            const executionRecord: FuturesAutoBotExecutionRecord = {
              allocatedMargin: execution.allocatedMargin,
              algoOrderClientIds: execution.algoOrderClientIds,
              entryOrderId: execution.entryOrder.orderId,
              entryOrderStatus: execution.entryOrder.status ?? null,
              entryPrice: execution.entryPrice ?? currentPrice,
              executedAt: new Date().toISOString(),
              positionSide: execution.positionSide,
              stopLossAlgoOrderId: execution.stopLossAlgoOrder?.algoId ?? null,
              takeProfitAlgoOrderIds: execution.takeProfitAlgoOrders.map((order) => order.algoId),
              quantity: execution.quantity,
            };

            const executedState: FuturesAutoBotState = {
              ...scannedState,
              plan: suggestedPlan,
              execution: executionRecord,
              status: execution.entryFilled ? 'entry_placed' : 'entry_pending',
              planSource: 'openclaw',
              openClawLockedPlan: lockedPlan,
              lastOpenClawValidationAt: new Date().toISOString(),
              lastOpenClawValidationFingerprint: openClawValidationFingerprint,
              planLockedAt: new Date().toISOString(),
              planLockExpiresAt: new Date(Date.now() + OPENCLAW_PLAN_LOCK_TTL_MS).toISOString(),
              updatedAt: new Date().toISOString(),
            };

            setBotState(symbol, executedState);

            await storeLogEntry(
              symbol,
              createLog(
                'success',
                execution.entryFilled
                  ? `OpenClaw suggested setup executed for ${symbol}. Entry order #${executionRecord.entryOrderId} at ${formatLogPrice(executionRecord.entryPrice)}, TP algo orders ${executionRecord.takeProfitAlgoOrderIds.join(', ') || 'n/a'}, SL algo order ${executionRecord.stopLossAlgoOrderId ?? 'n/a'}.`
                  : `OpenClaw suggested setup placed for ${symbol} at ${formatLogPrice(executionRecord.entryPrice)}. Waiting for fill before tracking TP/SL.`,
              ),
              shouldPersistLogs,
            );

            return executedState;
          } catch (error) {
            const errorMsg = error instanceof Error ? error.message : 'Unknown error';
            await storeLogEntry(
              symbol,
              createLog('error', `OpenClaw suggested setup execution failed for ${symbol}: ${errorMsg}`),
              shouldPersistLogs,
            );
            // Fall through to create rejected state
          }
        }

        const rejectedState: FuturesAutoBotState = {
          ...scannedState,
          planSource: suggestedPlan ? 'openclaw' : (scannedState.planSource ?? current.planSource ?? 'consensus'),
          openClawLockedPlan: lockedPlan,
          lastOpenClawValidationAt: new Date().toISOString(),
          lastOpenClawValidationFingerprint: openClawValidationFingerprint,
          planLockedAt: lockedPlan
            ? new Date().toISOString()
            : (scannedState.planLockedAt ?? current.planLockedAt ?? null),
          planLockExpiresAt: lockedPlan
            ? new Date(Date.now() + OPENCLAW_PLAN_LOCK_TTL_MS).toISOString()
            : (scannedState.planLockExpiresAt ?? current.planLockExpiresAt ?? null),
          plan: lockedPlan
            ? { ...lockedPlan, notes: [...lockedPlan.notes, ...validation.adjustment_notes] }
            : scannedState.plan,
          updatedAt: new Date().toISOString(),
        };

        setBotState(symbol, rejectedState);
        await storeLogEntry(
          symbol,
          createLog(
            'warn',
            suggestedPlan
              ? `OpenClaw rejected ${shouldRevalidateOutsideZone ? 'plan refresh' : 'open order'} for ${symbol} (${validation.confidence.toFixed(2)} confidence): ${validation.reason}`
              : `OpenClaw rejected ${shouldRevalidateOutsideZone ? 'plan refresh' : 'open order'} for ${symbol} (${validation.confidence.toFixed(2)} confidence): ${validation.reason}`,
          ),
        );

        if (suggestedPlan) {
          await storeLogEntry(
            symbol,
            createLog(
              'info',
              `OpenClaw suggestion for ${symbol}: ${validation.adjustment_notes.join(' ') || 'No adjustment notes provided.'}`,
            ),
          );

          // Aggressive scalping entry: if in scalping mode and price is already in suggested entry zone, enter immediately
          if (isScalpingMode && suggestedPlan.entryZone.low !== null && suggestedPlan.entryZone.high !== null) {
            const suggestedEntryMin = Math.min(suggestedPlan.entryZone.low, suggestedPlan.entryZone.high);
            const suggestedEntryMax = Math.max(suggestedPlan.entryZone.low, suggestedPlan.entryZone.high);
            const inSuggestedZone = currentPrice >= suggestedEntryMin && currentPrice <= suggestedEntryMax;

            console.log(
              `[aggressive-entry] ${symbol}: inSuggestedZone=${inSuggestedZone}, price=${currentPrice}, zone=${suggestedEntryMin}-${suggestedEntryMax}`,
            );

            if (inSuggestedZone) {
              // Before placing new order, cancel any existing open orders to prevent duplicates
              try {
                const [regularOrders, algoOrders] = await futuresAutoTradeService.getOpenOrders(symbol);
                if (regularOrders.length > 0 || algoOrders.length > 0) {
                  console.log(`[runInitialOpenClawValidation] ${symbol}: Canceling ${regularOrders.length} regular + ${algoOrders.length} algo orders before aggressive entry`);
                  await futuresAutoTradeService.cancelOpenOrders(symbol);
                }
              } catch (cancelError) {
                console.warn(`[runInitialOpenClawValidation] ${symbol}: Warning - failed to cancel existing orders: ${cancelError instanceof Error ? cancelError.message : 'unknown error'}`);
              }

              await storeLogEntry(
                symbol,
                createLog(
                  'success',
                  `Scalping aggressive entry triggered for ${symbol} at ${formatLogPrice(currentPrice)}. Price is in the suggested entry zone ${formatLogPriceRange(suggestedEntryMin, suggestedEntryMax)}. Executing immediately.`,
                ),
                shouldPersistLogs,
              );

              const execution = (await futuresAutoTradeService.executeTrade(suggestedPlan, currentPrice)) as {
                entryOrder: { orderId: number; status?: string | null; avgPrice?: string | null };
                entryPrice: number | null;
                entryFilled: boolean;
                algoOrderClientIds: string[];
                allocatedMargin: number;
                positionSide: 'LONG' | 'SHORT' | null;
                quantity: number;
                stopLossAlgoOrder: { algoId: number } | null;
                takeProfitAlgoOrders: Array<{ algoId: number }>;
              };

              const executionRecord: FuturesAutoBotExecutionRecord = {
                allocatedMargin: execution.allocatedMargin,
                algoOrderClientIds: execution.algoOrderClientIds,
                entryOrderId: execution.entryOrder.orderId,
                entryOrderStatus: execution.entryOrder.status ?? null,
                entryPrice: execution.entryPrice ?? currentPrice,
                executedAt: new Date().toISOString(),
                positionSide: execution.positionSide,
                stopLossAlgoOrderId: execution.stopLossAlgoOrder?.algoId ?? null,
                takeProfitAlgoOrderIds: execution.takeProfitAlgoOrders.map((order) => order.algoId),
                quantity: execution.quantity,
              };

              const aggressiveExecutionState: FuturesAutoBotState = {
                ...rejectedState,
                plan: suggestedPlan,
                execution: executionRecord,
                status: execution.entryFilled ? 'entry_placed' : 'entry_pending',
              };

              setBotState(symbol, aggressiveExecutionState);

              await storeLogEntry(
                symbol,
                createLog(
                  'success',
                  execution.entryFilled
                    ? `Scalping entry executed for ${symbol}. Entry order #${executionRecord.entryOrderId}, TP algo orders ${executionRecord.takeProfitAlgoOrderIds.join(', ') || 'n/a'}, SL algo order ${executionRecord.stopLossAlgoOrderId ?? 'n/a'}.`
                    : `Scalping entry placed for ${symbol} at ${formatLogPrice(executionRecord.entryPrice)}. Waiting for fill.`,
                ),
                shouldPersistLogs,
              );

              return aggressiveExecutionState;
            }
          }
        }

        return rejectedState;
      }

      const validatedPlan = buildPlanFromOpenClawSetup(activePlan, validation.validated_setup);


      if (shouldRevalidateOutsideZone) {
        const refreshedState: FuturesAutoBotState = {
          ...scannedState,
          plan: validatedPlan,
          openClawLockedPlan: validatedPlan,
          lastOpenClawValidationAt: new Date().toISOString(),
          lastOpenClawValidationFingerprint: openClawValidationFingerprint,
          planLockedAt: new Date().toISOString(),
          planLockExpiresAt: new Date(Date.now() + OPENCLAW_PLAN_LOCK_TTL_MS).toISOString(),
          planSource: 'openclaw',
          updatedAt: new Date().toISOString(),
        };

        setBotState(symbol, refreshedState);
        await storeLogEntry(
          symbol,
          createLog(
            'success',
            `OpenClaw plan refreshed for ${symbol}. New entry zone: ${formatLogPriceRange(validatedPlan.entryZone.low, validatedPlan.entryZone.high)}.`,
          ),
          shouldPersistLogs,
        );

        return refreshedState;
      }

      // Before placing new order, cancel any existing open orders to prevent duplicates
      try {
        const [regularOrders, algoOrders] = await futuresAutoTradeService.getOpenOrders(symbol);
        if (regularOrders.length > 0 || algoOrders.length > 0) {
          console.log(`[runInitialOpenClawValidation] ${symbol}: Canceling ${regularOrders.length} regular + ${algoOrders.length} algo orders before placing execution order`);
          await futuresAutoTradeService.cancelOpenOrders(symbol);
        }
      } catch (cancelError) {
        console.warn(`[runInitialOpenClawValidation] ${symbol}: Warning - failed to cancel existing orders: ${cancelError instanceof Error ? cancelError.message : 'unknown error'}`);
      }

      const execution = (await futuresAutoTradeService.executeTrade(validatedPlan, currentPrice)) as {
        entryOrder: { orderId: number; status?: string | null; avgPrice?: string | null };
        entryPrice: number | null;
        entryFilled: boolean;
        algoOrderClientIds: string[];
        allocatedMargin: number;
        positionSide: 'LONG' | 'SHORT' | null;
        quantity: number;
        stopLossAlgoOrder: { algoId: number } | null;
        takeProfitAlgoOrders: Array<{ algoId: number }>;
      };

      const executionRecord: FuturesAutoBotExecutionRecord = {
        allocatedMargin: execution.allocatedMargin,
        algoOrderClientIds: execution.algoOrderClientIds,
        entryOrderId: execution.entryOrder.orderId,
        entryOrderStatus: execution.entryOrder.status ?? null,
        entryPrice: execution.entryPrice ?? currentPrice,
        executedAt: new Date().toISOString(),
        positionSide: execution.positionSide,
        stopLossAlgoOrderId: execution.stopLossAlgoOrder?.algoId ?? null,
        takeProfitAlgoOrderIds: execution.takeProfitAlgoOrders.map((order) => order.algoId),
        quantity: execution.quantity,
      };

      const executedState: FuturesAutoBotState = {
        ...scannedState,
        planSource: 'openclaw',
        openClawLockedPlan: validatedPlan,
        executionHistory: current.executionHistory ?? [],
        lastOpenClawValidationAt: new Date().toISOString(),
        lastOpenClawValidationFingerprint: openClawValidationFingerprint,
        planLockedAt: new Date().toISOString(),
        planLockExpiresAt: new Date(Date.now() + OPENCLAW_PLAN_LOCK_TTL_MS).toISOString(),
        plan: validatedPlan,
        execution: executionRecord,
        status: execution.entryFilled ? 'entry_placed' : 'entry_pending',
      };

      setBotState(symbol, executedState);

      await storeLogEntry(
        symbol,
        createLog(
          'success',
          execution.entryFilled
            ? `OpenClaw accepted open order for ${symbol} (${validation.confidence.toFixed(2)} confidence): ${validation.reason} Entry order #${executionRecord.entryOrderId}, TP algo orders ${executionRecord.takeProfitAlgoOrderIds.join(', ') || 'n/a'}, SL algo order ${executionRecord.stopLossAlgoOrderId ?? 'n/a'}.`
            : `OpenClaw accepted open order for ${symbol} (${validation.confidence.toFixed(2)} confidence): ${validation.reason} Limit entry placed for ${symbol} at ${formatLogPrice(executionRecord.entryPrice)}. Waiting for fill before placing TP/SL.`,
        ),
        shouldPersistLogs,
      );

      return executedState;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown auto bot execution error.';
      const erroredState: FuturesAutoBotState = {
        ...current,
        status: 'error',
        updatedAt: new Date().toISOString(),
      };

      setBotState(symbol, erroredState);
      await storeLogEntry(
        symbol,
        createLog('error', `Auto bot execution failed for ${symbol}: ${errorMessage}`),
        current?.status !== 'entry_placed',
      );

      return erroredState;
    } finally {
      inFlightProgressChecks.delete(symbol);
    }
  }

  async start(input: StartFuturesAutoBotInput) {
    const now = new Date().toISOString();
    const status: FuturesAutoBotState['status'] = 'watching';

    // Load coin config and apply saved allocation/leverage if available
    const coinConfig = await loadCoinConfig(input.symbol);
    const finalInput = coinConfig
      ? {
          ...input,
          allocationUnit: coinConfig.allocation.type,
          allocationValue: coinConfig.allocation.value,
          leverage: coinConfig.leverage,
          marginMode: coinConfig.marginMode,
        }
      : input;

    // Save/update coin config with current allocation and leverage
    if (coinConfig) {
      await saveCoinConfig({
        ...coinConfig,
        allocation: { type: finalInput.allocationUnit, value: finalInput.allocationValue },
        leverage: finalInput.leverage,
        updatedAt: now,
      });
    } else {
      await saveCoinConfig({
        symbol: input.symbol,
        allocation: { type: finalInput.allocationUnit, value: finalInput.allocationValue },
        leverage: finalInput.leverage,
        marginMode: 'isolated',
        updatedAt: now,
      });
    }

    const allocationLabel =
      finalInput.allocationUnit === 'percent'
        ? `${finalInput.allocationValue}% of wallet`
        : `${finalInput.allocationValue} USDT margin`;
    const executionEndpointLabel = BASE_API_BINANCE()?.includes('demo')
      ? 'Binance demo API'
      : BASE_API_BINANCE()
        ? 'Binance live API'
        : 'Binance demo API';
    const logMessage = `Start requested for ${finalInput.symbol} on ${executionEndpointLabel}. The bot will keep refreshing the best consensus until entry fills, then stay focused on the open position. Armed for actual entry on ${finalInput.direction} setup with entry ${formatLogPrice(finalInput.entryMid)}, allocation ${allocationLabel}, leverage ${finalInput.leverage}x.`;

    const state: FuturesAutoBotState = {
      botId: createBotId(finalInput.symbol),
      createdAt: now,
      updatedAt: now,
      plan: finalInput,
      executionHistory: [],
      openClawLockedPlan: null,
      lastOpenClawValidationAt: null,
      lastOpenClawValidationFingerprint: null,
      planSource: 'consensus',
      planLockedAt: null,
      planLockExpiresAt: null,
      status,
    };

    setBotState(finalInput.symbol, state);
    await storeLogEntry(finalInput.symbol, createLog('success', logMessage), true);

    try {
      const consensus = await futuresAutoConsensusService.buildConsensus(finalInput.symbol);
      const ticker = await futuresAutoTradeService.getCurrentPrice(finalInput.symbol);
      const currentPrice = Number(ticker.price);

      if (!Number.isFinite(currentPrice)) {
        await storeLogEntry(
          finalInput.symbol,
          createLog(
            'warn',
            `Initial OpenClaw validation skipped for ${finalInput.symbol}: unable to parse current market price.`,
          ),
          true,
        );
        return state;
      }

      // Check for existing open positions before doing OpenClaw validation
      const openPositions = await futuresAutoTradeService.getOpenPositions(finalInput.symbol);
      console.log(`[DEBUG] getOpenPositions for ${finalInput.symbol}:`, JSON.stringify(openPositions));
      const activePosition = openPositions.find((p) => {
        if (p.symbol !== finalInput.symbol) return false;
        const amt = parseNumber(p.positionAmt) ?? 0;
        return amt !== 0;
      });

      if (activePosition) {
        console.log(`[DEBUG] Active position found for ${finalInput.symbol}:`, JSON.stringify(activePosition));
        const activePositionAmt = parseNumber(activePosition.positionAmt) ?? 0;
        const activePositionSide = getPositionSideFromAmount(activePositionAmt, activePosition.positionSide);
        const protectionQuantity = Math.abs(activePositionAmt);
        const existingEntryPrice = parseNumber(activePosition.entryPrice) ?? finalInput.entryMid;

        console.log(
          `[DEBUG] Position side: ${activePositionSide}, quantity: ${protectionQuantity}, entry price: ${existingEntryPrice}`,
        );

        const focusedState: FuturesAutoBotState = {
          ...state,
          status: 'entry_placed',
          updatedAt: new Date().toISOString(),
        };
        setBotState(finalInput.symbol, focusedState);

        // Check if TP/SL are already in place
        const [regularOrders, algoOrders] = await futuresAutoTradeService.getOpenOrders(finalInput.symbol);
        console.log(`[DEBUG] Regular orders: ${JSON.stringify(regularOrders)}`);
        console.log(`[DEBUG] Algo orders: ${JSON.stringify(algoOrders)}`);
        const hasProtectionOrders = hasOpenProtectionOrder(regularOrders, algoOrders, activePositionSide);
        console.log(`[DEBUG] hasOpenProtectionOrder result: ${hasProtectionOrders}`);

        if (!hasProtectionOrders) {
          console.log(`[DEBUG] No protection orders found, will validate and place them`);
          // Validate existing position through OpenClaw to get appropriate TP/SL
          // IMPORTANT: Use actual position direction (activePositionSide) NOT input direction!
          let openClawPlan = finalInput;
          try {
            const fifteenMinuteSnapshot = consensus.snapshots.find((snapshot) => snapshot.interval === '15m');
            const account = await futuresAutoTradeService.getAccount().catch(() => null);
            console.log(
              `[DEBUG] Calling OpenClaw optimization for existing ${activePositionSide} position at ${existingEntryPrice}`,
            );
            const validation = await futuresAutoValidationService.optimizeExistingPosition(
              {
                accountSize: account
                  ? (parseNumber(account.availableBalance ?? account.totalWalletBalance) ?? null)
                  : null,
                botMode: finalInput.botMode,
                consensusSetup: null, // ← IMPORTANT: NO consensus for position optimization! Just optimize the position itself.
                setupCandidateOverride: buildValidationSetupCandidateFromPlan(
                  {
                    ...finalInput,
                    direction: activePositionSide === 'LONG' ? 'long' : 'short',
                    entryMid: existingEntryPrice,
                  },
                  currentPrice,
                  fifteenMinuteSnapshot?.supportResistance?.resistance ?? null,
                  fifteenMinuteSnapshot?.supportResistance?.support ?? null,
                ),
                currentPrice,
                isPerpetual: true,
                leverage: finalInput.leverage,
                symbol: finalInput.symbol,
                timeframeSnapshots: consensus.snapshots,
              },
              activePositionSide === 'LONG' ? 'long' : 'short',
            );

            console.log(`[DEBUG] OpenClaw validation result: ${JSON.stringify(validation)}`);

            // Use OpenClaw validated or suggested plan for protection orders
            // Mirror logic from runInitialOpenClawValidation
            if (validation.validation_result === 'accepted' && validation.validated_setup) {
              console.log(`[DEBUG] Using validated setup from OpenClaw`);
              openClawPlan = buildPlanFromOpenClawSetup(finalInput, validation.validated_setup);
            } else if (validation.validation_result === 'rejected' && validation.suggested_setup) {
              console.log(`[DEBUG] Using suggested setup from OpenClaw (rejected)`);
              openClawPlan = buildPlanFromOpenClawSetup(finalInput, validation.suggested_setup);
            } else {
              console.log(`[DEBUG] No validated or suggested setup, using input plan`);
            }
          } catch (validationError) {
            const errorMsg = validationError instanceof Error ? validationError.message : 'Unknown validation error';
            console.log(`[DEBUG] OpenClaw validation error: ${errorMsg}`);
            await storeLogEntry(
              finalInput.symbol,
              createLog(
                'warn',
                `OpenClaw validation for existing position skipped: ${errorMsg}. Using consensus plan for TP/SL.`,
              ),
              true,
            );
          }

          // IMPORTANT: Ensure margin mode and leverage are set before placing protection orders
          const marginMode = finalInput.marginMode || 'isolated';
          try {
            console.log(`[DEBUG] Setting margin mode to ${marginMode} for existing position ${finalInput.symbol}`);
            await futuresAutoTradeService.setSymbolMarginMode(finalInput.symbol, marginMode);
            console.log(`[DEBUG] Margin mode set successfully`);
          } catch (marginError) {
            const marginErrorMsg = marginError instanceof Error ? marginError.message : 'Unknown error';
            console.warn(`[DEBUG] Failed to set margin mode for ${finalInput.symbol}: ${marginErrorMsg}`);
          }

          const takeProfitStartIndex = Math.min(
            inferFilledTakeProfitCount({
              currentQuantity: protectionQuantity,
              executionQuantity: protectionQuantity,
            }),
            openClawPlan.takeProfits.length,
          );
          console.log(`[DEBUG] Placing protection orders with takeProfitStartIndex: ${takeProfitStartIndex}`);
          console.log(
            `[DEBUG] Protection plan TP1: ${openClawPlan.takeProfits[0]?.price}, TP2: ${openClawPlan.takeProfits[1]?.price}, SL: ${openClawPlan.stopLoss}`,
          );
          const protectionOrders = await futuresAutoTradeService.placeProtectionOrders(
            openClawPlan,
            protectionQuantity,
            {
              takeProfitStartIndex,
            },
          );

          // Validate that both SL and TPs were placed
          const hasSL = Boolean(protectionOrders.stopLossAlgoOrder);
          const hasTP = protectionOrders.takeProfitAlgoOrders.length > 0;

          console.log(`[DEBUG] placeProtectionOrders result: SL=${hasSL}, TP count=${protectionOrders.takeProfitAlgoOrders.length}`);

          if (!hasSL || !hasTP) {
            const missingParts = [!hasSL && 'SL', !hasTP && 'TP'].filter(Boolean).join(' and ');
            console.warn(
              `[DEBUG] WARNING: Existing position for ${finalInput.symbol} has incomplete protection: ${missingParts} NOT placed!`,
            );
          }

          const timestamp = new Date().toISOString();
          const protectionState: FuturesAutoBotState = {
            ...focusedState,
            plan: openClawPlan,
            planSource: 'openclaw',
            openClawLockedPlan: openClawPlan,
            planLockedAt: timestamp,
            planLockExpiresAt: new Date(Date.now() + OPENCLAW_PLAN_LOCK_TTL_MS).toISOString(),
            execution: {
              allocatedMargin: 0,
              algoOrderClientIds: protectionOrders.algoOrderClientIds,
              entryOrderId: 0,
              entryOrderStatus: null,
              entryPrice: existingEntryPrice,
              executedAt: timestamp,
              positionSide: activePositionSide === 'BOTH' ? null : activePositionSide,
              stopLossAlgoOrderId: protectionOrders.stopLossAlgoOrder?.algoId ?? null,
              takeProfitAlgoOrderIds: protectionOrders.takeProfitAlgoOrders.map((o) => o.algoId),
              quantity: protectionQuantity,
            },
          };
          setBotState(finalInput.symbol, protectionState);
          await storeLogEntry(
            finalInput.symbol,
            createLog(
              'success',
              `Bot started with existing position for ${finalInput.symbol} (${activePositionSide}, qty ${protectionQuantity}). TP/SL were missing — validating through OpenClaw and attaching protection orders. Skipping new entry order.`,
            ),
            true,
          );
          return protectionState;
        }

        await storeLogEntry(
          finalInput.symbol,
          createLog(
            'info',
            `Bot started with existing position for ${finalInput.symbol} (${activePositionSide}, qty ${protectionQuantity}). TP/SL already attached. Skipping new entry order.`,
          ),
          true,
        );
        return focusedState;
      }

      const account = await futuresAutoTradeService.getAccount().catch(() => null);
      return await runInitialOpenClawValidation({
        baseState: state,
        consensus,
        currentAccountSize: account
          ? (parseNumber(account.availableBalance ?? account.totalWalletBalance) ?? null)
          : null,
        currentPrice,
        currentSymbol: finalInput.symbol,
      });
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown initial OpenClaw validation error.';
      await storeLogEntry(
        finalInput.symbol,
        createLog('warn', `Initial OpenClaw validation skipped for ${finalInput.symbol}: ${errorMessage}`),
        true,
      );
      return state;
    }
  }

  async stop(symbol: string) {
    const current = inMemoryBots.get(symbol) ?? null;

    if (!current) {
      await storeLogEntry(
        symbol,
        createLog('warn', `Stop requested for ${symbol}, but no active bot was found.`),
        true,
      );
      return null;
    }

    if (current.execution || current.status === 'entry_placed') {
      try {
        await futuresAutoTradeService.cancelOpenOrders(symbol);
        await storeLogEntry(
          symbol,
          createLog('success', `Cancelled open orders for ${symbol}.`),
          current.status !== 'entry_placed',
        );
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : 'Unknown cancellation error.';
        await storeLogEntry(
          symbol,
          createLog('error', `Failed to cancel open orders for ${symbol}: ${errorMessage}`),
          current.status !== 'entry_placed',
        );
      }
    }

    const nextState: FuturesAutoBotState = {
      ...current,
      status: 'stopped',
      updatedAt: new Date().toISOString(),
    };

    setBotState(symbol, nextState);
    await storeLogEntry(
      symbol,
      createLog('info', `Auto bot stopped for ${symbol}. Active watch loop ended.`),
      current.status !== 'entry_placed',
    );

    return nextState;
  }

  async revalidate(symbol: string) {
    const currentBot = inMemoryBots.get(symbol);

    if (!currentBot) {
      await storeLogEntry(
        symbol,
        createLog('warn', `Revalidation requested for ${symbol}, but no active bot was found.`),
        true,
      );
      return null;
    }

    const consensus = await futuresAutoConsensusService.buildConsensus(symbol);
    let currentPrice = currentBot.plan.entryMid; // Use last known entry point as reference

    // If entryMid is null, get current market price
    if (!currentPrice) {
      const ticker = await futuresAutoTradeService.getCurrentPrice(symbol);
      currentPrice = Number(ticker.price);
    }

    const account = await futuresAutoTradeService.getAccount().catch(() => null);
    const accountSize = account ? (parseNumber(account.availableBalance ?? account.totalWalletBalance) ?? null) : null;

    await storeLogEntry(
      symbol,
      createLog('info', `Manual revalidation requested for ${symbol} at ${formatLogPrice(currentPrice)}.`),
      true,
    );

    return await runInitialOpenClawValidation({
      baseState: currentBot,
      consensus,
      currentAccountSize: accountSize,
      currentPrice,
      currentSymbol: symbol,
    });
  }

  async optimizeExistingPosition(symbol: string) {
    const currentBot = inMemoryBots.get(symbol);

    if (!currentBot) {
      await storeLogEntry(
        symbol,
        createLog('warn', `Position optimization requested for ${symbol}, but no active bot was found.`),
        true,
      );
      return null;
    }

    if (!currentBot.execution) {
      await storeLogEntry(
        symbol,
        createLog('warn', `Position optimization requested for ${symbol}, but no open position entry found.`),
        true,
      );
      return null;
    }

    const consensus = await futuresAutoConsensusService.buildConsensus(symbol);
    const account = await futuresAutoTradeService.getAccount().catch(() => null);
    const accountSize = account ? (parseNumber(account.availableBalance ?? account.totalWalletBalance) ?? null) : null;

    // Use the actual entry price of the open position
    let entryPrice = currentBot.execution.entryPrice ?? currentBot.plan.entryMid;

    // If entry price is null, get current market price
    if (!entryPrice) {
      const ticker = await futuresAutoTradeService.getCurrentPrice(symbol);
      entryPrice = Number(ticker.price);
    }

    const direction = currentBot.plan.direction;

    await storeLogEntry(
      symbol,
      createLog(
        'info',
        `Requesting OpenClaw to optimize existing ${direction.toUpperCase()} position for ${symbol} (entered at ${formatLogPrice(entryPrice)}). Asking for best TP/SL levels for this specific entry.`,
      ),
      true,
    );

    return await futuresAutoValidationService.validateSetup(
      {
        accountSize,
        botMode: currentBot.plan.botMode,
        consensusSetup: consensus.consensusSetup,
        currentPrice: entryPrice, // Use entry price as reference for optimization
        isPerpetual: true,
        leverage: currentBot.plan.leverage,
        symbol,
        timeframeSnapshots: consensus.snapshots,
      },
      { bypassCache: true },
    );
  }

  async manualEntry(symbol: string) {
    const currentBot = inMemoryBots.get(symbol);

    if (!currentBot) {
      await storeLogEntry(
        symbol,
        createLog('error', `Manual entry requested for ${symbol}, but no active bot was found.`),
        true,
      );
      return null;
    }

    const ticker = await futuresAutoTradeService.getCurrentPrice(symbol);
    const currentPrice = Number(ticker.price);

    if (!Number.isFinite(currentPrice)) {
      await storeLogEntry(
        symbol,
        createLog('error', `Manual entry failed for ${symbol}: Unable to get current market price.`),
        true,
      );
      return null;
    }

    await storeLogEntry(
      symbol,
      createLog(
        'info',
        `Manual entry triggered for ${symbol} at market price ${formatLogPrice(currentPrice)}. Executing immediately regardless of validation status.`,
      ),
      true,
    );

    try {
      const execution = (await futuresAutoTradeService.executeTrade(currentBot.plan, currentPrice)) as {
        entryOrder: { orderId: number; status?: string | null; avgPrice?: string | null };
        entryPrice: number | null;
        entryFilled: boolean;
        algoOrderClientIds: string[];
        allocatedMargin: number;
        positionSide: 'LONG' | 'SHORT' | null;
        quantity: number;
        stopLossAlgoOrder: { algoId: number } | null;
        takeProfitAlgoOrders: Array<{ algoId: number }>;
      };

      const executionRecord: FuturesAutoBotExecutionRecord = {
        allocatedMargin: execution.allocatedMargin,
        algoOrderClientIds: execution.algoOrderClientIds,
        entryOrderId: execution.entryOrder.orderId,
        entryOrderStatus: execution.entryOrder.status ?? null,
        entryPrice: execution.entryPrice ?? currentPrice,
        executedAt: new Date().toISOString(),
        positionSide: execution.positionSide,
        stopLossAlgoOrderId: execution.stopLossAlgoOrder?.algoId ?? null,
        takeProfitAlgoOrderIds: execution.takeProfitAlgoOrders.map((order) => order.algoId),
        quantity: execution.quantity,
      };

      const executedState: FuturesAutoBotState = {
        ...currentBot,
        execution: executionRecord,
        status: execution.entryFilled ? 'entry_placed' : 'entry_pending',
        updatedAt: new Date().toISOString(),
      };

      setBotState(symbol, executedState);

      await storeLogEntry(
        symbol,
        createLog(
          'success',
          execution.entryFilled
            ? `Manual entry executed for ${symbol}. Entry order #${executionRecord.entryOrderId} at ${formatLogPrice(executionRecord.entryPrice)}, TP algo orders ${executionRecord.takeProfitAlgoOrderIds.join(', ') || 'n/a'}, SL algo order ${executionRecord.stopLossAlgoOrderId ?? 'n/a'}.`
            : `Manual entry placed for ${symbol} at ${formatLogPrice(executionRecord.entryPrice)}. Waiting for fill.`,
        ),
        true,
      );

      return executedState;
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : 'Unknown error';
      await storeLogEntry(symbol, createLog('error', `Manual entry execution failed for ${symbol}: ${errorMsg}`), true);
      return null;
    }
  }

  async clear(symbol: string) {
    inMemoryBots.delete(symbol);
    inMemoryLogs.delete(symbol);
    inFlightProgressChecks.delete(symbol);
    // Also delete from disk
    await deleteBotState(symbol).catch((error) => {
      console.error(`[bot-state] Failed to delete state for ${symbol}:`, error);
    });
  }
}

export const futuresAutoBotService = new FuturesAutoBotService();
