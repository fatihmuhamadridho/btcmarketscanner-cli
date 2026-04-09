import type { CoinValidationSnapshot, CoinValidationSnapshotSetupCandidate } from '../interface/CoinValidationSnapshot.interface';
import type { CoinSetupDetail } from '../interface/CoinView.interface';

export function buildCoinValidationSnapshot(params: {
  accountSize: number | null;
  consensusSetup: CoinSetupDetail | null;
  setupCandidateOverride?: CoinValidationSnapshotSetupCandidate | null;
  currentPrice: number;
  currentTrend: {
    direction: string;
    atr14: number | null;
    ema20: number | null;
    ema50: number | null;
    ema100: number | null;
    ema200: number | null;
    label: string;
    structurePattern: string;
  };
  isPerpetual: boolean;
  leverage: number;
  symbol: string;
  timeframeSources: Record<'4h' | '1h' | '15m' | '1m', Array<{ open: number; high: number; low: number; close: number; volume: number; openTime: number; closeTime?: number }>>;
  timeframeSupportResistance: Array<{
    interval: '4h' | '1h' | '15m' | '1m';
    supportResistance: { support: number | null; resistance: number | null } | null;
    atr14: number | null;
    ema20: number | null;
    ema50: number | null;
    ema100: number | null;
    ema200: number | null;
    rsi14: number | null;
    trendDirection: string;
    trendLabel: string;
  }>;
}): CoinValidationSnapshot | null {
  const { accountSize, currentPrice, currentTrend, isPerpetual, leverage, symbol } = params;
  const setupCandidate = params.setupCandidateOverride ?? null;

  return {
    account_size: accountSize,
    current_context: {
      price: currentPrice,
      session: 'overlap',
      trend: currentTrend.direction,
      volatility_state: 'normal',
    },
    current_trend: currentTrend,
    data_quality: {
      candle_consistency: true,
      has_null_values: false,
      indicator_validity: true,
      is_complete: true,
    },
    exchange: 'binance',
    generated_at: new Date().toISOString(),
    is_perpetual: isPerpetual,
    leverage,
    market_type: 'futures',
    risk_config: {
      account_size: accountSize,
      leverage,
      risk_percent: 1,
    },
    setup_candidate: setupCandidate,
    setup_id: `${symbol}-${new Date().toISOString().slice(0, 10)}-001`,
    symbol,
    timeframe_roles: {
      '1m': 'trigger',
      '15m': 'setup_main',
      '1h': 'bias_primary',
      '4h': 'macro_soft',
    },
    timeframes: {
      '1m': { atr14: null, candles: [], current_price: null, distance_to_resistance: null, distance_to_support: null, ema100: null, ema20: null, ema200: null, ema50: null, ema_alignment: 'neutral', resistance: null, rsi14: null, structure_state: 'Mixed', support: null, trend_state: 'sideways' },
      '15m': { atr14: null, candles: [], current_price: null, distance_to_resistance: null, distance_to_support: null, ema100: null, ema20: null, ema200: null, ema50: null, ema_alignment: 'neutral', resistance: null, rsi14: null, structure_state: 'Mixed', support: null, trend_state: 'sideways' },
      '1h': { atr14: null, candles: [], current_price: null, distance_to_resistance: null, distance_to_support: null, ema100: null, ema20: null, ema200: null, ema50: null, ema_alignment: 'neutral', resistance: null, rsi14: null, structure_state: 'Mixed', support: null, trend_state: 'sideways' },
      '4h': { atr14: null, candles: [], current_price: null, distance_to_resistance: null, distance_to_support: null, ema100: null, ema20: null, ema200: null, ema50: null, ema_alignment: 'neutral', resistance: null, rsi14: null, structure_state: 'Mixed', support: null, trend_state: 'sideways' },
    },
    validation_rules: {
      min_rr: 2,
      max_distance_to_resistance_atr_multiple: 1,
      min_sl_atr_multiple: 0.8,
      min_tp1_atr_multiple: 1.5,
      require_htf_trend_alignment: true,
    },
  };
}
