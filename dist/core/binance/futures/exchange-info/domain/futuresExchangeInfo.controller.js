import { BASE_API_BINANCE } from '../../../../../configs/base.config.js';
import { AxiosService } from '../../../../../services/axios.service.js';
import { FuturesExchangeInfoRepositoryImpl } from '../infrastructure/futuresExchangeInfo.repository.impl.js';
import { GetFuturesExchangeInfoSummaryUseCase } from './futuresExchangeInfo.usecase.js';
export class FuturesExchangeInfoController {
    getFuturesExchangeInfoSummaryUseCase;
    constructor() {
        const axiosService = new AxiosService({ baseURL: BASE_API_BINANCE });
        const repository = new FuturesExchangeInfoRepositoryImpl(axiosService);
        this.getFuturesExchangeInfoSummaryUseCase = new GetFuturesExchangeInfoSummaryUseCase(repository);
    }
    getExchangeInfoSummary() {
        return this.getFuturesExchangeInfoSummaryUseCase.execute();
    }
}
