import { BASE_API_BINANCE } from '@configs/base.config';
import { AxiosService } from '@services/axios.service';
import { FuturesExchangeInfoRepositoryImpl } from '../infrastructure/futuresExchangeInfo.repository.impl';
import { GetFuturesExchangeInfoSummaryUseCase } from './futuresExchangeInfo.usecase';

export class FuturesExchangeInfoController {
  private readonly getFuturesExchangeInfoSummaryUseCase: GetFuturesExchangeInfoSummaryUseCase;

  constructor() {
    const axiosService = new AxiosService({ baseURL: BASE_API_BINANCE() });
    const repository = new FuturesExchangeInfoRepositoryImpl(axiosService);
    this.getFuturesExchangeInfoSummaryUseCase = new GetFuturesExchangeInfoSummaryUseCase(repository);
  }

  getExchangeInfoSummary() {
    return this.getFuturesExchangeInfoSummaryUseCase.execute();
  }
}
