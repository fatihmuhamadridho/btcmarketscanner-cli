export type CoinValidationSnapshotTimeframeRole = 'setup_main' | 'bias_primary' | 'macro_soft' | 'trigger';

export type CoinValidationSnapshotCandle = {
  close: number;
  close_time?: number;
  high: number;
  low: number;
  number_of_trades?: number;
  open: number;
  open_time: number;
  quote_asset_volume?: number;
  volume: number;
};

export type CoinValidationSnapshotTimeframe = {
  atr14: number | null;
  candles: CoinValidationSnapshotCandle[];
  current_price: number | null;
  distance_to_resistance: number | null;
  distance_to_support: number | null;
  ema100: number | null;
  ema20: number | null;
  ema200: number | null;
  ema50: number | null;
  ema_alignment: 'bullish' | 'bearish' | 'neutral';
  resistance: number | null;
  rsi14: number | null;
  structure_state: string;
  support: number | null;
  trend_state: string;
};

export type CoinValidationSnapshotSetupCandidate = {
  direction: 'long' | 'short';
  distance_to_resistance: number | null;
  distance_to_support: number | null;
  entry_zone: [number, number];
  planned_entry: number;
  risk_reward: { tp1: number | null; tp2: number | null };
  setup_type: 'breakout_retest' | 'breakdown_retest' | 'continuation';
  sl_distance: number | null;
  stop_loss: number | null;
  take_profit: { tp1: number | null; tp2: number | null };
  tp_distance: { tp1: number | null; tp2: number | null };
};

export type CoinValidationSnapshot = {
  account_size: number | null;
  current_context: {
    price: number | null;
    session: 'asia' | 'europe' | 'us' | 'overlap';
    trend: string;
    volatility_state: 'low' | 'normal' | 'high' | 'extreme';
  };
  current_trend: unknown;
  data_quality: {
    candle_consistency: boolean;
    has_null_values: boolean;
    indicator_validity: boolean;
    is_complete: boolean;
  };
  exchange: 'binance';
  generated_at: string;
  is_perpetual: boolean;
  leverage: number;
  market_type: 'futures';
  risk_config: {
    account_size: number | null;
    leverage: number;
    risk_percent: number;
  };
  setup_candidate: CoinValidationSnapshotSetupCandidate | null;
  setup_id: string;
  symbol: string;
  timeframe_roles: Record<'4h' | '1h' | '15m' | '1m', CoinValidationSnapshotTimeframeRole>;
  timeframes: Record<'4h' | '1h' | '15m' | '1m', CoinValidationSnapshotTimeframe>;
  validation_rules: {
    min_rr: number;
    max_distance_to_resistance_atr_multiple: number;
    min_sl_atr_multiple: number;
    min_tp1_atr_multiple: number;
    require_htf_trend_alignment: boolean;
  };
};
