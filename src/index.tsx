import React, { useEffect, useMemo, useState } from 'react';
import { Box, Text, render, useApp, useInput } from 'ink';
import { analyzeSetupSide, analyzeTrend, getSupportResistance, type SetupCandle } from 'btcmarketscanner-core';
import { CommandBar } from './components/molecules/CommandBar.molecule.js';
import { CommandHistory } from './components/molecules/CommandHistory.molecule.js';
import { CommandSuggestions } from './components/molecules/CommandSuggestions.molecule.js';
import { HelpOverlay } from './components/organisms/HelpOverlay.organism.js';
import { TradingDashboard } from './components/organisms/TradingDashboard.organism.js';
import type { MarketSnapshot } from './interfaces/market.interface.js';
import type { TerminalState } from './interfaces/terminal.interface.js';
import { applyTerminalCommand, formatAvailableCommands, getDefaultTerminalState } from './lib/command-parser.js';

const candleSeed: SetupCandle[] = [
  { openTime: 1, high: 64510, low: 64180, close: 64420, volume: 1840 },
  { openTime: 2, high: 64630, low: 64390, close: 64580, volume: 1950 },
  { openTime: 3, high: 64790, low: 64520, close: 64710, volume: 2130 },
  { openTime: 4, high: 64840, low: 64660, close: 64780, volume: 2015 },
  { openTime: 5, high: 64920, low: 64710, close: 64840, volume: 2205 },
  { openTime: 6, high: 65010, low: 64790, close: 64960, volume: 2280 },
  { openTime: 7, high: 65140, low: 64910, close: 65080, volume: 2400 },
  { openTime: 8, high: 65190, low: 64980, close: 65030, volume: 2325 },
  { openTime: 9, high: 65240, low: 64970, close: 65180, volume: 2480 },
  { openTime: 10, high: 65390, low: 65110, close: 65310, volume: 2610 },
  { openTime: 11, high: 65480, low: 65260, close: 65410, volume: 2740 },
  { openTime: 12, high: 65590, low: 65380, close: 65510, volume: 2810 },
  { openTime: 13, high: 65630, low: 65450, close: 65590, volume: 2905 },
  { openTime: 14, high: 65710, low: 65510, close: 65680, volume: 3030 },
  { openTime: 15, high: 65890, low: 65610, close: 65820, volume: 3180 },
];

function App() {
  const { exit } = useApp();
  const terminalHeight = process.stdout.rows ?? 43;
  const [tick, setTick] = useState(0);
  const [terminal, setTerminal] = useState<TerminalState>(() => getDefaultTerminalState());
  const [commandInput, setCommandInput] = useState('');
  const [selectedSuggestionIndex, setSelectedSuggestionIndex] = useState(0);

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
      setTerminal((current) => ({
        ...current,
        showHelp: !current.showHelp,
      }));
      return;
    }

    if (key.upArrow || key.downArrow) {
      if (commandSuggestions.length === 0) {
        return;
      }

      setSelectedSuggestionIndex((current) => {
        const next =
          key.upArrow
            ? current <= 0
              ? commandSuggestions.length - 1
              : current - 1
            : current >= commandSuggestions.length - 1
              ? 0
              : current + 1;
        return next;
      });
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
    return () => {
      clearInterval(id);
    };
  }, []);

  useEffect(() => {
    setSelectedSuggestionIndex(0);
  }, [commandInput]);

  const snapshot: MarketSnapshot = useMemo(() => {
    const supportResistance = getSupportResistance(candleSeed, 10);
    const trend = analyzeTrend(candleSeed, supportResistance);
    const setupSide = trend.direction === 'bullish' ? 'long' : 'short';
    const setup = analyzeSetupSide(setupSide, candleSeed, trend, supportResistance);

    return {
      candles: candleSeed,
      pair: terminal.activeSymbol,
      interval: terminal.mode === 'scalp' ? '5m' : terminal.mode === 'swing' ? '1h' : '4h',
      mode: terminal.mode,
      supportResistance,
      trend,
      setup,
    };
  }, [terminal.activeSymbol, terminal.mode]);

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

  return (
    <Box flexDirection="column" padding={1} height={terminalHeight}>
      <Box flexDirection="column">
        <Text>
          <Text color="#7ee7ff" bold>
            BTC Market Scanner
          </Text>{' '}
          <Text dimColor>command terminal</Text>
        </Text>
        <Text dimColor>
          pair: {snapshot.pair} • interval: {snapshot.interval} • mode: {terminal.mode} • auto:{' '}
          {terminal.autoTrade ? 'on' : 'off'} • uptime: {tick}s
        </Text>
        <Text dimColor>
          market {snapshot.trend.label} • pair {snapshot.pair} • help {terminal.showHelp ? 'on' : 'off'}
        </Text>
        <Text dimColor>
          support {snapshot.supportResistance?.support?.toLocaleString('en-US') ?? 'n/a'} • resistance{' '}
          {snapshot.supportResistance?.resistance?.toLocaleString('en-US') ?? 'n/a'}
        </Text>
        <Text dimColor>
          setup {snapshot.setup.label} • grade {snapshot.setup.grade} • r/r{' '}
          {snapshot.setup.riskReward !== null ? `1:${snapshot.setup.riskReward.toFixed(2)}` : 'n/a'}
        </Text>
        {terminal.history.length > 1 ? <CommandHistory items={terminal.history} /> : null}
        {terminal.showHelp ? <HelpOverlay /> : null}
      </Box>

      <Box flexGrow={1} />

      <Box flexDirection="column">
        <CommandBar value={commandInput} />
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
