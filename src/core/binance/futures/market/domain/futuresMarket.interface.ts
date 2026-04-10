import type { FuturesExchangeInfo } from '../../exchange-info/domain/futuresExchangeInfo.model';
import type {
  FuturesKlineCandle,
  FuturesMarketOverviewItem,
  FuturesMarketSymbolDetail,
  FuturesTicker24hrProps,
} from './futuresMarket.model';

export type FuturesTicker24hrResponse = FuturesTicker24hrProps[];

export type FuturesKlinesResponse = Array<
  [number, string, string, string, string, string, number, string, number, string, string, string]
>;

export type FuturesKlinesQuery = {
  interval?: string;
  limit?: number;
  startTime?: number;
  endTime?: number;
};

export type FuturesMarketOverviewResult = {
  data: FuturesMarketOverviewItem[];
  exchangeInfo: FuturesExchangeInfo;
};

export type FuturesMarketSymbolDetailResult = {
  data: FuturesMarketSymbolDetail;
};

export type FuturesExchangeInfoResponse = FuturesExchangeInfo;

export type FuturesKlinesResult = {
  data: FuturesKlineCandle[];
};
