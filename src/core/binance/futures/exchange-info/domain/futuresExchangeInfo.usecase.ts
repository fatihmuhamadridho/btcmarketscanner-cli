import { FuturesExchangeInfo } from './futuresExchangeInfo.model';
import type { FuturesExchangeInfoResponse, FuturesExchangeInfoResult, FuturesExchangeInfoSummaryResult } from './futuresExchangeInfo.interface';
import type { FuturesExchangeInfoRepository } from './futuresExchangeInfo.repository';

export class GetFuturesExchangeInfoUseCase {
  constructor(private readonly futuresExchangeInfoRepository: FuturesExchangeInfoRepository) {}

  async execute(): Promise<FuturesExchangeInfoResult> {
    const response = await this.futuresExchangeInfoRepository.getExchangeInfo();
    return { data: new FuturesExchangeInfo(response as FuturesExchangeInfoResponse) };
  }
}

export class GetFuturesExchangeInfoSummaryUseCase {
  constructor(private readonly futuresExchangeInfoRepository: FuturesExchangeInfoRepository) {}

  async execute(): Promise<FuturesExchangeInfoSummaryResult> {
    const response = await this.futuresExchangeInfoRepository.getExchangeInfo();
    const exchangeInfo = new FuturesExchangeInfo(response as FuturesExchangeInfoResponse);
    return { data: exchangeInfo.summary };
  }
}
