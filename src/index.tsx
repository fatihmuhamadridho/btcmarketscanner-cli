import React, { useEffect, useMemo, useState } from 'react';
import { Box, Text, render, useApp, useInput } from 'ink';
import { analyzeSetupSide, analyzeTrend, getSupportResistance } from 'btcmarketscanner-core';
import { CommandBar } from '@components/molecules/CommandBar.molecule';
import { CommandHistory } from '@components/molecules/CommandHistory.molecule';
import { CommandSuggestions } from '@components/molecules/CommandSuggestions.molecule';
import { HelpOverlay } from '@components/organisms/HelpOverlay.organism';
import { TradingDashboard } from '@components/organisms/TradingDashboard.organism';
import { futuresAutoBotService } from '@core/binance/futures/bot/infrastructure/futuresAutoBot.service';
import { futuresAutoTradeService } from '@core/binance/futures/bot/infrastructure/futuresAutoTrade.service';
import { FuturesExchangeInfoController } from '@core/binance/futures/exchange-info/domain/futuresExchangeInfo.controller';
import { FuturesMarketController } from '@core/binance/futures/market/domain/futuresMarket.controller';
import type { MarketMode, MarketSnapshot, LiveMarketState } from '@interfaces/market.interface';
import type { TerminalState } from '@interfaces/terminal.interface';
import { applyTerminalCommand, formatAvailableCommands, getDefaultTerminalState } from '@lib/command-parser';

const futuresMarketController = new FuturesMarketController();
const futuresExchangeInfoController = new FuturesExchangeInfoController();

function buildMarketSnapshotFromLive(terminal: TerminalState, live: LiveMarketState): MarketSnapshot | null {
  if (live.initialCandles.length === 0) {
    return null;
  }

  const candles = live.initialCandles.map((candle) => ({
    openTime: candle.openTime,
    high: candle.high,
    low: candle.low,
    close: candle.close,
    volume: candle.volume,
  }));
  const supportResistance = getSupportResistance(candles, 10);
  const trend = analyzeTrend(candles, supportResistance);
  const setupSide = trend.direction === 'bullish' ? 'long' : 'short';
  const setup = analyzeSetupSide(setupSide, candles, trend, supportResistance);

  return {
    candles,
    pair: terminal.activeSymbol,
    interval: terminal.mode === 'scalp' ? '5m' : terminal.mode === 'swing' ? '1h' : '4h',
    mode: terminal.mode,
    supportResistance,
    trend,
    setup,
  };
}

function buildAutoBotPlan(snapshot: MarketSnapshot, currentPrice: number) {
  return {
    allocationUnit: 'percent' as const,
    allocationValue: 10,
    currentPrice,
    direction: snapshot.setup.direction,
    entryMid: snapshot.setup.entryMid,
    entryZone: snapshot.setup.entryZone,
    leverage: 5,
    notes: snapshot.setup.reasons,
    riskReward: snapshot.setup.riskReward,
    setupGrade: snapshot.setup.grade,
    setupGradeRank: snapshot.setup.gradeRank,
    setupLabel: snapshot.setup.label,
    setupType: (snapshot.setup.pathMode === 'breakout' ? 'breakout_retest' : 'continuation') as 'breakout_retest' | 'continuation',
    stopLoss: snapshot.setup.stopLoss,
    symbol: snapshot.pair,
    takeProfits: snapshot.setup.takeProfits,
  };
}

async function loadCandlesWithHistory(symbol: string, intervals: string[], targetCount = 220) {
  let lastError: unknown = null;

  for (const interval of intervals) {
    try {
      const initial = await futuresMarketController.getMarketInitialCandles(symbol, interval, targetCount).then((res) => res.data);
      if (initial.length === 0) {
        continue;
      }

      const candles = [...initial];
      let cursor = candles[0]?.openTime ?? null;

      while (candles.length < targetCount && cursor !== null) {
        const older = await futuresMarketController.getOlderMarketCandles(symbol, cursor, interval, Math.min(200, targetCount - candles.length)).catch(() => []);
        if (older.length === 0) break;
        candles.unshift(...older);
        cursor = older[0]?.openTime ?? null;
      }

      if (candles.length >= 20) {
        return candles.slice(-targetCount);
      }
    } catch (error) {
      lastError = error;
    }
  }

  void lastError;
  return [];
}

function describeLiveDataRootCause(input: {
  initialCandles: number;
  currentPrice: number | null;
  exchangeInfoSummary: unknown;
  overview: unknown;
  symbolSnapshot: unknown;
  symbolDetail: unknown;
}) {
  if (
    input.initialCandles === 0 &&
    input.currentPrice === null &&
    !input.exchangeInfoSummary &&
    !input.overview &&
    !input.symbolSnapshot &&
    !input.symbolDetail
  ) {
    return 'live Binance futures API returned no candles and no price data';
  }
  if (input.initialCandles === 0 && input.currentPrice === null) {
    return 'live Binance futures API returned no candles';
  }
  if (input.currentPrice === null && input.initialCandles === 0) {
    return 'live Binance futures price feed returned no current price';
  }
  if (!input.exchangeInfoSummary && input.initialCandles === 0 && input.currentPrice === null) {
    return 'exchange info request failed';
  }
  if (!input.overview && input.initialCandles === 0 && input.currentPrice === null) {
    return 'market overview request failed';
  }
  if (!input.symbolSnapshot && input.initialCandles === 0 && input.currentPrice === null) {
    return 'symbol snapshot request failed';
  }
  if (!input.symbolDetail && input.initialCandles === 0 && input.currentPrice === null) {
    return 'symbol detail request failed';
  }
  return 'live market data is incomplete';
}

function App() {
  const { exit } = useApp();
  const terminalHeight = process.stdout.rows ?? 43;
  const terminalWidth = process.stdout.columns ?? 80;
  const [tick, setTick] = useState(0);
  const [terminal, setTerminal] = useState<TerminalState>(() => getDefaultTerminalState());
  const [commandInput, setCommandInput] = useState('');
  const [selectedSuggestionIndex, setSelectedSuggestionIndex] = useState(0);
  const [liveState, setLiveState] = useState<LiveMarketState>({
    exchangeInfoSummary: null,
    overview: null,
    symbolSnapshot: null,
    symbolDetail: null,
    initialCandles: [],
    bot: null,
    botLogs: [],
    openOrders: null,
    openPositions: null,
    realizedPnlHistory: null,
    currentPrice: null,
    loading: true,
    error: null,
    lastUpdatedAt: null,
  });
  const [refreshToken, setRefreshToken] = useState(0);

  useInput((input: string, key) => {
    if (key.escape && commandInput.length === 0) {
      exit();
      return;
    }

    if (input === 'q' && commandInput.length === 0) {
      exit();
      return;
    }

    if (key.return) {
      if (commandSuggestions.length > 0 && commandInput.trim().startsWith('/')) {
        const selectedSuggestion = commandSuggestions[selectedSuggestionIndex] ?? commandSuggestions[0];
        if (selectedSuggestion && commandInput.trim() === '/') {
          setCommandInput(selectedSuggestion.command);
          setSelectedSuggestionIndex(0);
          return;
        }
      }

      const result = applyTerminalCommand(commandInput, terminal);

      setTerminal((current) => {
        const nextLevels = result.state.levels
          ? {
              ...current.levels,
              ...result.state.levels,
              takeProfits: {
                ...current.levels.takeProfits,
                ...result.state.levels.takeProfits,
              },
            }
          : current.levels;

        return {
          ...current,
          ...result.state,
          levels: nextLevels,
          history: [
            ...current.history,
            {
              input: commandInput,
              kind: result.kind ?? 'system',
              message: result.message,
            },
          ],
        };
      });

      if (result.refresh) {
        setRefreshToken((current) => current + 1);
      }

      if (!result.preserveInput) {
        setCommandInput('');
      }
      return;
    }

    if (key.backspace || key.delete) {
      setCommandInput((current) => current.slice(0, -1));
      setSelectedSuggestionIndex(0);
      return;
    }

    if (key.ctrl && input === 'u') {
      setCommandInput('');
      return;
    }

    if (key.ctrl && input === 'c') {
      exit();
      return;
    }

    if (input === '?') {
      setTerminal((current) => ({ ...current, showHelp: !current.showHelp }));
      return;
    }

    if (key.upArrow || key.downArrow) {
      if (commandSuggestions.length === 0) return;
      setSelectedSuggestionIndex((current) =>
        key.upArrow
          ? current <= 0
            ? commandSuggestions.length - 1
            : current - 1
          : current >= commandSuggestions.length - 1
            ? 0
            : current + 1,
      );
      return;
    }

    if (key.tab) {
      if (commandSuggestions.length > 0) {
        setCommandInput(commandSuggestions[selectedSuggestionIndex]?.command ?? commandSuggestions[0].command);
        setSelectedSuggestionIndex(0);
      }
      return;
    }

    if (input.length === 1 && !key.ctrl && !key.meta) {
      setCommandInput((current) => current + input);
      setSelectedSuggestionIndex(0);
    }
  });

  useEffect(() => {
    const id = setInterval(() => setTick((current) => current + 1), 1000);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    const id = setInterval(() => {
      setRefreshToken((current) => current + 1);
    }, 12_000);

    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    setSelectedSuggestionIndex(0);
  }, [commandInput]);

  useEffect(() => {
    let cancelled = false;

    async function loadLiveData() {
      setLiveState((current) => ({ ...current, loading: true, error: null }));

      try {
        const [exchangeInfoSummary, overview, symbolSnapshot, symbolDetail, bot, botLogs, currentPrice, openOrders, openPositions, realizedPnlHistory] =
          await Promise.all([
            futuresExchangeInfoController.getExchangeInfoSummary().then((res) => res.data).catch(() => null),
            futuresMarketController.getMarketOverview().catch(() => null),
            futuresMarketController.getMarketSymbolSnapshot(terminal.activeSymbol).catch(() => null),
            futuresMarketController.getMarketSymbolDetail(terminal.activeSymbol, terminal.mode === 'scalp' ? '5m' : terminal.mode === 'swing' ? '1h' : '4h').catch(() => null),
            futuresAutoBotService.getResolved(terminal.activeSymbol).catch(() => null),
            futuresAutoBotService.getLogs(terminal.activeSymbol).catch(() => []),
            futuresAutoTradeService.getCurrentPrice(terminal.activeSymbol).then((item) => Number(item.price)).catch(() => null),
            futuresAutoTradeService.getOpenOrders(terminal.activeSymbol).catch(() => null),
            futuresAutoTradeService.getOpenPositions(terminal.activeSymbol).catch(() => null),
            futuresAutoTradeService.getRealizedPnlHistory(terminal.activeSymbol, 20).catch(() => null),
          ]);
        const interval = terminal.mode === 'scalp' ? '5m' : terminal.mode === 'swing' ? '1h' : '4h';
        const initialCandles = await loadCandlesWithHistory(terminal.activeSymbol, [interval, '15m', '5m', '1m'], 220);

        if (cancelled) {
          return;
        }

        const hasRenderableData =
          initialCandles.length > 0 ||
          currentPrice !== null ||
          exchangeInfoSummary !== null ||
          overview !== null ||
          symbolSnapshot !== null ||
          symbolDetail !== null;
        const liveDataRootCause = describeLiveDataRootCause({
          initialCandles: initialCandles.length,
          currentPrice,
          exchangeInfoSummary,
          overview,
          symbolSnapshot,
          symbolDetail,
        });
        setLiveState({
          exchangeInfoSummary,
          overview,
          symbolSnapshot,
          symbolDetail,
          initialCandles: initialCandles.length > 0 ? initialCandles : symbolDetail?.data.candles ?? [],
          bot,
          botLogs,
          openOrders,
          openPositions,
          realizedPnlHistory,
          currentPrice,
          loading: false,
          error: hasRenderableData ? null : liveDataRootCause,
          lastUpdatedAt: new Date().toISOString(),
        });

        const liveSnapshotState = {
          exchangeInfoSummary,
          overview,
          symbolSnapshot,
          symbolDetail,
          initialCandles: initialCandles.length > 0 ? initialCandles : symbolDetail?.data.candles ?? [],
          bot,
          botLogs,
          openOrders,
          openPositions,
          realizedPnlHistory,
          currentPrice,
          loading: false,
          error: hasRenderableData ? null : liveDataRootCause,
          lastUpdatedAt: new Date().toISOString(),
        };
        const snapshotForBot = symbolDetail?.data ? buildMarketSnapshotFromLive(terminal, liveSnapshotState) : null;

        if (terminal.autoTrade && currentPrice !== null && snapshotForBot) {
          const currentBot = bot ?? (await futuresAutoBotService.getResolved(terminal.activeSymbol).catch(() => null));
          if (!currentBot) {
            await futuresAutoBotService.start(buildAutoBotPlan(snapshotForBot, currentPrice));
          }
        } else if (!terminal.autoTrade) {
          await futuresAutoBotService.stop(terminal.activeSymbol).catch(() => undefined);
        }
      } catch (error) {
        if (cancelled) {
          return;
        }

        setLiveState((current) => ({
          ...current,
          loading: false,
          error: error instanceof Error ? `${error.message}` : 'Unable to load live futures data.',
          lastUpdatedAt: new Date().toISOString(),
        }));
      }
    }

    loadLiveData();
    return () => {
      cancelled = true;
    };
  }, [terminal.activeSymbol, terminal.mode, refreshToken]);

  const snapshot = useMemo(() => {
    return buildMarketSnapshotFromLive(terminal, liveState);
  }, [liveState.initialCandles, terminal]);

  const commandSuggestions = useMemo(() => {
    const trimmed = commandInput.trim();
    if (!trimmed.startsWith('/')) {
      return [];
    }

    const lower = trimmed.toLowerCase();
    return formatAvailableCommands()
      .filter((entry) => entry.command.startsWith(lower))
      .map((entry) => ({ command: entry.command, description: entry.description }));
  }, [commandInput]);
  const panelWidth = Math.max(40, terminalWidth - 2);

  return (
    <Box flexDirection="column" padding={1} height={terminalHeight}>
      <Box flexDirection="column">
        <Text>
          <Text color="#8be9fd" bold>
            BTC Market Scanner
          </Text>{' '}
          <Text color="#c9d1d9">command terminal</Text>
        </Text>
        <Text>
          <Text color="#8b949e">pair: </Text>
          <Text color="#8be9fd" bold>
            {terminal.activeSymbol}
          </Text>{' '}
          <Text color="#8b949e">interval: </Text>
          <Text color="#f1fa8c">{terminal.mode === 'scalp' ? '5m' : terminal.mode === 'swing' ? '1h' : '4h'}</Text>{' '}
          <Text color="#8b949e">mode: </Text>
          <Text color="#8be9fd">{terminal.mode}</Text>{' '}
          <Text color="#8b949e">auto: </Text>
          <Text color={terminal.autoTrade ? '#50fa7b' : '#ff6b6b'}>{terminal.autoTrade ? 'on' : 'off'}</Text>{' '}
          <Text color="#8b949e">view: </Text>
          <Text color="#8be9fd">{terminal.view}</Text>{' '}
          <Text color="#8b949e">uptime: </Text>
          <Text color="#f1fa8c">{tick}s</Text>
        </Text>
        <Text>
          <Text color="#8b949e">market </Text>
          <Text color={snapshot?.trend.direction === 'bullish' ? '#50fa7b' : snapshot?.trend.direction === 'bearish' ? '#ff6b6b' : '#c9d1d9'} bold>
            {snapshot?.trend.label ?? 'loading'}
          </Text>{' '}
          <Text color="#8b949e">help: </Text>
          <Text color={terminal.showHelp ? '#8be9fd' : '#8b949e'}>{terminal.showHelp ? 'on' : 'off'}</Text>{' '}
          <Text color="#8b949e">live: </Text>
          <Text color={liveState.loading ? '#f1fa8c' : liveState.error ? '#ff6b6b' : '#50fa7b'}>
            {liveState.loading ? 'loading' : liveState.error ? 'error' : 'ready'}
          </Text>
        </Text>
        {snapshot && !liveState.error ? (
          <>
            <Text>
              <Text color="#8b949e">support: </Text>
              <Text color="#50fa7b">{snapshot.supportResistance?.support?.toLocaleString('en-US') ?? 'n/a'}</Text>{' '}
              <Text color="#8b949e">resistance: </Text>
              <Text color="#ff6b6b">{snapshot.supportResistance?.resistance?.toLocaleString('en-US') ?? 'n/a'}</Text>{' '}
              <Text color="#8b949e">price: </Text>
              <Text color={liveState.currentPrice !== null ? '#8be9fd' : '#8b949e'}>{liveState.currentPrice?.toLocaleString('en-US') ?? 'n/a'}</Text>
            </Text>
            <Text>
              <Text color="#8b949e">setup: </Text>
              <Text color={snapshot.setup.direction === 'long' ? '#50fa7b' : '#ff6b6b'}>{snapshot.setup.label}</Text>{' '}
              <Text color="#8b949e">grade: </Text>
              <Text color="#f1fa8c">{snapshot.setup.grade}</Text>{' '}
              <Text color="#8b949e">r/r: </Text>
              <Text color={snapshot.setup.riskReward !== null ? '#8be9fd' : '#8b949e'}>
                {snapshot.setup.riskReward !== null ? `1:${snapshot.setup.riskReward.toFixed(2)}` : 'n/a'}
              </Text>
            </Text>
          </>
        ) : null}
        {liveState.error ? (
          <Box borderStyle="round" borderColor="#ff7b72" paddingX={1} paddingY={0}>
            <Text>
              <Text color="#ff7b72" bold>
                live api error
              </Text>
              <Text>{' '}</Text>
              <Text dimColor>{liveState.error}</Text>
            </Text>
          </Box>
        ) : null}
        {liveState.error ? null : terminal.history.length > 1 ? <CommandHistory items={terminal.history} width={panelWidth} /> : null}
        {liveState.error ? null : terminal.showHelp ? <HelpOverlay width={panelWidth} /> : null}
      </Box>

        {liveState.error ? null : snapshot ? (
        <TradingDashboard
          snapshot={snapshot}
          mode={terminal.mode}
          tick={tick}
          autoTrade={terminal.autoTrade}
          liveState={liveState}
          view={terminal.view}
          panelWidth={panelWidth}
        />
      ) : null}

      <Box flexGrow={1} />

      <Box flexDirection="column">
        <CommandBar value={commandInput} width={panelWidth} />
        {commandSuggestions.length > 0 ? (
          <CommandSuggestions suggestions={commandSuggestions} selectedIndex={selectedSuggestionIndex} />
        ) : null}
        {commandInput.length === 0 ? (
          <Box paddingX={1}>
            <Text dimColor>Press `?` for help. `q` or `esc` exits when input is empty.</Text>
          </Box>
        ) : null}
      </Box>
    </Box>
  );
}

render(<App />);
