import { AxiosService } from '@services/axios.service';
import type { FuturesExchangeInfoRepository } from '../domain/futuresExchangeInfo.repository';
import type { FuturesExchangeInfoResponse } from '../domain/futuresExchangeInfo.interface';

export class FuturesExchangeInfoRepositoryImpl implements FuturesExchangeInfoRepository {
  constructor(private readonly axiosService: AxiosService) {}

  async getExchangeInfo(): Promise<FuturesExchangeInfoResponse> {
    return this.axiosService.get('/exchangeInfo');
  }
}
