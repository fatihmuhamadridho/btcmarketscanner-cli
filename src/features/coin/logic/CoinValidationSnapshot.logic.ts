import type { FuturesKlineCandle } from '@core/binance/futures/market/domain/futuresMarket.model';
import { analyzeTrend } from 'btcmarketscanner-core';
import type { TrendInsight } from 'btcmarketscanner-core';
import type {
  CoinValidationSnapshot,
  CoinValidationSnapshotCandle,
  CoinValidationSnapshotSetupCandidate,
  CoinValidationSnapshotTimeframe,
  CoinValidationSnapshotTimeframeRole,
} from '../interface/CoinValidationSnapshot.interface';
import type { CoinSetupDetail, CoinTimeframeSupportResistance } from '../interface/CoinView.interface';

const VALIDATION_RULES = {
  min_rr: 2.0,
  max_distance_to_resistance_atr_multiple: 1.0,
  min_sl_atr_multiple: 0.8,
  min_tp1_atr_multiple: 1.5,
  require_htf_trend_alignment: true,
};

const TIMEFRAME_ROLES: Record<'4h' | '1h' | '15m' | '1m', CoinValidationSnapshotTimeframeRole> = {
  '1m': 'trigger',
  '15m': 'setup_main',
  '1h': 'bias_primary',
  '4h': 'macro_soft',
};

const SNAPSHOT_CANDLE_LIMITS: Record<'1m' | '15m' | '1h' | '4h', number> = {
  '1m': 12,
  '15m': 36,
  '1h': 30,
  '4h': 18,
};

type BuildCoinValidationSnapshotInput = {
  accountSize: number | null;
  consensusSetup: CoinSetupDetail | null;
  setupCandidateOverride?: CoinValidationSnapshotSetupCandidate | null;
  currentPrice: number;
  currentTrend: TrendInsight;
  leverage: number;
  isPerpetual: boolean;
  symbol: string;
  timeframeSupportResistance: ReadonlyArray<CoinTimeframeSupportResistance>;
  timeframeSources: Partial<Record<'1m' | '15m' | '1h' | '4h', FuturesKlineCandle[]>>;
};

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function getDateId(value: Date) {
  return value.toISOString().slice(0, 10);
}

function getSession(value: Date): CoinValidationSnapshot['current_context']['session'] {
  const hour = value.getUTCHours();
  if (hour >= 7 && hour < 9) return 'overlap';
  if (hour >= 13 && hour < 16) return 'overlap';
  if (hour >= 0 && hour < 7) return 'asia';
  if (hour >= 7 && hour < 14) return 'europe';
  return 'us';
}

function getVolatilityState(
  price: number | null,
  atr14: number | null,
): CoinValidationSnapshot['current_context']['volatility_state'] {
  if (!isFiniteNumber(price) || !isFiniteNumber(atr14) || price <= 0) return 'normal';
  const atrRatio = atr14 / price;
  if (atrRatio < 0.005) return 'low';
  if (atrRatio < 0.05) return 'normal';
  if (atrRatio < 0.1) return 'high';
  return 'extreme';
}

function getDirectionalDistance(entryPrice: number, targetPrice: number, direction: 'long' | 'short') {
  return direction === 'short' ? entryPrice - targetPrice : targetPrice - entryPrice;
}

function getRiskReward(
  entryPrice: number | null,
  stopLoss: number | null,
  targetPrice: number | null,
  direction: 'long' | 'short',
) {
  if (!isFiniteNumber(entryPrice) || !isFiniteNumber(stopLoss) || !isFiniteNumber(targetPrice)) return null;
  const risk = direction === 'short' ? stopLoss - entryPrice : entryPrice - stopLoss;
  const reward = getDirectionalDistance(entryPrice, targetPrice, direction);
  if (risk <= 0 || reward <= 0) return null;
  return reward / risk;
}

function toValidationCandle(candle: FuturesKlineCandle): CoinValidationSnapshotCandle {
  return {
    close: candle.close,
    close_time: candle.closeTime,
    high: candle.high,
    low: candle.low,
    open: candle.open,
    open_time: candle.openTime,
    quote_asset_volume:
      candle.quoteAssetVolume ??
      (isFiniteNumber(candle.close) && isFiniteNumber(candle.volume) ? candle.close * candle.volume : undefined),
    volume: candle.volume,
  };
}

function buildTimeframeSnapshot(params: {
  candles: FuturesKlineCandle[];
  limit: number;
  supportResistance: CoinTimeframeSupportResistance | null;
}): CoinValidationSnapshotTimeframe {
  const { candles, limit, supportResistance } = params;
  const trend = analyzeTrend(candles, supportResistance?.supportResistance ?? null);
  const slicedCandles = candles.slice(-limit).map(toValidationCandle);
  const currentPrice = trend.endPrice ?? slicedCandles[slicedCandles.length - 1]?.close ?? null;
  const support = supportResistance?.supportResistance?.support ?? null;
  const resistance = supportResistance?.supportResistance?.resistance ?? null;
  const distanceToSupport =
    isFiniteNumber(currentPrice) && isFiniteNumber(support) ? Math.abs(currentPrice - support) : null;
  const distanceToResistance =
    isFiniteNumber(currentPrice) && isFiniteNumber(resistance) ? Math.abs(resistance - currentPrice) : null;
  const emaValues = [trend.ema20, trend.ema50, trend.ema100, trend.ema200].filter(isFiniteNumber);
  const allAboveEma =
    emaValues.length > 0 && emaValues.every((ema) => isFiniteNumber(currentPrice) && currentPrice > ema);
  const allBelowEma =
    emaValues.length > 0 && emaValues.every((ema) => isFiniteNumber(currentPrice) && currentPrice < ema);

  return {
    atr14: trend.atr14,
    candles: slicedCandles,
    current_price: currentPrice,
    distance_to_resistance: distanceToResistance,
    distance_to_support: distanceToSupport,
    ema100: trend.ema100,
    ema20: trend.ema20,
    ema200: trend.ema200,
    ema50: trend.ema50,
    ema_alignment: allAboveEma ? 'bullish' : allBelowEma ? 'bearish' : 'neutral',
    resistance,
    rsi14: trend.rsi14,
    structure_state:
      trend.structurePattern === 'HH/HL' ? 'HH_HL' : trend.structurePattern === 'LH/LL' ? 'LH_LL' : 'Mixed',
    support,
    trend_state: trend.direction,
  };
}

function buildSetupCandidate(params: {
  consensusSetup: CoinSetupDetail;
  currentContextSupportResistance: CoinTimeframeSupportResistance | null;
  currentPrice: number | null;
}): CoinValidationSnapshotSetupCandidate {
  const { consensusSetup, currentContextSupportResistance, currentPrice } = params;
  const direction = consensusSetup.direction;
  const entryLow = consensusSetup.entryZone.low ?? consensusSetup.entryZone.high ?? null;
  const entryHigh = consensusSetup.entryZone.high ?? consensusSetup.entryZone.low ?? null;
  const plannedEntry = direction === 'long' ? entryLow : entryHigh;
  const stopLoss = consensusSetup.stopLoss;
  const tp1 = consensusSetup.takeProfits[0]?.price ?? null;
  const tp2 = consensusSetup.takeProfits[1]?.price ?? null;
  const currentSupport = currentContextSupportResistance?.supportResistance?.support ?? null;
  const currentResistance = currentContextSupportResistance?.supportResistance?.resistance ?? null;

  return {
    direction,
    distance_to_resistance:
      isFiniteNumber(currentPrice) && isFiniteNumber(currentResistance)
        ? Math.abs(currentResistance - currentPrice)
        : null,
    distance_to_support:
      isFiniteNumber(currentPrice) && isFiniteNumber(currentSupport) ? Math.abs(currentPrice - currentSupport) : null,
    entry_zone: [entryLow, entryHigh] as [number, number],
    planned_entry: plannedEntry as number,
    risk_reward: {
      tp1: getRiskReward(plannedEntry, stopLoss, tp1, direction),
      tp2: getRiskReward(plannedEntry, stopLoss, tp2, direction),
    },
    setup_type:
      consensusSetup.pathMode === 'breakout'
        ? direction === 'long'
          ? 'breakout_retest'
          : 'breakdown_retest'
        : 'continuation',
    sl_distance:
      isFiniteNumber(plannedEntry) && isFiniteNumber(stopLoss) ? Math.abs(plannedEntry - stopLoss) : null,
    stop_loss: stopLoss,
    take_profit: { tp1, tp2 },
    tp_distance: {
      tp1: isFiniteNumber(plannedEntry) && isFiniteNumber(tp1) ? Math.abs(tp1 - plannedEntry) : null,
      tp2: isFiniteNumber(plannedEntry) && isFiniteNumber(tp2) ? Math.abs(tp2 - plannedEntry) : null,
    },
  };
}

function hasNullishValue(value: unknown, visited = new Set<object>()): boolean {
  if (value === null || value === undefined) return true;
  if (typeof value !== 'object') return false;
  if (visited.has(value as object)) return false;
  visited.add(value as object);
  if (Array.isArray(value)) return value.some((item) => hasNullishValue(item, visited));
  return Object.values(value).some((item) => hasNullishValue(item, visited));
}

function isTimeframeConsistent(timeframe: CoinValidationSnapshotTimeframe, expectedLength: number) {
  if (timeframe.candles.length !== expectedLength) return false;
  if (
    !timeframe.candles.every(
      (candle, index, array) => index === 0 || Number(candle.open_time) >= Number(array[index - 1]?.open_time),
    )
  )
    return false;
  return timeframe.candles.every(
    (candle) =>
      candle.high >= candle.open &&
      candle.high >= candle.close &&
      candle.low <= candle.open &&
      candle.low <= candle.close &&
      candle.volume >= 0 &&
      Number(candle.close_time) >= Number(candle.open_time),
  );
}

export function buildCoinValidationSnapshot(input: BuildCoinValidationSnapshotInput): CoinValidationSnapshot | null {
  const currentTime = new Date();
  const currentTrend = input.currentTrend;
  const currentContextSupportResistance =
    input.timeframeSupportResistance.find((item) => item.interval === '15m') ?? null;
  const consensusSetup = input.consensusSetup;

  if (!consensusSetup && !input.setupCandidateOverride) {
    return null;
  }

  const timeframes = {
    '1m': buildTimeframeSnapshot({
      candles: input.timeframeSources['1m'] ?? [],
      limit: SNAPSHOT_CANDLE_LIMITS['1m'],
      supportResistance: input.timeframeSupportResistance.find((item) => item.interval === '1m') ?? null,
    }),
    '15m': buildTimeframeSnapshot({
      candles: input.timeframeSources['15m'] ?? [],
      limit: SNAPSHOT_CANDLE_LIMITS['15m'],
      supportResistance: input.timeframeSupportResistance.find((item) => item.interval === '15m') ?? null,
    }),
    '1h': buildTimeframeSnapshot({
      candles: input.timeframeSources['1h'] ?? [],
      limit: SNAPSHOT_CANDLE_LIMITS['1h'],
      supportResistance: input.timeframeSupportResistance.find((item) => item.interval === '1h') ?? null,
    }),
    '4h': buildTimeframeSnapshot({
      candles: input.timeframeSources['4h'] ?? [],
      limit: SNAPSHOT_CANDLE_LIMITS['4h'],
      supportResistance: input.timeframeSupportResistance.find((item) => item.interval === '4h') ?? null,
    }),
  } satisfies Record<'1m' | '15m' | '1h' | '4h', CoinValidationSnapshotTimeframe>;

  const setupCandidate =
    input.setupCandidateOverride ??
    buildSetupCandidate({
      consensusSetup: consensusSetup!,
      currentContextSupportResistance,
      currentPrice: input.currentPrice,
    });

  const snapshotWithoutQuality = {
    account_size: input.accountSize,
    current_context: {
      price: input.currentPrice,
      session: getSession(currentTime),
      trend: currentTrend.direction,
      volatility_state: getVolatilityState(input.currentPrice, currentTrend.atr14),
    },
    current_trend: currentTrend,
    exchange: 'binance' as const,
    generated_at: currentTime.toISOString(),
    is_perpetual: input.isPerpetual,
    leverage: input.leverage,
    market_type: 'futures' as const,
    risk_config: {
      account_size: input.accountSize,
      leverage: input.leverage,
      risk_percent: 1,
    },
    setup_candidate: setupCandidate,
    setup_id: `${input.symbol}-${getDateId(currentTime)}-001`,
    symbol: input.symbol,
    timeframe_roles: TIMEFRAME_ROLES,
    timeframes,
    validation_rules: VALIDATION_RULES,
  };

  const dataQuality = {
    candle_consistency: Object.entries(timeframes).every(([interval, timeframe]) =>
      isTimeframeConsistent(timeframe, SNAPSHOT_CANDLE_LIMITS[interval as keyof typeof SNAPSHOT_CANDLE_LIMITS]),
    ),
    has_null_values: hasNullishValue(snapshotWithoutQuality),
    indicator_validity:
      isFiniteNumber(snapshotWithoutQuality.current_context.price) &&
      isFiniteNumber(snapshotWithoutQuality.risk_config.account_size) &&
      isFiniteNumber(snapshotWithoutQuality.risk_config.leverage) &&
      Object.values(timeframes).every(
        (timeframe) =>
          isFiniteNumber(timeframe.current_price) &&
          isFiniteNumber(timeframe.atr14) &&
          isFiniteNumber(timeframe.ema20) &&
          isFiniteNumber(timeframe.ema50) &&
          isFiniteNumber(timeframe.ema100) &&
          isFiniteNumber(timeframe.ema200) &&
          isFiniteNumber(timeframe.rsi14),
      ) &&
      isFiniteNumber(setupCandidate.planned_entry) &&
      isFiniteNumber(setupCandidate.stop_loss) &&
      isFiniteNumber(setupCandidate.take_profit.tp1) &&
      isFiniteNumber(setupCandidate.take_profit.tp2),
    is_complete:
      !hasNullishValue(snapshotWithoutQuality) &&
      Object.entries(timeframes).every(([interval, timeframe]) =>
        isTimeframeConsistent(timeframe, SNAPSHOT_CANDLE_LIMITS[interval as keyof typeof SNAPSHOT_CANDLE_LIMITS]),
      ) &&
      isFiniteNumber(snapshotWithoutQuality.current_context.price) &&
      isFiniteNumber(snapshotWithoutQuality.risk_config.account_size) &&
      isFiniteNumber(snapshotWithoutQuality.risk_config.leverage) &&
      isFiniteNumber(setupCandidate.planned_entry) &&
      isFiniteNumber(setupCandidate.stop_loss) &&
      isFiniteNumber(setupCandidate.take_profit.tp1) &&
      isFiniteNumber(setupCandidate.take_profit.tp2) &&
      setupCandidate.entry_zone.every(isFiniteNumber),
  };

  return {
    ...snapshotWithoutQuality,
    data_quality: dataQuality,
  };
}
