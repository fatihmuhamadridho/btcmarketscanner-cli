import { FuturesExchangeInfo } from './futuresExchangeInfo.model.js';
export class GetFuturesExchangeInfoUseCase {
    futuresExchangeInfoRepository;
    constructor(futuresExchangeInfoRepository) {
        this.futuresExchangeInfoRepository = futuresExchangeInfoRepository;
    }
    async execute() {
        const response = await this.futuresExchangeInfoRepository.getExchangeInfo();
        return { data: new FuturesExchangeInfo(response) };
    }
}
export class GetFuturesExchangeInfoSummaryUseCase {
    futuresExchangeInfoRepository;
    constructor(futuresExchangeInfoRepository) {
        this.futuresExchangeInfoRepository = futuresExchangeInfoRepository;
    }
    async execute() {
        const response = await this.futuresExchangeInfoRepository.getExchangeInfo();
        const exchangeInfo = new FuturesExchangeInfo(response);
        return { data: exchangeInfo.summary };
    }
}
