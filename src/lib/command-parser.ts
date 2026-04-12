import type {
  TerminalAllocationUnit,
  CommandResult,
  TerminalMode,
  TerminalSetupLeverageOption,
  TerminalState,
} from '@interfaces/terminal.interface';

function normalizeSymbol(raw: string) {
  return raw.trim().toUpperCase();
}

export const SETUP_LEVERAGE_OPTIONS: Array<{
  leverage: TerminalSetupLeverageOption;
  description: string;
}> = [
  { leverage: 1, description: 'lowest risk, slowest exposure' },
  { leverage: 2, description: 'conservative position sizing' },
  { leverage: 3, description: 'balanced default for testing' },
  { leverage: 5, description: 'current default setup' },
  { leverage: 10, description: 'higher conviction setup' },
  { leverage: 15, description: 'aggressive but still common' },
  { leverage: 20, description: 'high leverage setup' },
  { leverage: 25, description: 'very aggressive leverage' },
  { leverage: 50, description: 'extreme leverage for quick tests' },
  { leverage: 75, description: 'very high leverage setup' },
  { leverage: 100, description: 'maximum common retail leverage' },
  { leverage: 125, description: 'exchange-style high leverage' },
  { leverage: 150, description: 'maximum leverage preset' },
];

export const SETUP_MENU_OPTIONS = [
  { key: 'leverage', label: 'Leverage', description: 'choose a leverage preset' },
  { key: 'allocation', label: 'Entry Allocation', description: 'choose percentage or fixed amount' },
  { key: 'marginMode', label: 'Margin Mode', description: 'choose cross or isolated margin' },
] as const;

export const SETUP_ALLOCATION_UNIT_OPTIONS: Array<{
  unit: TerminalAllocationUnit;
  label: string;
  description: string;
}> = [
  { unit: 'percent', label: 'Percentage', description: 'use a percent of wallet balance' },
  { unit: 'usdt', label: 'Amount', description: 'use a fixed USDT margin amount' },
];

export const SETUP_MARGIN_MODE_OPTIONS: Array<{
  mode: 'cross' | 'isolated';
  label: string;
  description: string;
}> = [
  { mode: 'isolated', label: 'Isolated', description: 'isolated margin mode (default, safer)' },
  { mode: 'cross', label: 'Cross', description: 'cross margin mode (higher risk)' },
];

function formatAllocationLabel(unit: TerminalAllocationUnit, value: number) {
  return unit === 'usdt' ? `${value} USDT` : `${value}%`;
}

export function getDefaultTerminalState(): TerminalState {
  return {
    activeSymbol: 'BTCUSDT',
    autoTrade: false,
    levels: {
      entry: null,
      stopLoss: null,
      takeProfits: {
        tp1: null,
        tp2: null,
        tp3: null,
      },
    },
    mode: '1h',
    botMode: 'scalping',
    leverage: 5,
    allocationUnit: 'percent',
    allocationValue: 10,
    marginMode: 'isolated',
    setupMenuOpen: false,
    setupMenuSelectedIndex: 0,
    setupPickerOpen: false,
    setupPickerSelectedIndex: 0,
    setupPickerMode: 'leverage',
    setupInputOpen: false,
    setupInputUnit: 'usdt',
    setupInputValue: '',
    showHistoryPanel: true,
    showLogsPanel: false,
    intervalPickerOpen: false,
    intervalPickerSelectedIndex: 0,
    showProfilePanel: false,
    watchPickerOpen: false,
    watchPickerSelectedIndex: 0,
    view: 'overview',
    watchlist: ['BTCUSDT', 'ETHUSDT', 'SOLUSDT'],
    showHelp: false,
    history: [
      {
        input: '',
        kind: 'system',
        message: 'Type /help for commands.',
      },
    ],
  };
}

export function formatAvailableCommands() {
  return [
    {
      command: '/profile',
      example: 'on|off|toggle',
      description: 'toggle the profile panel with account and balance details',
    },
    {
      command: '/watch',
      example: 'BTCUSDT',
      description: 'open the live symbol picker or switch to a specific market symbol',
    },
    { command: '/interval', example: '1m|5m|15m|1h|4h', description: 'change the active market interval preset' },
    {
      command: '/botmode',
      example: 'scalping|intraday',
      description: 'switch bot mode: scalping (quick trades) or intraday (longer hold)',
    },
    { command: '/history', example: 'on|off|toggle', description: 'show or hide the command history panel' },
    { command: '/setup', example: '', description: 'open leverage and entry allocation setup' },
    { command: '/logs', example: '', description: 'toggle the bot logs panel for the active symbol' },
    { command: '/bot', example: 'start|stop|toggle', description: 'control the local futures bot state' },
    { command: '/set-sl', example: '40500', description: 'manually set stop loss price level' },
    { command: '/set-tp1', example: '42500', description: 'manually set take profit 1 level' },
    { command: '/set-tp2', example: '45000', description: 'manually set take profit 2 level' },
    { command: '/set-tp3', example: '47000', description: 'manually set take profit 3 level' },
    { command: '/entry', example: '', description: 'manually trigger entry order placement' },
    { command: '/close', example: '', description: 'manually close active position' },
    {
      command: '/revalidate',
      example: '',
      description: 'manually request OpenClaw revalidation for the current setup',
    },
    {
      command: '/optimize',
      example: '',
      description: 'ask OpenClaw to optimize TP/SL for your existing open position',
    },
    { command: '/exit', example: '', description: 'exit the terminal app' },
    { command: '/help', example: '', description: 'show the available slash commands and their usage' },
  ];
}

function parseToggleState(arg: string, current: boolean) {
  const next = arg.toLowerCase();
  if (next === 'on') return true;
  if (next === 'off') return false;
  if (next === 'toggle' || next === '') return !current;
  return null;
}

export function applyTerminalCommand(input: string, current: TerminalState): CommandResult {
  const raw = input.trim();

  if (!raw) {
    return {
      state: {},
      kind: 'system',
      message: 'Empty command. Try /help.',
    };
  }

  if (!raw.startsWith('/')) {
    return {
      state: {},
      kind: 'error',
      message: 'Commands must start with "/". Try /help.',
    };
  }

  const [command, ...rest] = raw.slice(1).split(/\s+/);
  const arg = rest.join(' ').trim();
  const lowerCommand = command.toLowerCase();

  if (lowerCommand === 'help') {
    return {
      state: { showHelp: true },
      kind: 'system',
      message: 'Help opened.',
    };
  }

  if (lowerCommand === 'exit') {
    return {
      state: { showHelp: false },
      kind: 'system',
      message: 'Exiting terminal.',
      exit: true,
    };
  }

  if (lowerCommand === 'profile') {
    const next = parseToggleState(arg, current.showProfilePanel);
    if (next === null) {
      return {
        state: {},
        kind: 'error',
        message: 'Usage: /profile on|off|toggle',
      };
    }

    return {
      state: { showProfilePanel: next },
      kind: 'system',
      message: `Profile panel ${next ? 'shown' : 'hidden'}.`,
    };
  }

  if (lowerCommand === 'history') {
    const next = parseToggleState(arg, current.showHistoryPanel);
    if (next === null) {
      return {
        state: {},
        kind: 'error',
        message: 'Usage: /history on|off|toggle',
      };
    }

    return {
      state: { showHistoryPanel: next },
      kind: 'system',
      message: `History panel ${next ? 'shown' : 'hidden'}.`,
    };
  }

  if (lowerCommand === 'interval') {
    const next = arg.toLowerCase();
    if (!next) {
      return {
        state: {
          intervalPickerOpen: true,
          intervalPickerSelectedIndex: 0,
          showHelp: false,
        },
        kind: 'system',
        message: 'Interval picker opened. Use arrows and Enter.',
      };
    }

    const nextMode = next as TerminalMode;
    if (!['1m', '5m', '15m', '1h', '4h'].includes(nextMode)) {
      return {
        state: {},
        kind: 'error',
        message: 'Usage: /interval 1m|5m|15m|1h|4h',
      };
    }

    return {
      state: { mode: nextMode, showHelp: false },
      kind: 'system',
      message: `Interval set to ${nextMode}.`,
      refresh: true,
    };
  }

  if (lowerCommand === 'botmode') {
    const next = arg.toLowerCase();
    if (!next) {
      return {
        state: {},
        kind: 'system',
        message: `Current bot mode: ${current.botMode}. Usage: /botmode scalping|intraday`,
      };
    }

    if (!['scalping', 'intraday'].includes(next)) {
      return {
        state: {},
        kind: 'error',
        message: 'Usage: /botmode scalping|intraday',
      };
    }

    const nextBotMode = next as 'scalping' | 'intraday';
    return {
      state: { botMode: nextBotMode, showHelp: false },
      kind: 'success',
      message: `Bot mode switched to ${nextBotMode}. Will send this info to OpenClaw validation.`,
      refresh: true,
    };
  }

  if (lowerCommand === 'bot') {
    const next = arg.toLowerCase();
    if (!['start', 'stop', 'toggle'].includes(next)) {
      return {
        state: {},
        kind: 'error',
        message: 'Usage: /bot start|stop|toggle',
      };
    }

    return {
      state: {
        autoTrade: next === 'toggle' ? !current.autoTrade : next === 'start',
        showHelp: false,
      },
      kind: 'system',
      message: `Bot ${next === 'stop' ? 'stopped' : next === 'start' ? 'started' : current.autoTrade ? 'stopped' : 'started'}.`,
      refresh: true,
    };
  }

  if (lowerCommand === 'logs') {
    return {
      state: { showLogsPanel: !current.showLogsPanel, showHelp: false },
      kind: 'system',
      message: `Logs panel ${current.showLogsPanel ? 'hidden' : 'shown'}.`,
    };
  }

  if (lowerCommand === 'setup') {
    const normalizedArg = arg.trim();
    if (!normalizedArg) {
      return {
        state: {
          setupMenuOpen: true,
          setupMenuSelectedIndex: 0,
          showHelp: false,
        },
        kind: 'system',
        message: 'Setup menu opened. Use arrows and Enter.',
      };
    }

    return {
      state: {},
      kind: 'error',
      message: `Usage: /setup. Current allocation ${formatAllocationLabel(current.allocationUnit, current.allocationValue)}.`,
    };
  }

  if (lowerCommand === 'watch') {
    const symbol = normalizeSymbol(arg);
    if (!symbol) {
      return {
        state: {
          watchPickerOpen: true,
          watchPickerSelectedIndex: 0,
          showHelp: false,
        },
        kind: 'system',
        message: 'Watch picker opened. Use arrows and Enter.',
      };
    }

    return {
      state: {
        activeSymbol: symbol,
        watchlist: current.watchlist.includes(symbol) ? current.watchlist : [symbol, ...current.watchlist].slice(0, 8),
        watchPickerOpen: false,
        watchPickerSelectedIndex: 0,
        showHelp: false,
      },
      kind: 'system',
      message: `Watching ${symbol}.`,
    };
  }

  if (lowerCommand === 'set-sl') {
    if (!arg) {
      return {
        state: {},
        kind: 'error',
        message: 'Usage: /set-sl <price>',
      };
    }

    const price = parseFloat(arg);
    if (!Number.isFinite(price) || price <= 0) {
      return {
        state: {},
        kind: 'error',
        message: 'Stop loss must be a valid positive number.',
      };
    }

    return {
      state: {
        levels: { ...current.levels, stopLoss: price },
        showHelp: false,
      },
      kind: 'success',
      message: `Stop loss set to ${price.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 8 })}.`,
      refresh: true,
    };
  }

  if (lowerCommand === 'set-tp1') {
    if (!arg) {
      return {
        state: {},
        kind: 'error',
        message: 'Usage: /set-tp1 <price>',
      };
    }

    const price = parseFloat(arg);
    if (!Number.isFinite(price) || price <= 0) {
      return {
        state: {},
        kind: 'error',
        message: 'TP1 must be a valid positive number.',
      };
    }

    return {
      state: {
        levels: {
          ...current.levels,
          takeProfits: { ...current.levels.takeProfits, tp1: price },
        },
        showHelp: false,
      },
      kind: 'success',
      message: `TP1 set to ${price.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 8 })}.`,
      refresh: true,
    };
  }

  if (lowerCommand === 'set-tp2') {
    if (!arg) {
      return {
        state: {},
        kind: 'error',
        message: 'Usage: /set-tp2 <price>',
      };
    }

    const price = parseFloat(arg);
    if (!Number.isFinite(price) || price <= 0) {
      return {
        state: {},
        kind: 'error',
        message: 'TP2 must be a valid positive number.',
      };
    }

    return {
      state: {
        levels: {
          ...current.levels,
          takeProfits: { ...current.levels.takeProfits, tp2: price },
        },
        showHelp: false,
      },
      kind: 'success',
      message: `TP2 set to ${price.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 8 })}.`,
      refresh: true,
    };
  }

  if (lowerCommand === 'set-tp3') {
    if (!arg) {
      return {
        state: {},
        kind: 'error',
        message: 'Usage: /set-tp3 <price>',
      };
    }

    const price = parseFloat(arg);
    if (!Number.isFinite(price) || price <= 0) {
      return {
        state: {},
        kind: 'error',
        message: 'TP3 must be a valid positive number.',
      };
    }

    return {
      state: {
        levels: {
          ...current.levels,
          takeProfits: { ...current.levels.takeProfits, tp3: price },
        },
        showHelp: false,
      },
      kind: 'success',
      message: `TP3 set to ${price.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 8 })}.`,
      refresh: true,
    };
  }

  if (lowerCommand === 'entry') {
    return {
      state: { showHelp: false },
      kind: 'system',
      message: 'Entry order placement triggered. Bot will place limit entry at planned price.',
      botAction: 'place-entry',
      refresh: true,
    };
  }

  if (lowerCommand === 'close') {
    return {
      state: { showHelp: false },
      kind: 'system',
      message: 'Close position command triggered. Bot will close active position.',
      botAction: 'close-position',
      refresh: true,
    };
  }

  if (lowerCommand === 'revalidate') {
    return {
      state: { showHelp: false },
      kind: 'system',
      message: 'Revalidation requested. Bot will re-evaluate current setup with OpenClaw.',
      botAction: 'revalidate',
      refresh: true,
    };
  }

  if (lowerCommand === 'optimize') {
    return {
      state: { showHelp: false },
      kind: 'system',
      message: 'Optimization requested. Bot will ask OpenClaw to optimize TP/SL for your existing position.',
      botAction: 'optimize',
      refresh: true,
    };
  }

  return {
    state: {},
    kind: 'error',
    message: `Unknown command: /${command}. Try /help.`,
  };
}
