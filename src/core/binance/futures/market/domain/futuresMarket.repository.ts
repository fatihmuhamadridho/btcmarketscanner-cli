import type { FuturesExchangeInfoResponse, FuturesKlinesQuery, FuturesKlinesResponse, FuturesTicker24hrResponse } from './futuresMarket.interface';

export interface FuturesMarketRepository {
  getExchangeInfo(): Promise<FuturesExchangeInfoResponse>;
  getTickers24hr(): Promise<FuturesTicker24hrResponse>;
  getKlines(symbol: string, options?: FuturesKlinesQuery): Promise<FuturesKlinesResponse>;
}
