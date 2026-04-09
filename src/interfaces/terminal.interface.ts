export type TerminalMode = 'scalp' | 'swing' | 'position';
export type TerminalView = 'overview' | 'market' | 'bot' | 'orders' | 'history';

export type TerminalLevelState = {
  entry: number | null;
  stopLoss: number | null;
  takeProfits: Record<'tp1' | 'tp2' | 'tp3', number | null>;
};

export type TerminalHistoryItem = {
  input: string;
  kind: 'command' | 'system' | 'error';
  message: string;
};

export type TerminalState = {
  activeSymbol: string;
  autoTrade: boolean;
  levels: TerminalLevelState;
  mode: TerminalMode;
  watchPickerOpen: boolean;
  watchPickerSelectedIndex: number;
  view: TerminalView;
  watchlist: string[];
  showHelp: boolean;
  history: TerminalHistoryItem[];
};

export type CommandResult =
  | {
      state: Partial<TerminalState>;
      message: string;
      kind?: TerminalHistoryItem['kind'];
      preserveInput?: boolean;
      refresh?: boolean;
    };
