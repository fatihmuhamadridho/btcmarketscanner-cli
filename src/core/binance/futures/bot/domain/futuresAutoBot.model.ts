import type { CoinAutoBotStatus } from '@features/coin/interface/CoinView.interface';

export type FuturesAutoBotDirection = 'long' | 'short';
export type FuturesAutoBotSetupType = 'breakout_retest' | 'breakdown_retest' | 'continuation';

export type FuturesAutoBotPlan = {
  allocationUnit: 'percent' | 'usdt';
  allocationValue: number;
  currentPrice: number | null;
  direction: FuturesAutoBotDirection;
  entryMid: number | null;
  entryZone: { high: number | null; low: number | null };
  leverage: number;
  notes: string[];
  riskReward: number | null;
  setupGrade: 'A+' | 'A' | 'B' | 'C';
  setupGradeRank: number;
  setupLabel: string;
  setupType?: FuturesAutoBotSetupType;
  stopLoss: number | null;
  symbol: string;
  takeProfits: Array<{ label: 'TP1' | 'TP2' | 'TP3'; price: number | null }>;
};

export type FuturesAutoBotPlanSource = 'consensus' | 'openclaw';

export type FuturesAutoBotState = {
  botId: string;
  createdAt: string;
  execution?: FuturesAutoBotExecutionRecord | null;
  executionHistory?: FuturesAutoBotExecutionRecord[];
  lastScanPrice?: number | null;
  lastOpenClawValidationAt?: string | null;
  lastOpenClawValidationFingerprint?: string | null;
  openClawLockedPlan?: FuturesAutoBotPlan | null;
  updatedAt: string;
  plan: FuturesAutoBotPlan;
  planSource?: FuturesAutoBotPlanSource;
  planLockedAt?: string | null;
  planLockExpiresAt?: string | null;
  status: CoinAutoBotStatus;
};

export type StartFuturesAutoBotInput = FuturesAutoBotPlan;

export type FuturesAutoBotExecutionRecord = {
  allocatedMargin: number;
  entryOrderId: number;
  entryOrderStatus: string | null;
  entryPrice: number | null;
  executedAt: string;
  algoOrderClientIds: string[];
  positionSide: 'LONG' | 'SHORT' | null;
  stopLossAlgoOrderId: number | null;
  takeProfitAlgoOrderIds: number[];
  quantity: number;
};

export type FuturesAutoBotLogLevel = 'info' | 'success' | 'warn' | 'error';

export type FuturesAutoBotLogEntry = {
  id: string;
  level: FuturesAutoBotLogLevel;
  message: string;
  timestamp: string;
};
