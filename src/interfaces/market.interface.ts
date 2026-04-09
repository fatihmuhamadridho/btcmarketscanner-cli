import type { SetupCandle, SupportResistance, TrendInsight } from 'btcmarketscanner-core';

export type MarketMode = 'scalp' | 'swing' | 'position';

export type MarketSnapshot = {
  candles: SetupCandle[];
  pair: string;
  interval: string;
  mode: MarketMode;
  supportResistance: SupportResistance | null;
  trend: TrendInsight;
  setup: {
    direction: 'long' | 'short';
    entryMid: number | null;
    entryZone: { high: number | null; low: number | null };
    grade: 'A+' | 'A' | 'B' | 'C';
    gradeRank: number;
    label: string;
    marketCondition: string;
    pathMode: 'breakout' | 'continuation';
    path: Array<{ label: string; status: 'done' | 'current' | 'pending' }>;
    atr14: number | null;
    rsi14: number | null;
    takeProfits: Array<{ label: 'TP1' | 'TP2' | 'TP3'; price: number | null }>;
    reasons: string[];
    riskReward: number | null;
    stopLoss: number | null;
    takeProfit: number | null;
  };
};
