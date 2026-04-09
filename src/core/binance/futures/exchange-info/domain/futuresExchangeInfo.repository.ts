import type { FuturesExchangeInfoResponse } from './futuresExchangeInfo.interface';

export interface FuturesExchangeInfoRepository {
  getExchangeInfo(): Promise<FuturesExchangeInfoResponse>;
}
