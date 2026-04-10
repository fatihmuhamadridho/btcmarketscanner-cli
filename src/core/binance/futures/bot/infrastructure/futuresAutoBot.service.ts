import { randomUUID } from 'crypto';
import { BASE_API_BINANCE } from '@configs/base.config';
import { formatDecimalString } from '@utils/format-number.util';
import type { FuturesAutoBotExecutionRecord, FuturesAutoBotLogEntry, FuturesAutoBotState, StartFuturesAutoBotInput } from '../domain/futuresAutoBot.model';
import { futuresAutoConsensusService } from './futuresAutoConsensus.service';
import { futuresAutoTradeService } from './futuresAutoTrade.service';

const inMemoryBots = new Map<string, FuturesAutoBotState>();
const inMemoryLogs = new Map<string, FuturesAutoBotLogEntry[]>();
const inFlightProgressChecks = new Set<string>();

function createBotId(symbol: string) {
  return `${symbol}-${randomUUID()}`;
}

function createLog(level: FuturesAutoBotLogEntry['level'], message: string): FuturesAutoBotLogEntry {
  return { id: randomUUID(), level, message, timestamp: new Date().toISOString() };
}

async function storeLogEntry(symbol: string, log: FuturesAutoBotLogEntry) {
  const currentLogs = inMemoryLogs.get(symbol) ?? [];
  inMemoryLogs.set(symbol, [...currentLogs, log].slice(-50));
}

function parseNumber(value?: string | null) {
  if (value === undefined || value === null || value.trim().length === 0) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function formatLogPrice(value: number | null | undefined) {
  if (value === null || value === undefined || Number.isNaN(value)) return 'n/a';
  const absoluteValue = Math.abs(value);
  const decimals = absoluteValue >= 1000 ? 2 : absoluteValue >= 100 ? 3 : absoluteValue >= 1 ? 4 : absoluteValue >= 0.1 ? 5 : 7;
  return formatDecimalString(value.toFixed(decimals));
}

function buildConsensusPlanFromSnapshot(plan: FuturesAutoBotState['plan'], snapshot: Awaited<ReturnType<typeof futuresAutoConsensusService.buildConsensus>>['consensusSetup']) {
  if (!snapshot) return plan;
  return {
    ...plan,
    currentPrice: plan.currentPrice,
    direction: snapshot.direction,
    entryMid: snapshot.entryMid,
    entryZone: { low: snapshot.entryZone.low, high: snapshot.entryZone.high },
    notes: snapshot.reasons,
    riskReward: snapshot.riskReward,
    setupGrade: snapshot.grade,
    setupGradeRank: snapshot.gradeRank,
    setupLabel: snapshot.label,
    setupType: snapshot.pathMode === 'breakout' ? 'breakout_retest' : 'continuation',
    stopLoss: snapshot.stopLoss,
    takeProfits: snapshot.takeProfits,
  };
}

function createWatchingStateFromConsensus(params: {
  current: FuturesAutoBotState;
  consensus: Awaited<ReturnType<typeof futuresAutoConsensusService.buildConsensus>>;
  currentPrice: number;
}) {
  const { current, consensus, currentPrice } = params;
  const consensusPlan = buildConsensusPlanFromSnapshot(current.plan, consensus.consensusSetup);
  return {
    ...current,
    execution: null,
    executionHistory: current.executionHistory ?? [],
    openClawLockedPlan: null,
    plan: {
      ...consensusPlan,
      currentPrice,
    },
    planLockedAt: null,
    planLockExpiresAt: null,
    planSource: 'consensus' as const,
    status: 'watching' as const,
    updatedAt: new Date().toISOString(),
  } satisfies FuturesAutoBotState;
}

function buildPlanFromConsensus(plan: FuturesAutoBotState['plan'], consensusSetup: NonNullable<Awaited<ReturnType<typeof futuresAutoConsensusService.buildConsensus>>['consensusSetup']>) {
  return buildConsensusPlanFromSnapshot(plan, consensusSetup);
}

export class FuturesAutoBotService {
  get(symbol: string) {
    return inMemoryBots.get(symbol) ?? null;
  }

  hydrate(symbol: string, state: FuturesAutoBotState | null) {
    if (state === null) {
      inMemoryBots.delete(symbol);
      return null;
    }

    inMemoryBots.set(symbol, state);
    return state;
  }

  async getResolved(symbol: string) {
    return inMemoryBots.get(symbol) ?? null;
  }

  async getLogs(symbol: string) {
    return inMemoryLogs.get(symbol) ?? [];
  }

  async recordProgress(symbol: string) {
    const current = inMemoryBots.get(symbol) ?? null;
    if (!current || current.status === 'stopped') return current;
    if (inFlightProgressChecks.has(symbol)) return current;

    inFlightProgressChecks.add(symbol);

    try {
      const consensus = await futuresAutoConsensusService.buildConsensus(symbol);
      const ticker = await futuresAutoTradeService.getCurrentPrice(symbol);
      const currentPrice = Number(ticker.price);
      if (!Number.isFinite(currentPrice)) throw new Error('Unable to parse current market price.');

      let nextState: FuturesAutoBotState = current;
      const activePosition = (await futuresAutoTradeService.getOpenPositions(symbol)).find((position) => {
        if (position.symbol !== symbol) return false;
        const positionAmt = parseNumber(position.positionAmt) ?? 0;
        return positionAmt !== 0;
      });
      const activePositionAmt = parseNumber(activePosition?.positionAmt) ?? 0;
      const activePositionSide = activePosition
        ? activePositionAmt > 0
          ? 'LONG'
          : activePositionAmt < 0
            ? 'SHORT'
            : 'BOTH'
        : null;
      const isPositionOpen = current.status === 'entry_placed' || Boolean(activePosition);
      const hasConsensusSetup = Boolean(consensus.consensusSetup);

      if (isPositionOpen && activePositionSide) {
        const [regularOrders, algoOrders] = await futuresAutoTradeService.getOpenOrders(symbol);
        const hasProtectionOrders = regularOrders.some((order) => order.type && (order.type.includes('STOP') || order.type.includes('TAKE_PROFIT')))
          || algoOrders.some((order) => order.reduceOnly === true || order.closePosition === true || (order.type && (order.type.includes('STOP') || order.type.includes('TAKE_PROFIT'))));
        const protectionQuantity = Math.abs(activePositionAmt);
        const focusedState: FuturesAutoBotState = {
          ...nextState,
          execution: nextState.execution ?? current.execution ?? undefined,
          status: 'entry_placed',
        };
        inMemoryBots.set(symbol, focusedState);

        if (!hasProtectionOrders) {
          const protectionOrders = await futuresAutoTradeService.placeProtectionOrders(focusedState.plan, protectionQuantity);
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

          inMemoryBots.set(symbol, protectionState);
          await storeLogEntry(symbol, createLog('success', `Existing position detected for ${symbol}. TP/SL were missing, so protection orders were attached.`));
          return protectionState;
        }

        await storeLogEntry(symbol, createLog('info', `Existing position detected for ${symbol}. TP/SL already attached.`));
        return focusedState;
      }

      if (!hasConsensusSetup) {
        inMemoryBots.set(symbol, {
          ...current,
          status: 'watching',
          updatedAt: new Date().toISOString(),
        });
        await storeLogEntry(symbol, createLog('warn', `Consensus unavailable for ${symbol}. Waiting for more market data.`));
        return inMemoryBots.get(symbol) ?? current;
      }

      const activePlan = current.planSource === 'consensus' ? current.plan : buildPlanFromConsensus(current.plan, consensus.consensusSetup);
      const entryLow = activePlan.entryZone.low ?? activePlan.entryMid ?? null;
      const entryHigh = activePlan.entryZone.high ?? activePlan.entryMid ?? null;
      const entryMin = entryLow !== null && entryHigh !== null ? Math.min(entryLow, entryHigh) : null;
      const entryMax = entryLow !== null && entryHigh !== null ? Math.max(entryLow, entryHigh) : null;
      const inEntryZone = entryMin !== null && entryMax !== null ? currentPrice >= entryMin && currentPrice <= entryMax : false;

      const scannedState: FuturesAutoBotState = {
        ...nextState,
        lastScanPrice: currentPrice,
        plan: activePlan,
        planSource: 'consensus',
        updatedAt: new Date().toISOString(),
      };

      if (!inEntryZone) {
        inMemoryBots.set(symbol, scannedState);
        return scannedState;
      }

      await storeLogEntry(symbol, createLog('success', `Entry trigger hit for ${symbol} at ${formatLogPrice(currentPrice)}. Placing limit entry.`));

      const account = await futuresAutoTradeService.getAccount().catch(() => null);
      const execution = (await futuresAutoTradeService.executeTrade(activePlan, currentPrice)) as {
        entryOrder: { orderId: number; status?: string | null };
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
        execution: executionRecord,
        executionHistory: current.executionHistory ?? [],
        plan: activePlan,
        planLockedAt: new Date().toISOString(),
        planLockExpiresAt: null,
        planSource: 'consensus',
        status: execution.entryFilled ? 'entry_placed' : 'entry_pending',
      };

      inMemoryBots.set(symbol, executedState);
      await storeLogEntry(
        symbol,
        createLog(
          'success',
          execution.entryFilled
            ? `Consensus accepted for ${symbol}. Entry order #${executionRecord.entryOrderId}, TP/SL orders attached.`
            : `Consensus entry placed for ${symbol} at ${formatLogPrice(executionRecord.entryPrice)}. Waiting for fill.`,
        ),
      );

      void account;
      return executedState;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown auto bot execution error.';
      const erroredState: FuturesAutoBotState = {
        ...current,
        status: 'error',
        updatedAt: new Date().toISOString(),
      };
      inMemoryBots.set(symbol, erroredState);
      await storeLogEntry(symbol, createLog('error', `Auto bot execution failed for ${symbol}: ${errorMessage}`));
      return erroredState;
    } finally {
      inFlightProgressChecks.delete(symbol);
    }
  }

  async start(input: StartFuturesAutoBotInput) {
    const now = new Date().toISOString();
    const executionEndpointLabel = BASE_API_BINANCE()?.includes('demo') ? 'Binance demo API' : 'Binance live API';
    const state: FuturesAutoBotState = {
      botId: createBotId(input.symbol),
      createdAt: now,
      updatedAt: now,
      plan: input,
      executionHistory: [],
      openClawLockedPlan: null,
      lastOpenClawValidationAt: null,
      lastOpenClawValidationFingerprint: null,
      planSource: 'consensus',
      planLockedAt: null,
      planLockExpiresAt: null,
      status: 'watching',
    };

    inMemoryBots.set(input.symbol, state);
    await storeLogEntry(
      input.symbol,
      createLog(
        'success',
        `Start requested for ${input.symbol} on ${executionEndpointLabel}. Armed for consensus entry with entry ${formatLogPrice(input.entryMid)}, leverage ${input.leverage}x.`,
      ),
    );

    return state;
  }

  async stop(symbol: string) {
    const current = inMemoryBots.get(symbol) ?? null;
    if (!current) return null;
    const nextState: FuturesAutoBotState = { ...current, status: 'stopped', updatedAt: new Date().toISOString() };
    inMemoryBots.set(symbol, nextState);
    return nextState;
  }

  async clear(symbol: string) {
    inMemoryBots.delete(symbol);
    inMemoryLogs.delete(symbol);
    inFlightProgressChecks.delete(symbol);
  }
}

export const futuresAutoBotService = new FuturesAutoBotService();
