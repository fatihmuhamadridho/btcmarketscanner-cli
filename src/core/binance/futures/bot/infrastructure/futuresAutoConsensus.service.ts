import { FuturesMarketController } from '../../market/domain/futuresMarket.controller';
import type { FuturesKlineCandle } from '../../market/domain/futuresMarket.model';
import { analyzeSetupSide, analyzeTrend, getSupportResistance as buildSupportResistance } from 'btcmarketscanner-core';
import { formatDecimalString } from '@utils/format-number.util';
import type { CoinAutoBotTimeframeSummary } from '@features/coin/interface/CoinView.interface';
import type { SetupCandle, SupportResistance, TrendInsight } from 'btcmarketscanner-core';
import type { CoinSetupDetail } from '@features/coin/interface/CoinView.interface';

type ExecutionTimeframe = '1m' | '5m' | '15m' | '30m' | '1h' | '4h';
const executionTimeframes: ExecutionTimeframe[] = ['1m', '5m', '15m', '30m', '1h', '4h'];
const INDICATOR_LOOKBACK_LIMIT = 300;
const timeframePriority: Record<ExecutionTimeframe, number> = {
  '1m': 1,
  '5m': 2,
  '15m': 3,
  '30m': 4,
  '1h': 5,
  '4h': 6,
};
const futuresMarketController = new FuturesMarketController();

export type FuturesAutoConsensusTimeframeSnapshot = {
  candles: FuturesKlineCandle[];
  interval: ExecutionTimeframe;
  longSetup: CoinSetupDetail;
  setup: CoinSetupDetail;
  shortSetup: CoinSetupDetail;
  supportResistance: SupportResistance | null;
  trend: TrendInsight;
};

function formatPrice(value: number | null) {
  return value === null ? 'n/a' : formatDecimalString(value.toFixed(2));
}
function buildSummary(
  interval: ExecutionTimeframe,
  trend: TrendInsight,
  setup: CoinSetupDetail,
): CoinAutoBotTimeframeSummary {
  return {
    direction: setup.direction,
    atrLabel: setup.atr14 !== null ? formatPrice(setup.atr14) : 'n/a',
    ema20Label: trend.ema20 !== null ? formatPrice(trend.ema20) : 'n/a',
    ema50Label: trend.ema50 !== null ? formatPrice(trend.ema50) : 'n/a',
    ema100Label: trend.ema100 !== null ? formatPrice(trend.ema100) : 'n/a',
    ema200Label: trend.ema200 !== null ? formatPrice(trend.ema200) : 'n/a',
    entryZoneLabel: `${formatPrice(setup.entryZone.low)} - ${formatPrice(setup.entryZone.high)}`,
    interval,
    isConsensus: false,
    marketConditionLabel: setup.marketCondition,
    rsiLabel: setup.rsi14 !== null ? setup.rsi14.toFixed(2) : 'n/a',
    riskRewardLabel: setup.riskReward !== null ? `1:${setup.riskReward.toFixed(2)}` : 'n/a',
    setupGrade: setup.grade,
    setupLabel: setup.label,
    stopLossLabel: formatPrice(setup.stopLoss),
    takeProfitLabels: setup.takeProfits.map((takeProfit) => ({
      label: takeProfit.label,
      valueLabel: formatPrice(takeProfit.price),
    })),
    trendColor: trend.color,
    trendLabel: trend.label,
  };
}

export class FuturesAutoConsensusService {
  async buildConsensus(symbol: string) {
    const snapshots = await Promise.all(
      executionTimeframes.map(async (interval) => {
        const candlesResponse = await futuresMarketController.getMarketInitialCandles(
          symbol,
          interval,
          INDICATOR_LOOKBACK_LIMIT,
        );
        const candles = candlesResponse.data.map((candle) => ({
          openTime: candle.openTime,
          open: candle.open,
          high: candle.high,
          low: candle.low,
          close: candle.close,
          volume: candle.volume,
          closeTime: candle.closeTime,
        }));
        const supportResistance = buildSupportResistance(candles, Math.min(50, candles.length));
        const trend = analyzeTrend(candles, supportResistance);
        const longSetup = analyzeSetupSide('long', candles, trend, supportResistance);
        const shortSetup = analyzeSetupSide('short', candles, trend, supportResistance);

        // CRITICAL: Select setup objectively - NOT biased toward long
        // If gradeRank differs: pick the better one
        // If equal gradeRank: pick based on risk/reward, NOT hardcoded long
        let setup: typeof longSetup;
        if (longSetup.gradeRank > shortSetup.gradeRank) {
          setup = longSetup;
        } else if (shortSetup.gradeRank > longSetup.gradeRank) {
          setup = shortSetup;
        } else {
          // Equal gradeRank - pick based on better risk/reward
          const longRR = longSetup.riskReward ?? 0;
          const shortRR = shortSetup.riskReward ?? 0;
          setup = longRR >= shortRR ? longSetup : shortSetup;
          console.log(
            `[consensus] Equal gradeRank (${longSetup.gradeRank}) - picked ${setup.direction} based on RR: Long=${longRR?.toFixed(2)}, Short=${shortRR?.toFixed(2)}`,
          );
        }
        return { candles, interval, longSetup, shortSetup, setup, trend, supportResistance };
      }),
    );
    const summaries = snapshots.map((snapshot) => buildSummary(snapshot.interval, snapshot.trend, snapshot.setup));
    const consensusSnapshot = [...snapshots].sort(
      (left, right) =>
        right.setup.gradeRank - left.setup.gradeRank ||
        timeframePriority[right.interval] - timeframePriority[left.interval],
    )[0];
    const executionConsensusLabel = consensusSnapshot?.setup.label ?? 'Consensus setup';
    const consensusSetup = consensusSnapshot?.setup ?? snapshots[0]?.setup ?? null;
    if (consensusSnapshot) {
      const consensusIndex = summaries.findIndex((item) => item.interval === consensusSnapshot.interval);
      if (consensusIndex >= 0) summaries[consensusIndex] = { ...summaries[consensusIndex], isConsensus: true };
    }
    return {
      consensusSetup,
      executionBasisLabel: executionTimeframes.join(' • ').replace('1h', '1H').replace('4h', '4H'),
      executionConsensusLabel,
      summaries,
      snapshots,
    };
  }
}

export const futuresAutoConsensusService = new FuturesAutoConsensusService();
