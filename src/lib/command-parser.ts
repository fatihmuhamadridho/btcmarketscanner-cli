import type { CommandResult, TerminalMode, TerminalState } from '../interfaces/terminal.interface.js';

function parsePrice(raw: string) {
  const value = Number(raw.replace(/,/g, ''));
  return Number.isFinite(value) ? value : null;
}

function normalizeSymbol(raw: string) {
  return raw.trim().toUpperCase();
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
    mode: 'swing',
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
    { command: '/watch', example: 'BTCUSDT', description: 'switch the active market symbol used by the scanner' },
    { command: '/mode', example: 'scalp|swing|position', description: 'change how the scanner interprets market structure and risk' },
    { command: '/entry', example: '65300', description: 'set the planned entry price for the current setup' },
    { command: '/sl', example: '64000', description: 'set the stop loss level to control downside risk' },
    { command: '/tp1', example: '67000', description: 'set the first take profit target for partial exits' },
    { command: '/tp2', example: '68000', description: 'set the second take profit target for scaled exits' },
    { command: '/tp3', example: '69000', description: 'set the third take profit target for the final exit' },
    { command: '/auto', example: 'on|off|toggle', description: 'enable or disable automated trade execution logic' },
    { command: '/help', example: '', description: 'show the available slash commands and their usage' },
    { command: '/clear', example: '', description: 'clear the command history from the terminal view' },
  ];
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

  if (lowerCommand === 'clear') {
    return {
      state: { history: [] },
      kind: 'system',
      message: 'History cleared.',
    };
  }

  if (lowerCommand === 'watch') {
    const symbol = normalizeSymbol(arg);
    if (!symbol) {
      return { state: {}, kind: 'error', message: 'Usage: /watch BTCUSDT' };
    }

    const watchlist = current.watchlist.includes(symbol)
      ? current.watchlist
      : [symbol, ...current.watchlist].slice(0, 8);

    return {
      state: {
        activeSymbol: symbol,
        watchlist,
        showHelp: false,
      },
      kind: 'system',
      message: `Watching ${symbol}.`,
    };
  }

  if (lowerCommand === 'mode') {
    const nextMode = arg.toLowerCase() as TerminalMode;
    if (!['scalp', 'swing', 'position'].includes(nextMode)) {
      return {
        state: {},
        kind: 'error',
        message: 'Usage: /mode scalp|swing|position',
      };
    }

    return {
      state: { mode: nextMode, showHelp: false },
      kind: 'system',
      message: `Mode set to ${nextMode}.`,
    };
  }

  if (lowerCommand === 'entry') {
    const entry = parsePrice(arg);
    if (entry === null) {
      return { state: {}, kind: 'error', message: 'Usage: /entry 65300' };
    }

    return {
      state: {
        levels: {
          ...current.levels,
          entry,
        },
        showHelp: false,
      },
      kind: 'system',
      message: `Entry set to ${entry.toLocaleString('en-US')}.`,
    };
  }

  if (lowerCommand === 'sl' || lowerCommand === 'stop') {
    const stopLoss = parsePrice(arg);
    if (stopLoss === null) {
      return { state: {}, kind: 'error', message: 'Usage: /sl 64000' };
    }

    return {
      state: {
        levels: {
          ...current.levels,
          stopLoss,
        },
        showHelp: false,
      },
      kind: 'system',
      message: `Stop loss set to ${stopLoss.toLocaleString('en-US')}.`,
    };
  }

  if (lowerCommand === 'tp1' || lowerCommand === 'tp2' || lowerCommand === 'tp3') {
    const takeProfit = parsePrice(arg);
    if (takeProfit === null) {
      return { state: {}, kind: 'error', message: `Usage: /${lowerCommand} 67000` };
    }

    return {
      state: {
        levels: {
          ...current.levels,
          takeProfits: {
            ...current.levels.takeProfits,
            [lowerCommand]: takeProfit,
          },
        },
        showHelp: false,
      },
      kind: 'system',
      message: `${lowerCommand.toUpperCase()} set to ${takeProfit.toLocaleString('en-US')}.`,
    };
  }

  if (lowerCommand === 'auto') {
    const next = arg.toLowerCase();
    if (!['on', 'off', 'toggle'].includes(next)) {
      return {
        state: {},
        kind: 'error',
        message: 'Usage: /auto on|off|toggle',
      };
    }

    const autoTrade =
      next === 'toggle' ? !current.autoTrade : next === 'on';

    return {
      state: { autoTrade, showHelp: false },
      kind: 'system',
      message: `Auto trade ${autoTrade ? 'enabled' : 'disabled'}.`,
    };
  }

  if (lowerCommand === 'symbol') {
    const symbol = normalizeSymbol(arg);
    if (!symbol) {
      return { state: {}, kind: 'error', message: 'Usage: /symbol BTCUSDT' };
    }

    return {
      state: { activeSymbol: symbol, showHelp: false },
      kind: 'system',
      message: `Symbol changed to ${symbol}.`,
    };
  }

  return {
    state: {},
    kind: 'error',
    message: `Unknown command: /${command}. Try /help.`,
  };
}
