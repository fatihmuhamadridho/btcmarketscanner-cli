import { createFuturesMarketRepository } from '../infrastructure/futuresMarket.repository.impl.js';
import { GetFuturesMarketOverviewUseCase, GetFuturesMarketOlderCandlesUseCase, GetFuturesMarketInitialCandlesUseCase, GetFuturesMarketSymbolSnapshotUseCase, GetFuturesMarketSymbolDetailUseCase, } from './futuresMarket.usecase.js';
export class FuturesMarketController {
    getFuturesMarketOverviewUseCase;
    getFuturesMarketSymbolDetailUseCase;
    getFuturesMarketSymbolSnapshotUseCase;
    getFuturesMarketInitialCandlesUseCase;
    getFuturesMarketOlderCandlesUseCase;
    constructor() {
        const repository = createFuturesMarketRepository();
        this.getFuturesMarketOverviewUseCase = new GetFuturesMarketOverviewUseCase(repository);
        this.getFuturesMarketSymbolDetailUseCase = new GetFuturesMarketSymbolDetailUseCase(repository);
        this.getFuturesMarketSymbolSnapshotUseCase = new GetFuturesMarketSymbolSnapshotUseCase(repository);
        this.getFuturesMarketInitialCandlesUseCase = new GetFuturesMarketInitialCandlesUseCase(repository);
        this.getFuturesMarketOlderCandlesUseCase = new GetFuturesMarketOlderCandlesUseCase(repository);
    }
    getMarketOverview() { return this.getFuturesMarketOverviewUseCase.execute(); }
    getMarketSymbolDetail(symbol, interval = '1d') { return this.getFuturesMarketSymbolDetailUseCase.execute(symbol, interval); }
    getMarketSymbolSnapshot(symbol) { return this.getFuturesMarketSymbolSnapshotUseCase.execute(symbol); }
    getMarketInitialCandles(symbol, interval = '1d', limit = 500) { return this.getFuturesMarketInitialCandlesUseCase.execute(symbol, interval, limit); }
    getOlderMarketCandles(symbol, beforeOpenTime, interval = '1d', limit = 48) { return this.getFuturesMarketOlderCandlesUseCase.execute(symbol, beforeOpenTime, interval, limit); }
}
