import React from 'react';
import { Box, Text } from 'ink';
import { Badge } from '@components/atoms/Badge.atom';
import { Panel } from '@components/molecules/Panel.molecule';
import type { MarketMode, MarketSnapshot, MarketSnapshotView, LiveMarketState } from '@interfaces/market.interface';

function pct(value: number | null) {
  if (value === null || Number.isNaN(value)) return 'n/a';
  const sign = value > 0 ? '+' : '';
  return `${sign}${value.toFixed(2)}%`;
}

function price(value: number | null) {
  if (value === null || Number.isNaN(value)) return 'n/a';

  const absoluteValue = Math.abs(value);
  const decimals =
    absoluteValue >= 1000 ? 2 :
    absoluteValue >= 100 ? 3 :
    absoluteValue >= 1 ? 4 :
    absoluteValue >= 0.1 ? 5 :
    absoluteValue >= 0.01 ? 6 :
    absoluteValue >= 0.001 ? 8 :
    10;

  return value.toLocaleString('en-US', {
    minimumFractionDigits: 0,
    maximumFractionDigits: decimals,
  });
}

function tone(direction: string) {
  if (direction === 'bullish' || direction === 'long') return '#50fa7b';
  if (direction === 'bearish' || direction === 'short') return '#ff6b6b';
  return '#c9d1d9';
}

function numberTone(value: number | null, fallback = '#f8f8f2') {
  if (value === null || Number.isNaN(value)) return '#8b949e';
  if (value > 0) return '#50fa7b';
  if (value < 0) return '#ff6b6b';
  return fallback;
}

function renderList(items: Array<string | null | undefined>, fallback: string) {
  const text = items.filter(Boolean).join(' • ');
  return text.length > 0 ? text : fallback;
}

function compact(value: string) {
  return value.length > 26 ? `${value.slice(0, 23)}...` : value;
}

function line(label: string, value: React.ReactNode, labelWidth = 18) {
  return (
    <Box flexDirection="row">
      <Box width={labelWidth} marginRight={1} flexShrink={0}>
        <Text color="#8b949e" bold>
          {label}
        </Text>
      </Box>
      <Box flexGrow={1} flexShrink={1}>
        <Text color="#f8f8f2">{value}</Text>
      </Box>
    </Box>
  );
}

function ema(candles: Array<{ close: number }>, period: number) {
  if (candles.length < period) return null;
  const closes = candles.map((candle) => candle.close);
  const seedWindow = closes.slice(0, period);
  let value = seedWindow.reduce((sum, close) => sum + close, 0) / period;
  const multiplier = 2 / (period + 1);

  for (let index = period; index < closes.length; index += 1) {
    value = (closes[index] - value) * multiplier + value;
  }

  return value;
}

export function TradingDashboard({
  snapshot,
  mode,
  tick,
  autoTrade,
  liveState,
  view,
  panelWidth,
}: {
  snapshot: MarketSnapshot;
  mode: MarketMode;
  tick: number;
  autoTrade: boolean;
  liveState: LiveMarketState;
  view: MarketSnapshotView;
  panelWidth: number;
}) {
  const marketCandles = liveState.initialCandles.length
    ? liveState.initialCandles
    : liveState.symbolDetail?.data.candles.length
      ? liveState.symbolDetail.data.candles
      : snapshot.candles;
  const lastPrice = marketCandles.at(-1)?.close ?? null;
  const highPrice = marketCandles.reduce((max, candle) => Math.max(max, candle.high), Number.NEGATIVE_INFINITY);
  const lowPrice = marketCandles.reduce((min, candle) => Math.min(min, candle.low), Number.POSITIVE_INFINITY);
  const openPrice = snapshot.trend.startPrice ?? marketCandles.at(0)?.close ?? null;
  const change = snapshot.trend.changePercent;
  const trendColor = tone(snapshot.trend.direction);
  const setupColor = tone(snapshot.setup.direction);
  const botStateLabel = liveState.bot?.status ?? 'idle';
  const openOrderCount = liveState.openOrders ? liveState.openOrders[0].length + liveState.openOrders[1].length : 0;
  const openPositionCount = liveState.openPositions?.filter((position) => Math.abs(Number(position.positionAmt ?? 0)) > 0).length ?? 0;
  const support = snapshot.supportResistance?.support ?? null;
  const resistance = snapshot.supportResistance?.resistance ?? null;
  const rangeValue = Number.isFinite(highPrice) && Number.isFinite(lowPrice) ? highPrice - lowPrice : null;
  const watchMode = view === 'overview' || view === 'market';
  const emaCandles = marketCandles;
  const ema20 = snapshot.trend.ema20 ?? ema(emaCandles, 20);
  const ema50 = snapshot.trend.ema50 ?? ema(emaCandles, 50);
  const ema100 = snapshot.trend.ema100 ?? ema(emaCandles, 100);
  const ema200 = snapshot.trend.ema200 ?? ema(emaCandles, 200);

  return (
    <Box flexDirection="column">
      <Box flexDirection="column">
        <Panel title="Market" width={panelWidth}>
          {line(
            'pair',
            <>
              <Badge label={snapshot.trend.label.toUpperCase()} color={trendColor} /> <Text dimColor>{snapshot.pair}</Text>
            </>,
            6
          )}
          {line(
            'ohlc',
            <>
              o <Text color="#f8f8f2">{price(openPrice)}</Text> h{' '}
              <Text color="#f8f8f2">{price(Number.isFinite(highPrice) ? highPrice : null)}</Text> l{' '}
              <Text color="#f8f8f2">{price(Number.isFinite(lowPrice) ? lowPrice : null)}</Text> c{' '}
              <Text color={numberTone(change)}>{price(lastPrice)}</Text>
            </>,
            6
          )}
          {line('bars', <Text color="#8be9fd">{marketCandles.length}</Text>, 6)}
          {line(
            'now',
            <>
              cur <Text color={numberTone(liveState.currentPrice ?? lastPrice)}>{price(liveState.currentPrice ?? lastPrice)}</Text> chg{' '}
              <Text color={numberTone(change)}>{pct(change)}</Text> rng <Text color="#f8f8f2">{price(rangeValue)}</Text> rsi{' '}
              <Text color={snapshot.trend.rsi14 !== null ? '#f1fa8c' : '#8b949e'}>{price(snapshot.trend.rsi14)}</Text>
            </>,
            6
          )}
          {line(
            'ema',
            <>
              20 <Text color="#8be9fd">{price(ema20)}</Text> 50 <Text color="#8be9fd">{price(ema50)}</Text> 100{' '}
              <Text color="#8be9fd">{price(ema100)}</Text> 200 <Text color="#8be9fd">{price(ema200)}</Text>
            </>,
            6
          )}
          {line(
            'hl',
            <>
              atr <Text color="#f1fa8c">{price(snapshot.trend.atr14)}</Text> sup <Text color="#50fa7b">{price(support)}</Text> res{' '}
              <Text color="#ff6b6b">{price(resistance)}</Text>
            </>,
            6
          )}
        </Panel>

        {watchMode ? (
          <Box marginTop={0}>
            <Panel title="Status" width={panelWidth}>
              {line('view', <Text color="#8be9fd">{`${mode.toUpperCase()} ${view.toUpperCase()}`}</Text>, 14)}
              {line('auto-trade', <Text color={autoTrade ? '#50fa7b' : '#ff6b6b'}>{autoTrade ? 'on' : 'off'}</Text>, 14)}
              {line('bot-state', <Text color={botStateLabel === 'idle' ? '#c9d1d9' : '#8be9fd'}>{botStateLabel}</Text>, 14)}
              {line('open-orders', <Text color="#f1fa8c">{openOrderCount}</Text>, 14)}
              {line('open-positions', <Text color="#f1fa8c">{openPositionCount}</Text>, 14)}
            </Panel>
          </Box>
        ) : (
          <>
            <Box marginTop={1}>
              <Panel title="Setup" width={panelWidth}>
                {line(
                  'bias',
                  <>
                    <Badge label={snapshot.setup.label.toUpperCase()} color={setupColor} /> <Text dimColor>{snapshot.setup.grade}</Text>
                  </>,
                  6
                )}
                {line(
                  'zone',
                  <>
                    entry <Text color="#50fa7b">{price(snapshot.setup.entryMid)}</Text> stop <Text color="#ff6b6b">{price(snapshot.setup.stopLoss)}</Text> tp{' '}
                    <Text color="#f1fa8c">{price(snapshot.setup.takeProfit)}</Text>
                  </>,
                  6
                )}
                {line(
                  'risk',
                  <>
                    r/r{' '}
                    <Text color={snapshot.setup.riskReward !== null ? '#f1fa8c' : '#8b949e'}>
                      {snapshot.setup.riskReward !== null ? `1:${snapshot.setup.riskReward.toFixed(2)}` : 'n/a'}
                    </Text>{' '}
                    mode <Text color="#8be9fd">{snapshot.setup.pathMode}</Text>
                  </>,
                  6
                )}
                {line('path', compact(snapshot.setup.path.map((step) => `${step.label}:${step.status}`).join(' / ')), 6)}
              </Panel>
            </Box>

            <Box marginTop={1}>
              <Panel title="Exec" width={panelWidth}>
                {line('mode', <Text color="#8be9fd">{mode.toUpperCase()}</Text>, 14)}
                {line('auto', <Text color={autoTrade ? '#50fa7b' : '#ff6b6b'}>{autoTrade ? 'on' : 'off'}</Text>, 14)}
                {line('view', <Text color="#8be9fd">{view.toUpperCase()}</Text>, 14)}
                {line('bot', <Text color={botStateLabel === 'idle' ? '#c9d1d9' : '#8be9fd'}>{botStateLabel}</Text>, 14)}
                {line('ord', <Text color="#f1fa8c">{openOrderCount} open</Text>, 14)}
                {line('pos', <Text color="#f1fa8c">{openPositionCount} open</Text>, 14)}
              </Panel>
            </Box>

            <Box marginTop={1}>
              <Panel title="Core" width={panelWidth}>
                {line(
                  'exch',
                  liveState.exchangeInfoSummary
                    ? <>
                        sym <Text color="#8be9fd">{liveState.exchangeInfoSummary.tradingSymbolCount}</Text>/<Text color="#8be9fd">{liveState.exchangeInfoSummary.symbolCount}</Text> perp{' '}
                        <Text color="#8be9fd">{liveState.exchangeInfoSummary.perpetualSymbolCount}</Text>
                      </>
                    : 'exchange unavailable'
                )}
                {line('watch', <Text color="#f8f8f2">{renderList(liveState.overview?.data.slice(0, 3).map((item) => item.symbol) ?? [], 'overview unavailable')}</Text>)}
                {line(
                  'candles',
                  liveState.symbolDetail?.data.candles.length
                    ? <>
                        <Text color="#8be9fd">{liveState.symbolDetail.data.candles.length}</Text> bars current{' '}
                        <Text color={numberTone(liveState.currentPrice)}>{price(liveState.currentPrice)}</Text>
                      </>
                    : 'candles unavailable'
                )}
              </Panel>
            </Box>

            <Box marginTop={1}>
              <Panel title="Bot / Orders" width={panelWidth}>
                {line('bot', liveState.bot ? `${liveState.bot.status} ${liveState.bot.planSource ?? 'n/a'}` : 'idle')}
                {line('log', liveState.botLogs.at(-1)?.message ?? 'no bot log yet')}
                {line(
                  'orders',
                  liveState.openOrders ? (
                    <>
                      <Text color="#8be9fd">{liveState.openOrders[0].length}</Text> reg / <Text color="#8be9fd">{liveState.openOrders[1].length}</Text> algo
                    </>
                  ) : (
                    'orders unavailable'
                  )
                )}
                {line(
                  'pos',
                  liveState.openPositions?.length ? (
                    <>
                      <Text color="#8be9fd">{liveState.openPositions.slice(0, 2).map((position) => `${position.symbol}:${position.positionSide}`).join(' • ')}</Text>
                    </>
                  ) : (
                    'no positions'
                  )
                )}
                {line(
                  'pnl',
                  liveState.realizedPnlHistory?.length ? (
                    <>
                      <Text color="#8be9fd">
                        {liveState.realizedPnlHistory.slice(0, 2).map((item) => `${item.symbol}:${price(item.income)}`).join(' • ')}
                      </Text>
                    </>
                  ) : (
                    'no pnl history'
                  )
                )}
              </Panel>
            </Box>
          </>
        )}
      </Box>
    </Box>
  );
}
