import type { FuturesAutoBotLogEntry, FuturesAutoBotState } from '@core/binance/futures/bot/domain/futuresAutoBot.model';
import type { FuturesExchangeInfoSummary } from '@core/binance/futures/exchange-info/domain/futuresExchangeInfo.model';
import type { FuturesKlineCandle, FuturesMarketOverviewItem, FuturesMarketSymbolDetail, FuturesMarketSymbolSnapshot } from '@core/binance/futures/market/domain/futuresMarket.model';
import type { SetupCandle, SupportResistance, TrendInsight } from 'btcmarketscanner-core';

export type MarketMode = 'scalp' | 'swing' | 'position';
export type MarketSnapshotView = 'overview' | 'market' | 'bot' | 'orders' | 'history';

export type LiveMarketState = {
  exchangeInfoSummary: FuturesExchangeInfoSummary | null;
  overview: Awaited<ReturnType<import('@core/binance/futures/market/domain/futuresMarket.controller').FuturesMarketController['getMarketOverview']>> | null;
  symbolSnapshot: Awaited<ReturnType<import('@core/binance/futures/market/domain/futuresMarket.controller').FuturesMarketController['getMarketSymbolSnapshot']>> | null;
  symbolDetail: Awaited<ReturnType<import('@core/binance/futures/market/domain/futuresMarket.controller').FuturesMarketController['getMarketSymbolDetail']>> | null;
  initialCandles: FuturesKlineCandle[];
  bot: FuturesAutoBotState | null;
  botLogs: FuturesAutoBotLogEntry[];
  openOrders: Awaited<ReturnType<import('@core/binance/futures/bot/infrastructure/futuresAutoTrade.service').FuturesAutoTradeService['getOpenOrders']>> | null;
  openPositions: Awaited<ReturnType<import('@core/binance/futures/bot/infrastructure/futuresAutoTrade.service').FuturesAutoTradeService['getOpenPositions']>> | null;
  realizedPnlHistory: Awaited<ReturnType<import('@core/binance/futures/bot/infrastructure/futuresAutoTrade.service').FuturesAutoTradeService['getRealizedPnlHistory']>> | null;
  currentPrice: number | null;
  loading: boolean;
  error: string | null;
  lastUpdatedAt: string | null;
  websocketConnected: boolean;
  websocketError: string | null;
  websocketLastEventAt: string | null;
};

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
