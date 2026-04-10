import { BASE_API_BINANCE } from '@configs/base.config';
import { getBinanceFuturesBaseUrl } from '@configs/binance-futures-url';
import { AxiosService } from '@services/axios.service';
import type { FuturesMarketRepository } from '../domain/futuresMarket.repository';
import type {
  FuturesExchangeInfoResponse,
  FuturesKlinesQuery,
  FuturesKlinesResponse,
  FuturesTicker24hrResponse,
} from '../domain/futuresMarket.interface';

export class FuturesMarketRepositoryImpl implements FuturesMarketRepository {
  constructor(private readonly axiosService: AxiosService) {}
  async getExchangeInfo(): Promise<FuturesExchangeInfoResponse> {
    return this.axiosService.get('/exchangeInfo');
  }
  async getTickers24hr(): Promise<FuturesTicker24hrResponse> {
    return this.axiosService.get('/ticker/24hr');
  }
  async getKlines(symbol: string, options: FuturesKlinesQuery = {}): Promise<FuturesKlinesResponse> {
    const { endTime, interval = '1d', limit = 48, startTime } = options;
    return this.axiosService.get('/klines', {
      params: {
        ...(startTime !== undefined ? { startTime } : {}),
        ...(endTime !== undefined ? { endTime } : {}),
        symbol,
        interval,
        limit,
      },
    });
  }
}

export function createFuturesMarketRepository() {
  return new FuturesMarketRepositoryImpl(new AxiosService({ baseURL: getBinanceFuturesBaseUrl(BASE_API_BINANCE()) }));
}
