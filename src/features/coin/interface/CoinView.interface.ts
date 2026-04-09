export type CoinAutoBotStatus = 'idle' | 'watching' | 'entry_pending' | 'entry_placed' | 'stopped' | 'error';

export type CoinSetupDetail = {
  atr14: number | null;
  direction: 'long' | 'short';
  entryMid: number | null;
  entryZone: { high: number | null; low: number | null };
  grade: 'A+' | 'A' | 'B' | 'C';
  gradeRank: number;
  label: string;
  marketCondition: string;
  pathMode: 'breakout' | 'continuation';
  path: Array<{ label: string; status: 'done' | 'current' | 'pending' }>;
  reasons: string[];
  riskReward: number | null;
  rsi14: number | null;
  setupType?: 'breakout_retest' | 'breakdown_retest' | 'continuation';
  stopLoss: number | null;
  takeProfits: Array<{ label: 'TP1' | 'TP2' | 'TP3'; price: number | null }>;
  takeProfit: number | null;
};

export type CoinAutoBotTimeframeSummary = {
  direction: 'long' | 'short';
  atrLabel: string;
  ema20Label: string;
  ema50Label: string;
  ema100Label: string;
  ema200Label: string;
  entryZoneLabel: string;
  interval: '1m' | '5m' | '15m' | '30m' | '1h' | '4h';
  isConsensus: boolean;
  marketConditionLabel: string;
  rsiLabel: string;
  riskRewardLabel: string;
  setupGrade: 'A+' | 'A' | 'B' | 'C';
  setupLabel: string;
  stopLossLabel: string;
  takeProfitLabels: Array<{ label: 'TP1' | 'TP2' | 'TP3'; valueLabel: string }>;
  trendColor: string;
  trendLabel: string;
};
