import { FuturesExchangeInfo } from '../../exchange-info/domain/futuresExchangeInfo.model.js';
import { FuturesMarketOverviewItem, FuturesMarketSymbolSnapshot, FuturesMarketSymbolDetail } from './futuresMarket.model.js';
export class GetFuturesMarketOverviewUseCase {
    futuresMarketRepository;
    constructor(futuresMarketRepository) {
        this.futuresMarketRepository = futuresMarketRepository;
    }
    async execute() {
        const [exchangeInfoResponse, tickers] = await Promise.all([
            this.futuresMarketRepository.getExchangeInfo(),
            this.futuresMarketRepository.getTickers24hr(),
        ]);
        const exchangeInfo = new FuturesExchangeInfo(exchangeInfoResponse);
        const tickerMap = new Map(tickers.map((ticker) => [ticker.symbol, ticker]));
        const items = (exchangeInfo.tradingSymbols ?? [])
            .map((symbol) => {
            const ticker = tickerMap.get(symbol.symbol ?? '');
            return new FuturesMarketOverviewItem({
                baseAsset: symbol.baseAsset,
                contractType: symbol.contractType,
                pair: symbol.pair,
                quoteAsset: symbol.quoteAsset,
                status: symbol.status,
                symbol: symbol.symbol ?? '',
                ticker: ticker ?? { symbol: symbol.symbol ?? '', lastPrice: 'n/a', priceChangePercent: '0', quoteVolume: '0', volume: '0' },
            });
        })
            .filter((item) => item.symbol)
            .sort((left, right) => {
            const leftVolume = Number(left.ticker.quoteVolume ?? left.ticker.volume ?? 0);
            const rightVolume = Number(right.ticker.quoteVolume ?? right.ticker.volume ?? 0);
            return rightVolume - leftVolume;
        });
        return { data: items, exchangeInfo };
    }
}
export class GetFuturesMarketSymbolDetailUseCase {
    futuresMarketRepository;
    constructor(futuresMarketRepository) {
        this.futuresMarketRepository = futuresMarketRepository;
    }
    async execute(symbol, interval = '1d') {
        const [exchangeInfoResponse, tickers, candles] = await Promise.all([
            this.futuresMarketRepository.getExchangeInfo(),
            this.futuresMarketRepository.getTickers24hr(),
            this.futuresMarketRepository.getKlines(symbol, { interval, limit: 200 }),
        ]);
        const exchangeInfo = new FuturesExchangeInfo(exchangeInfoResponse);
        const symbolInfo = exchangeInfo.symbols?.find((item) => item.symbol === symbol);
        if (!symbolInfo)
            throw new Error(`Symbol ${symbol} not found`);
        const ticker = tickers.find((item) => item.symbol === symbol) ?? { symbol, lastPrice: 'n/a', priceChangePercent: '0', quoteVolume: '0', volume: '0' };
        const overviewItem = new FuturesMarketOverviewItem({
            baseAsset: symbolInfo.baseAsset,
            contractType: symbolInfo.contractType,
            pair: symbolInfo.pair,
            quoteAsset: symbolInfo.quoteAsset,
            status: symbolInfo.status,
            symbol,
            ticker,
        });
        return { data: new FuturesMarketSymbolDetail({ exchangeInfo, symbol: overviewItem, candles: candles.map((candle) => ({ openTime: candle[0], open: Number(candle[1]), high: Number(candle[2]), low: Number(candle[3]), close: Number(candle[4]), volume: Number(candle[5]), closeTime: candle[6], quoteAssetVolume: Number(candle[7]), numberOfTrades: candle[8] })) }) };
    }
}
export class GetFuturesMarketSymbolSnapshotUseCase {
    futuresMarketRepository;
    constructor(futuresMarketRepository) {
        this.futuresMarketRepository = futuresMarketRepository;
    }
    async execute(symbol) {
        const [exchangeInfoResponse, tickers] = await Promise.all([
            this.futuresMarketRepository.getExchangeInfo(),
            this.futuresMarketRepository.getTickers24hr(),
        ]);
        const exchangeInfo = new FuturesExchangeInfo(exchangeInfoResponse);
        const symbolInfo = exchangeInfo.symbols?.find((item) => item.symbol === symbol);
        if (!symbolInfo)
            throw new Error(`Symbol ${symbol} not found`);
        const ticker = tickers.find((item) => item.symbol === symbol) ?? { symbol, lastPrice: 'n/a', priceChangePercent: '0', quoteVolume: '0', volume: '0' };
        return { data: new FuturesMarketSymbolSnapshot({ exchangeInfo, symbol: new FuturesMarketOverviewItem({ baseAsset: symbolInfo.baseAsset, contractType: symbolInfo.contractType, pair: symbolInfo.pair, quoteAsset: symbolInfo.quoteAsset, status: symbolInfo.status, symbol, ticker }) }) };
    }
}
export class GetFuturesMarketInitialCandlesUseCase {
    futuresMarketRepository;
    constructor(futuresMarketRepository) {
        this.futuresMarketRepository = futuresMarketRepository;
    }
    async execute(symbol, interval = '1d', limit = 500) {
        const candles = await this.futuresMarketRepository.getKlines(symbol, { interval, limit });
        return { data: candles.map((candle) => ({ openTime: candle[0], open: Number(candle[1]), high: Number(candle[2]), low: Number(candle[3]), close: Number(candle[4]), volume: Number(candle[5]), closeTime: candle[6], quoteAssetVolume: Number(candle[7]), numberOfTrades: candle[8] })) };
    }
}
export class GetFuturesMarketOlderCandlesUseCase {
    futuresMarketRepository;
    constructor(futuresMarketRepository) {
        this.futuresMarketRepository = futuresMarketRepository;
    }
    async execute(symbol, beforeOpenTime, interval = '1d', limit = 200) {
        const candles = await this.futuresMarketRepository.getKlines(symbol, { interval, limit, endTime: beforeOpenTime - 1 });
        return candles.map((candle) => ({ openTime: candle[0], open: Number(candle[1]), high: Number(candle[2]), low: Number(candle[3]), close: Number(candle[4]), volume: Number(candle[5]), closeTime: candle[6], quoteAssetVolume: Number(candle[7]), numberOfTrades: candle[8] }));
    }
}
