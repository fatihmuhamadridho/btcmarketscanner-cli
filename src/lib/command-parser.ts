import type {
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
] as const;

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
    leverage: 5,
    setupMenuOpen: false,
    setupMenuSelectedIndex: 0,
    setupPickerOpen: false,
    setupPickerSelectedIndex: 0,
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
    { command: '/history', example: 'on|off|toggle', description: 'show or hide the command history panel' },
    { command: '/setup', example: '10', description: 'open the leverage picker or set leverage directly' },
    { command: '/logs', example: '', description: 'toggle the bot logs panel for the active symbol' },
    { command: '/bot', example: 'start|stop|toggle', description: 'control the local futures bot state' },
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

    if (normalizedArg.toLowerCase() === 'leverage') {
      return {
        state: {
          setupPickerOpen: true,
          setupPickerSelectedIndex: SETUP_LEVERAGE_OPTIONS.findIndex((option) => option.leverage === current.leverage),
          showHelp: false,
        },
        kind: 'system',
        message: 'Leverage picker opened. Use arrows and Enter.',
      };
    }

    const leverage = Number(normalizedArg);
    if (!Number.isFinite(leverage) || leverage <= 0) {
      return {
        state: {},
        kind: 'error',
        message: 'Usage: /setup 10',
      };
    }

    return {
      state: {
        leverage: Math.max(1, Math.trunc(leverage)),
        showHelp: false,
      },
      kind: 'system',
      message: `Leverage set to ${Math.max(1, Math.trunc(leverage))}x.`,
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

  return {
    state: {},
    kind: 'error',
    message: `Unknown command: /${command}. Try /help.`,
  };
}
