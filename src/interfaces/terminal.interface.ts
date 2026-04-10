export type TerminalMode = '1m' | '5m' | '15m' | '1h' | '4h';
export type TerminalView = 'overview' | 'market' | 'bot' | 'orders' | 'history';
export type TerminalSetupLeverageOption = 1 | 2 | 3 | 5 | 10 | 15 | 20 | 25 | 50 | 75 | 100 | 125 | 150;

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
  leverage: number;
  setupMenuOpen: boolean;
  setupMenuSelectedIndex: number;
  setupPickerOpen: boolean;
  setupPickerSelectedIndex: number;
  showHistoryPanel: boolean;
  showLogsPanel: boolean;
  intervalPickerOpen: boolean;
  intervalPickerSelectedIndex: number;
  showProfilePanel: boolean;
  watchPickerOpen: boolean;
  watchPickerSelectedIndex: number;
  view: TerminalView;
  watchlist: string[];
  showHelp: boolean;
  history: TerminalHistoryItem[];
};

export type CommandResult = {
  state: Partial<TerminalState>;
  message: string;
  kind?: TerminalHistoryItem['kind'];
  preserveInput?: boolean;
  refresh?: boolean;
  exit?: boolean;
};
