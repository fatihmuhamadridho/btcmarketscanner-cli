import React from 'react';
import { Box, Text } from 'ink';
import { Badge } from '@components/atoms/Badge.atom';
import { SectionTitle } from '@components/atoms/SectionTitle.atom';
import { StatLine } from '@components/atoms/StatLine.atom';
import { Panel } from '@components/molecules/Panel.molecule';
import { TradeRow } from '@components/molecules/TradeRow.molecule';
import type { MarketMode, MarketSnapshot } from '@interfaces/market.interface';

function pct(value: number | null) {
  if (value === null || Number.isNaN(value)) return 'n/a';
  const sign = value > 0 ? '+' : '';
  return `${sign}${value.toFixed(2)}%`;
}

function price(value: number | null) {
  if (value === null || Number.isNaN(value)) return 'n/a';
  return value.toLocaleString('en-US', { maximumFractionDigits: 2 });
}

function tone(direction: string) {
  if (direction === 'bullish' || direction === 'long') return '#41d3a2';
  if (direction === 'bearish' || direction === 'short') return '#ff7b72';
  return '#8b949e';
}

export function TradingDashboard({
  snapshot,
  mode,
  tick,
  autoTrade,
}: {
  snapshot: MarketSnapshot;
  mode: MarketMode;
  tick: number;
  autoTrade: boolean;
}) {
  const lastPrice = snapshot.candles.at(-1)?.close ?? null;
  const change = snapshot.trend.changePercent;
  const trendColor = tone(snapshot.trend.direction);
  const setupColor = tone(snapshot.setup.direction);
  const stopDistance =
    snapshot.setup.stopLoss !== null && lastPrice !== null
      ? Math.abs(lastPrice - snapshot.setup.stopLoss)
      : null;
  const targetDistance =
    snapshot.setup.takeProfit !== null && lastPrice !== null
      ? Math.abs(snapshot.setup.takeProfit - lastPrice)
      : null;
  const riskReward =
    snapshot.setup.riskReward !== null
      ? `1:${snapshot.setup.riskReward.toFixed(2)}`
      : 'n/a';

  return (
    <Box flexDirection="column" paddingX={1}>
      <Box marginBottom={1} flexDirection="column">
        <Text>
          <Text color="#7ee7ff" bold>
            BTC Market Scanner
          </Text>{' '}
          <Text dimColor>trading desk</Text>
        </Text>
        <Text dimColor>
          {snapshot.pair} • {snapshot.interval} • mode {mode} • uptime {tick}s • auto{' '}
          {autoTrade ? 'on' : 'off'}
        </Text>
      </Box>

      <Box flexDirection="row">
        <Box flexDirection="column" width={27}>
          <Panel title="Market">
            <Box flexDirection="column">
              <Text>
                <Badge label={snapshot.trend.label.toUpperCase()} color={trendColor} />{' '}
                <Text dimColor>structure</Text>
              </Text>
              <Box marginTop={1}>
                <StatLine label="price" value={price(lastPrice)} />
                <StatLine label="24h" value={pct(change)} color={change >= 0 ? '#41d3a2' : '#ff7b72'} />
                <StatLine label="rsi14" value={price(snapshot.trend.rsi14)} />
                <StatLine label="atr14" value={price(snapshot.trend.atr14)} />
              </Box>
              <Box marginTop={1}>
                <Text dimColor>{snapshot.trend.reasons[0] ?? 'market is warming up'}</Text>
              </Box>
            </Box>
          </Panel>
        </Box>

        <Box width={1} />

        <Box flexDirection="column" width={30}>
          <Panel title="Setup">
            <Box flexDirection="column">
              <Text>
                <Badge label={snapshot.setup.label.toUpperCase()} color={setupColor} />{' '}
                <Text dimColor>bias</Text>
              </Text>
              <Box marginTop={1}>
                <StatLine label="grade" value={snapshot.setup.grade} />
                <StatLine label="entry" value={price(snapshot.setup.entryMid)} />
                <StatLine label="stop" value={price(snapshot.setup.stopLoss)} color="#ff7b72" />
                <StatLine label="target" value={price(snapshot.setup.takeProfit)} color="#41d3a2" />
                <StatLine label="r/r" value={riskReward} />
              </Box>
              <Box marginTop={1} flexDirection="column">
                <SectionTitle text="Path" />
                <Text dimColor>
                  {snapshot.setup.path.map((step) => `${step.label}:${step.status}`).join('  ')}
                </Text>
              </Box>
            </Box>
          </Panel>
        </Box>

        <Box width={1} />

        <Box flexDirection="column" width={24}>
          <Panel title="Execution">
            <TradeRow label="mode" value={mode.toUpperCase()} accent="#7ee7ff" />
            <TradeRow label="auto" value={autoTrade ? 'enabled' : 'disabled'} accent={autoTrade ? '#41d3a2' : '#8b949e'} />
            <TradeRow label="support" value={price(snapshot.supportResistance?.support ?? null)} />
            <TradeRow label="resistance" value={price(snapshot.supportResistance?.resistance ?? null)} />
            <TradeRow label="stop dist" value={price(stopDistance)} />
            <TradeRow label="target dist" value={price(targetDistance)} />
          </Panel>
        </Box>
      </Box>

      <Box marginTop={0} flexDirection="row">
        <Box flexDirection="column" width={40}>
          <Panel title="Trade Plan">
            <Box flexDirection="column">
              <SectionTitle text="Playbook" />
              <Text>
                <Text color="#8b949e">1.</Text> Break structure cleanly.
              </Text>
              <Text>
                <Text color="#8b949e">2.</Text> Wait for retest confirmation.
              </Text>
              <Text>
                <Text color="#8b949e">3.</Text> Scale out into liquidity.
              </Text>
              <Text>
                <Text color="#8b949e">4.</Text> Move stop to breakeven after TP1.
              </Text>

              <Box marginTop={1} flexDirection="column">
                <SectionTitle text="Targets" />
                {snapshot.setup.takeProfits.map((takeProfit) => (
                  <Text key={takeProfit.label}>
                    <Text color="#8b949e">{takeProfit.label}</Text>{' '}
                    <Text color="#f5f5f5">{price(takeProfit.price)}</Text>
                  </Text>
                ))}
              </Box>
            </Box>
          </Panel>
        </Box>

        <Box width={1} />

        <Box flexDirection="column" width={40}>
          <Panel title="Diagnostics">
            <Box flexDirection="column">
              <TradeRow label="uptime" value={`${tick}s`} />
              <TradeRow label="trend score" value={`${snapshot.trend.score}`} accent={trendColor} />
              <TradeRow label="bias" value={snapshot.setup.direction.toUpperCase()} accent={setupColor} />
              <TradeRow
                label="range"
                value={`${price(snapshot.supportResistance?.support ?? null)} - ${price(snapshot.supportResistance?.resistance ?? null)}`}
              />
            </Box>
          </Panel>
        </Box>
      </Box>
    </Box>
  );
}
