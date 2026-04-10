import React, { useEffect, useMemo, useState } from 'react';
import { Box, Text, render, useInput } from 'ink';
import { analyzeSetupSide, analyzeTrend, getSupportResistance } from 'btcmarketscanner-core';
import {
  BINANCE_API_KEY,
  BINANCE_SECRET_KEY,
  getBinanceCredentialSource,
  getBinanceProfileLabel,
  getRuntimeMode,
  setRuntimeConfig,
} from '@configs/base.config';
import { CommandBar } from '@components/molecules/CommandBar.molecule';
import { CommandHistory } from '@components/molecules/CommandHistory.molecule';
import { CommandSuggestions } from '@components/molecules/CommandSuggestions.molecule';
import { WatchPicker, type WatchPickerItem } from '@components/molecules/WatchPicker.molecule';
import { HelpOverlay } from '@components/organisms/HelpOverlay.organism';
import { TradingDashboard } from '@components/organisms/TradingDashboard.organism';
import { futuresAutoBotService } from '@core/binance/futures/bot/infrastructure/futuresAutoBot.service';
import { futuresAutoTradeService } from '@core/binance/futures/bot/infrastructure/futuresAutoTrade.service';
import { FuturesExchangeInfoController } from '@core/binance/futures/exchange-info/domain/futuresExchangeInfo.controller';
import { FuturesMarketController } from '@core/binance/futures/market/domain/futuresMarket.controller';
import { WebsocketService } from '@services/websocket.service';
import { ensureOnboardedConfig } from '@services/onboarding.service';
import type { MarketMode, MarketSnapshot, LiveMarketState } from '@interfaces/market.interface';
import type { TerminalState } from '@interfaces/terminal.interface';
import { applyTerminalCommand, formatAvailableCommands, getDefaultTerminalState } from '@lib/command-parser';

const futuresMarketController = new FuturesMarketController();
const futuresExchangeInfoController = new FuturesExchangeInfoController();
const futuresPriceWebsocketService = new WebsocketService();

function restoreInteractiveTerminal() {
  if (!process.stdin.isTTY) {
    return;
  }

  if (typeof process.stdin.setRawMode === 'function') {
    process.stdin.setRawMode(true);
  }

  process.stdin.resume();
}

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

function formatCompactVolume(value: string | undefined) {
  const numeric = Number(value ?? '0');
  if (!Number.isFinite(numeric) || numeric <= 0) return 'n/a';
  if (numeric >= 1_000_000_000) return `${(numeric / 1_000_000_000).toFixed(1)}B`;
  if (numeric >= 1_000_000) return `${(numeric / 1_000_000).toFixed(1)}M`;
  if (numeric >= 1_000) return `${(numeric / 1_000).toFixed(1)}K`;
  return numeric.toFixed(0);
}

function formatPrice(value: number | null) {
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

function formatDateAgo(value: string | null) {
  if (!value) return 'n/a';

  const timestamp = Date.parse(value);
  if (Number.isNaN(timestamp)) return 'n/a';

  const elapsedSeconds = Math.max(0, Math.round((Date.now() - timestamp) / 1000));
  if (elapsedSeconds < 2) return 'just now';
  return `${elapsedSeconds}s ago`;
}

function formatSecret(value: string) {
  if (!value) return 'n/a';
  return value;
}

function buildWatchPickerItems(liveState: LiveMarketState, watchlist: string[]): WatchPickerItem[] {
  const marketItems = liveState.overview?.data ?? [];
  const marketMap = new Map(
    marketItems
      .filter((item) => item.symbol)
      .map((item) => [item.symbol, item] as const),
  );
  const watchlisted = watchlist
    .map((symbol) => marketMap.get(symbol))
    .filter((item): item is NonNullable<(typeof marketItems)[number]> => Boolean(item));
  const rest = marketItems
    .filter((item) => item.symbol && !watchlist.includes(item.symbol))
    .sort((left, right) => {
      const leftVolume = Number(left.ticker.quoteVolume ?? left.ticker.volume ?? '0');
      const rightVolume = Number(right.ticker.quoteVolume ?? right.ticker.volume ?? '0');
      return rightVolume - leftVolume;
    });

  return [...watchlisted, ...rest].map((item) => ({
    displayName: item.displayName,
    isTrading: item.isTrading,
    isWatched: watchlist.includes(item.symbol),
    pair: item.pair ?? item.symbol,
    symbol: item.symbol,
    volumeLabel: formatCompactVolume(item.ticker.quoteVolume ?? item.ticker.volume),
  }));
}

function filterWatchPickerItems(items: WatchPickerItem[], query: string) {
  const normalizedQuery = query.trim().toLowerCase();

  if (normalizedQuery.length === 0) {
    return items;
  }

  return items.filter((item) => {
    return (
      item.symbol.toLowerCase().includes(normalizedQuery) ||
      item.pair.toLowerCase().includes(normalizedQuery) ||
      item.displayName.toLowerCase().includes(normalizedQuery)
    );
  });
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

type BinanceAggTradeStreamEvent = {
  e?: string;
  s?: string;
  p?: string;
};

async function normalizeWebsocketMessageData(data: unknown) {
  if (typeof data === 'string') {
    return data;
  }

  if (data instanceof ArrayBuffer) {
    return new TextDecoder().decode(new Uint8Array(data));
  }

  if (ArrayBuffer.isView(data)) {
    return new TextDecoder().decode(new Uint8Array(data.buffer, data.byteOffset, data.byteLength));
  }

  if (typeof Blob !== 'undefined' && data instanceof Blob) {
    return data.text();
  }

  if (data && typeof data === 'object' && 'toString' in data) {
    const text = String(data);
    return text === '[object Object]' ? null : text;
  }

  return null;
}

function parseLiveTradePrice(rawMessage: unknown, symbol: string) {
  try {
    const normalized = rawMessage;
    if (typeof normalized !== 'string') {
      return null;
    }

    const parsed = JSON.parse(normalized) as BinanceAggTradeStreamEvent;

    if (parsed.e !== 'aggTrade' && parsed.e !== 'trade') {
      return null;
    }

    if (parsed.s?.toUpperCase() !== symbol.toUpperCase()) {
      return null;
    }

    const rawPrice = parsed.p;
    const price = Number(rawPrice);

    return Number.isFinite(price) ? price : null;
  } catch {
    return null;
  }
}

function App() {
  const terminalHeight = process.stdout.rows ?? 43;
  const terminalWidth = process.stdout.columns ?? 80;
  const [tick, setTick] = useState(0);
  const [terminal, setTerminal] = useState<TerminalState>(() => getDefaultTerminalState());
  const [commandInput, setCommandInput] = useState('');
  const [selectedSuggestionIndex, setSelectedSuggestionIndex] = useState(0);
  const [watchPickerQuery, setWatchPickerQuery] = useState('');
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
    websocketConnected: false,
    websocketError: null,
    websocketLastEventAt: null,
  });
  const [refreshToken, setRefreshToken] = useState(0);

  useEffect(() => {
    const handleSigint = () => {
      futuresPriceWebsocketService.close();
      process.exit(0);
    };
    process.on('SIGINT', handleSigint);

    return () => {
      process.off('SIGINT', handleSigint);
    };
  }, []);

  useInput((input: string, key) => {
    if (terminal.watchPickerOpen) {
      if (key.ctrl && input === 'c') {
        futuresPriceWebsocketService.close();
        process.exit(0);
        return;
      }

      if (key.escape) {
        setTerminal((current) => ({ ...current, watchPickerOpen: false, watchPickerSelectedIndex: 0 }));
        setWatchPickerQuery('');
        return;
      }

      if (key.upArrow || key.downArrow) {
        const watchPickerItems = filterWatchPickerItems(buildWatchPickerItems(liveState, terminal.watchlist), watchPickerQuery);
        if (watchPickerItems.length === 0) return;
        setTerminal((current) => ({
          ...current,
          watchPickerSelectedIndex: key.upArrow
            ? current.watchPickerSelectedIndex <= 0
              ? watchPickerItems.length - 1
              : current.watchPickerSelectedIndex - 1
            : current.watchPickerSelectedIndex >= watchPickerItems.length - 1
              ? 0
              : current.watchPickerSelectedIndex + 1,
        }));
        return;
      }

      if (key.return) {
        const watchPickerItems = filterWatchPickerItems(buildWatchPickerItems(liveState, terminal.watchlist), watchPickerQuery);
        const selectedItem = watchPickerItems[terminal.watchPickerSelectedIndex] ?? watchPickerItems[0];
        if (selectedItem) {
          setTerminal((current) => ({
            ...current,
            activeSymbol: selectedItem.symbol,
            watchPickerOpen: false,
            watchPickerSelectedIndex: 0,
            watchlist: current.watchlist.includes(selectedItem.symbol)
              ? current.watchlist
              : [selectedItem.symbol, ...current.watchlist].slice(0, 8),
          }));
          setCommandInput('');
          setWatchPickerQuery('');
          setRefreshToken((current) => current + 1);
        }
        return;
      }

      if (key.backspace || key.delete) {
        setWatchPickerQuery((current) => current.slice(0, -1));
        setTerminal((current) => ({ ...current, watchPickerSelectedIndex: 0 }));
        return;
      }

      if (input.length === 1 && !key.ctrl && !key.meta) {
        setWatchPickerQuery((current) => `${current}${input}`);
        setTerminal((current) => ({ ...current, watchPickerSelectedIndex: 0 }));
        return;
      }

      return;
    }

    if (key.escape && commandInput.length === 0) {
      futuresPriceWebsocketService.close();
      process.exit(0);
      return;
    }

    if (input === 'q' && commandInput.length === 0) {
      futuresPriceWebsocketService.close();
      process.exit(0);
      return;
    }

    if (key.return) {
      let commandToRun = commandInput;

      if (commandInput.trim().startsWith('/')) {
        if (commandSuggestions.length === 1) {
          commandToRun = commandSuggestions[0].command;
        }
        else if (commandSuggestions.length > 0) {
          const selectedSuggestion = commandSuggestions[selectedSuggestionIndex] ?? commandSuggestions[0];
          if (selectedSuggestion && commandInput.trim() === '/') {
            commandToRun = selectedSuggestion.command;
          }
        }
      }

      const result = applyTerminalCommand(commandToRun, terminal);

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
          watchPickerSelectedIndex: result.state.watchPickerSelectedIndex ?? current.watchPickerSelectedIndex,
          history: [
            ...current.history,
            {
              input: commandToRun,
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
      futuresPriceWebsocketService.close();
      process.exit(0);
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
    if (terminal.watchPickerOpen) {
      setWatchPickerQuery('');
      setTerminal((current) => ({ ...current, watchPickerSelectedIndex: 0 }));
    }
  }, [terminal.watchPickerOpen]);

  useEffect(() => {
    if (typeof WebSocket === 'undefined') {
      return undefined;
    }

    const streamPath = `${terminal.activeSymbol.toLowerCase()}@aggTrade`;

    let socket: WebSocket | null = null;

    try {
      socket = futuresPriceWebsocketService.connect(streamPath);
      setLiveState((current) => ({ ...current, websocketConnected: false, websocketError: null }));
    } catch (error) {
      setLiveState((current) => ({
        ...current,
        websocketConnected: false,
        websocketError: error instanceof Error ? error.message : 'Unable to open websocket connection.',
      }));
      return undefined;
    }

    const handleOpen = () => {
      setLiveState((current) => ({ ...current, websocketConnected: true, websocketError: null }));
    };

    const handleError = () => {
      setLiveState((current) => ({
        ...current,
        websocketConnected: false,
        websocketError: 'Websocket error.',
      }));
    };

    const handleClose = () => {
      setLiveState((current) => ({
        ...current,
        websocketConnected: false,
        websocketError: current.websocketError ?? 'Websocket closed.',
      }));
    };

    socket.onopen = handleOpen;
    socket.onerror = handleError;
    socket.onclose = handleClose;
    socket.onmessage = (event) => {
      void (async () => {
        const normalized = await normalizeWebsocketMessageData(event.data);
        const nextPrice = parseLiveTradePrice(normalized, terminal.activeSymbol);

        if (nextPrice === null) {
          return;
        }

        setLiveState((current) => {
          return {
            ...current,
            currentPrice: nextPrice,
            lastUpdatedAt: new Date().toISOString(),
            websocketLastEventAt: new Date().toISOString(),
          };
        });
      })();
    };

    return () => {
      socket.onopen = null;
      socket.onerror = null;
      socket.onclose = null;
      socket.onmessage = null;
      futuresPriceWebsocketService.close();
    };
  }, [terminal.activeSymbol]);

  useEffect(() => {
    setSelectedSuggestionIndex(0);
  }, [commandInput]);

  useEffect(() => {
    let cancelled = false;

    async function loadLiveData() {
      setLiveState((current) => ({ ...current, loading: true, error: null }));

      try {
        const [exchangeInfoSummary, overview, symbolSnapshot, symbolDetail, bot, botLogs, openOrders, openPositions, realizedPnlHistory] =
          await Promise.all([
            futuresExchangeInfoController.getExchangeInfoSummary().then((res) => res.data).catch(() => null),
            futuresMarketController.getMarketOverview().catch(() => null),
            futuresMarketController.getMarketSymbolSnapshot(terminal.activeSymbol).catch(() => null),
            futuresMarketController.getMarketSymbolDetail(terminal.activeSymbol, terminal.mode === 'scalp' ? '5m' : terminal.mode === 'swing' ? '1h' : '4h').catch(() => null),
            futuresAutoBotService.getResolved(terminal.activeSymbol).catch(() => null),
            futuresAutoBotService.getLogs(terminal.activeSymbol).catch(() => []),
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
          exchangeInfoSummary !== null ||
          overview !== null ||
          symbolSnapshot !== null ||
          symbolDetail !== null;
          const liveDataRootCause = describeLiveDataRootCause({
          initialCandles: initialCandles.length,
          currentPrice: liveState.currentPrice,
          exchangeInfoSummary,
          overview,
          symbolSnapshot,
          symbolDetail,
        });
        setLiveState((current) => ({
          ...current,
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
          loading: false,
          error: hasRenderableData ? null : liveDataRootCause,
          lastUpdatedAt: new Date().toISOString(),
        }));

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
          currentPrice: liveState.currentPrice,
          loading: false,
          error: hasRenderableData ? null : liveDataRootCause,
          lastUpdatedAt: new Date().toISOString(),
          websocketConnected: liveState.websocketConnected,
          websocketError: liveState.websocketError,
          websocketLastEventAt: liveState.websocketLastEventAt,
        };
        const snapshotForBot = symbolDetail?.data ? buildMarketSnapshotFromLive(terminal, liveSnapshotState) : null;

        if (terminal.autoTrade && liveState.currentPrice !== null && snapshotForBot) {
          const currentBot = bot ?? (await futuresAutoBotService.getResolved(terminal.activeSymbol).catch(() => null));
          if (!currentBot) {
            await futuresAutoBotService.start(buildAutoBotPlan(snapshotForBot, liveState.currentPrice));
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
  const watchPickerItems = useMemo(() => buildWatchPickerItems(liveState, terminal.watchlist), [liveState.overview, terminal.watchlist]);
  const filteredWatchPickerItems = useMemo(
    () => filterWatchPickerItems(watchPickerItems, watchPickerQuery),
    [watchPickerItems, watchPickerQuery]
  );
  const credentialSource = getBinanceCredentialSource();
  const runtimeMode = getRuntimeMode();
  const profileLabel = getBinanceProfileLabel();
  const apiKey = BINANCE_API_KEY();
  const secretKey = BINANCE_SECRET_KEY();

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
          <Text color="#8b949e">profile: </Text>
          <Text color={credentialSource === 'env' ? '#50fa7b' : credentialSource === 'json' ? '#8be9fd' : '#ff6b6b'}>
            {credentialSource}
          </Text>{' '}
          <Text color="#8b949e">runtime: </Text>
          <Text color="#f1fa8c">{runtimeMode}</Text>{' '}
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
          <Text color="#8b949e">ws: </Text>
          <Text color={liveState.websocketConnected ? '#50fa7b' : '#ff6b6b'}>
            {liveState.websocketConnected ? 'open' : 'closed'}
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
              <Text color="#50fa7b">{formatPrice(snapshot.supportResistance?.support ?? null)}</Text>{' '}
              <Text color="#8b949e">resistance: </Text>
              <Text color="#ff6b6b">{formatPrice(snapshot.supportResistance?.resistance ?? null)}</Text>{' '}
              <Text color="#8b949e">price: </Text>
              <Text color={liveState.currentPrice !== null ? '#8be9fd' : '#8b949e'}>{formatPrice(liveState.currentPrice)}</Text>
              <Text color="#8b949e"> ws: </Text>
              <Text color="#8be9fd">{liveState.websocketLastEventAt ? formatDateAgo(liveState.websocketLastEventAt) : 'n/a'}</Text>
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
        {terminal.showProfilePanel ? (
          <Box borderStyle="round" borderColor="#8be9fd" paddingX={1} paddingY={0}>
            <Box flexDirection="column">
              <Text color="#8be9fd" bold>
                Profile
              </Text>
              <Text>
                <Text color="#8b949e">account: </Text>
                <Text color="#f1fa8c">{profileLabel}</Text>
              </Text>
              <Text>
                <Text color="#8b949e">source: </Text>
                <Text color={credentialSource === 'env' ? '#50fa7b' : credentialSource === 'json' ? '#8be9fd' : '#ff6b6b'}>
                  {credentialSource}
                </Text>
              </Text>
              <Text>
                <Text color="#8b949e">api key: </Text>
                <Text color="#c9d1d9">{apiKey || 'n/a'}</Text>
              </Text>
              <Text>
                <Text color="#8b949e">secret: </Text>
                <Text color="#c9d1d9">{formatSecret(secretKey)}</Text>
              </Text>
            </Box>
          </Box>
        ) : null}
        {terminal.watchPickerOpen ? (
          <WatchPicker
            items={filteredWatchPickerItems}
            selectedIndex={Math.min(
              terminal.watchPickerSelectedIndex,
              Math.max(0, filteredWatchPickerItems.length - 1)
            )}
            query={watchPickerQuery}
            width={panelWidth}
          />
        ) : null}
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

async function bootstrap() {
  const config = await ensureOnboardedConfig();
  setRuntimeConfig(config);
  restoreInteractiveTerminal();
  render(<App />);
}

void bootstrap();
