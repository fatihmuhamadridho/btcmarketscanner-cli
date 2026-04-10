import { randomUUID } from "crypto";
import { BASE_API_BINANCE } from "../../../../../configs/base.config.js";
import { formatDecimalString } from "../../../../../utils/format-number.util.js";
import { futuresAutoConsensusService } from "./futuresAutoConsensus.service.js";
import { futuresAutoValidationService } from "./futuresAutoValidation.service.js";
import { futuresAutoTradeService } from "./futuresAutoTrade.service.js";
const inMemoryBots = new Map();
const inMemoryLogs = new Map();
const inFlightProgressChecks = new Set();
const OPENCLAW_PLAN_LOCK_TTL_MS = 45 * 60 * 1000;
const OPENCLAW_REVALIDATION_COOLDOWN_MS = 10 * 60 * 1000;
const USER_TIME_ZONE = "Asia/Jakarta";
function createBotId(symbol) {
  return `${symbol}-${randomUUID()}`;
}
function createLog(level, message) {
  return {
    id: randomUUID(),
    level,
    message,
    timestamp: new Date().toISOString(),
  };
}
async function storeLogEntry(symbol, log, _persistToRedis = true) {
  void _persistToRedis;
  const currentLogs = inMemoryLogs.get(symbol) ?? [];
  inMemoryLogs.set(symbol, [...currentLogs, log].slice(-50));
}
function parseNumber(value) {
  if (value === undefined || value === null || value.trim().length === 0)
    return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}
function formatLogPrice(value) {
  if (value === null || value === undefined || Number.isNaN(value))
    return "n/a";
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
function formatUserDateTime(value) {
  if (!value) return "the TTL expires";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  return new Intl.DateTimeFormat("en-GB", {
    dateStyle: "medium",
    timeStyle: "medium",
    timeZone: USER_TIME_ZONE,
  }).format(parsed);
}
function createWatchingStateFromConsensus(params) {
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
      setupType:
        consensusSetup.pathMode === "breakout"
          ? "breakout_retest"
          : "continuation",
      stopLoss: consensusSetup.stopLoss,
      takeProfits: consensusSetup.takeProfits,
    },
    planLockedAt: null,
    planLockExpiresAt: null,
    planSource: "consensus",
    status: "watching",
    updatedAt: new Date().toISOString(),
  };
}
function buildValidationSetupCandidateFromPlan(
  plan,
  currentPrice,
  currentResistance,
  currentSupport,
) {
  const entryLow = plan.entryZone.low ?? plan.entryMid ?? currentPrice;
  const entryHigh = plan.entryZone.high ?? plan.entryMid ?? currentPrice;
  const plannedEntry = plan.entryMid ?? entryLow;
  const stopLoss = plan.stopLoss ?? currentPrice;
  const tp1 = plan.takeProfits[0]?.price ?? null;
  const tp2 = plan.takeProfits[1]?.price ?? null;
  const risk =
    plan.direction === "short"
      ? stopLoss - plannedEntry
      : plannedEntry - stopLoss;
  const tp1Distance =
    tp1 === null
      ? null
      : plan.direction === "short"
        ? plannedEntry - tp1
        : tp1 - plannedEntry;
  const tp2Distance =
    tp2 === null
      ? null
      : plan.direction === "short"
        ? plannedEntry - tp2
        : tp2 - plannedEntry;
  return {
    direction: plan.direction,
    distance_to_resistance:
      currentResistance !== null
        ? Math.abs(currentResistance - currentPrice)
        : null,
    distance_to_support:
      currentSupport !== null ? Math.abs(currentPrice - currentSupport) : null,
    entry_zone: [entryLow, entryHigh],
    planned_entry: plannedEntry,
    risk_reward: {
      tp1:
        risk > 0 && tp1Distance !== null ? tp1Distance / risk : plan.riskReward,
      tp2:
        risk > 0 && tp2Distance !== null ? tp2Distance / risk : plan.riskReward,
    },
    setup_type: plan.setupType ?? "continuation",
    sl_distance: Math.abs(plannedEntry - stopLoss),
    stop_loss: stopLoss,
    take_profit: { tp1, tp2 },
    tp_distance: {
      tp1: tp1Distance !== null ? Math.abs(tp1Distance) : null,
      tp2: tp2Distance !== null ? Math.abs(tp2Distance) : null,
    },
  };
}
export class FuturesAutoBotService {
  get(symbol) {
    return inMemoryBots.get(symbol) ?? null;
  }
  hydrate(symbol, state) {
    if (state === null) {
      inMemoryBots.delete(symbol);
      return null;
    }
    inMemoryBots.set(symbol, state);
    return state;
  }
  async getResolved(symbol) {
    return inMemoryBots.get(symbol) ?? null;
  }
  async getLogs(symbol) {
    return inMemoryLogs.get(symbol) ?? [];
  }
  async recordProgress(symbol) {
    const current = inMemoryBots.get(symbol) ?? null;
    if (!current || current.status === "stopped") return current;
    return current;
  }
  async start(input) {
    const now = new Date().toISOString();
    const state = {
      botId: createBotId(input.symbol),
      createdAt: now,
      updatedAt: now,
      plan: input,
      executionHistory: [],
      openClawLockedPlan: null,
      lastOpenClawValidationAt: null,
      lastOpenClawValidationFingerprint: null,
      planSource: "consensus",
      planLockedAt: null,
      planLockExpiresAt: null,
      status: "watching",
    };
    inMemoryBots.set(input.symbol, state);
    await storeLogEntry(
      input.symbol,
      createLog(
        "success",
        `Start requested for ${input.symbol} on ${BASE_API_BINANCE() ?? "Binance demo API"}.`,
      ),
      true,
    );
    try {
      const consensus = await futuresAutoConsensusService.buildConsensus(
        input.symbol,
      );
      const ticker = await futuresAutoTradeService.getCurrentPrice(
        input.symbol,
      );
      const currentPrice = Number(ticker.price);
      if (!Number.isFinite(currentPrice)) return state;
      const account = await futuresAutoTradeService
        .getAccount()
        .catch(() => null);
      const validation = await futuresAutoValidationService.validateSetup(
        {
          accountSize: account
            ? (parseNumber(
                account.availableBalance ?? account.totalWalletBalance,
              ) ?? null)
            : null,
          consensusSetup: consensus.consensusSetup,
          setupCandidateOverride: buildValidationSetupCandidateFromPlan(
            input,
            currentPrice,
            consensus.snapshots.find((snapshot) => snapshot.interval === "15m")
              ?.supportResistance?.resistance ?? null,
            consensus.snapshots.find((snapshot) => snapshot.interval === "15m")
              ?.supportResistance?.support ?? null,
          ),
          currentPrice,
          isPerpetual: true,
          leverage: input.leverage,
          symbol: input.symbol,
          timeframeSnapshots: consensus.snapshots,
        },
        { bypassCache: true },
      );
      if (validation.validation_result === "accepted") {
        const lockedState = {
          ...state,
          plan: {
            ...input,
            direction: validation.validated_setup.direction,
            entryMid: validation.validated_setup.planned_entry,
            entryZone: {
              low: validation.validated_setup.entry_zone[0],
              high: validation.validated_setup.entry_zone[1],
            },
            riskReward:
              validation.validated_setup.risk_reward.tp2 ??
              validation.validated_setup.risk_reward.tp1 ??
              input.riskReward,
            setupLabel: `OpenClaw Suggested ${validation.validated_setup.direction === "long" ? "Long" : "Short"} Setup`,
            setupType: validation.validated_setup.setup_type,
            stopLoss: validation.validated_setup.stop_loss,
            takeProfits: [
              {
                label: "TP1",
                price: validation.validated_setup.take_profit.tp1,
              },
              {
                label: "TP2",
                price: validation.validated_setup.take_profit.tp2,
              },
              { label: "TP3", price: null },
            ],
          },
          planSource: "openclaw",
          openClawLockedPlan: null,
          planLockedAt: now,
          planLockExpiresAt: new Date(
            Date.now() + OPENCLAW_PLAN_LOCK_TTL_MS,
          ).toISOString(),
          updatedAt: now,
        };
        inMemoryBots.set(input.symbol, lockedState);
        return lockedState;
      }
      return state;
    } catch {
      return state;
    }
  }
  async stop(symbol) {
    const current = inMemoryBots.get(symbol) ?? null;
    if (!current) return null;
    const nextState = {
      ...current,
      status: "stopped",
      updatedAt: new Date().toISOString(),
    };
    inMemoryBots.set(symbol, nextState);
    return nextState;
  }
  async clear(symbol) {
    inMemoryBots.delete(symbol);
    inMemoryLogs.delete(symbol);
    inFlightProgressChecks.delete(symbol);
  }
}
export const futuresAutoBotService = new FuturesAutoBotService();
