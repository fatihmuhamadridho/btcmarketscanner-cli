import { BASE_API_BINANCE } from '../../../../../configs/base.config.js';
import { getBinanceFuturesBaseUrl } from '../../../../../configs/binance-futures-url.js';
import { AxiosService } from '../../../../../services/axios.service.js';
export class FuturesMarketRepositoryImpl {
    axiosService;
    constructor(axiosService) {
        this.axiosService = axiosService;
    }
    async getExchangeInfo() { return this.axiosService.get('/exchangeInfo'); }
    async getTickers24hr() { return this.axiosService.get('/ticker/24hr'); }
    async getKlines(symbol, options = {}) {
        const { endTime, interval = '1d', limit = 48, startTime } = options;
        return this.axiosService.get('/klines', { params: { ...(startTime !== undefined ? { startTime } : {}), ...(endTime !== undefined ? { endTime } : {}), symbol, interval, limit } });
    }
}
export function createFuturesMarketRepository() {
    return new FuturesMarketRepositoryImpl(new AxiosService({ baseURL: getBinanceFuturesBaseUrl(BASE_API_BINANCE()) }));
}
