import { formatDecimalString } from '../../../../../utils/format-number.util.js';
export class FuturesTicker24hr {
    lastPrice;
    openPrice;
    highPrice;
    lowPrice;
    priceChange;
    priceChangePercent;
    quoteVolume;
    symbol;
    volume;
    openTime;
    closeTime;
    constructor(props) {
        Object.assign(this, props);
    }
    get displayLastPrice() {
        return formatDecimalString(this.lastPrice);
    }
    get displayChange() {
        const value = this.priceChangePercent ?? '0';
        const prefix = value.startsWith('-') ? '' : '+';
        return `${prefix}${value}%`;
    }
    get displayVolume() {
        return formatDecimalString(this.quoteVolume ?? this.volume);
    }
}
export class FuturesMarketOverviewItem {
    contractType;
    baseAsset;
    pair;
    quoteAsset;
    status;
    symbol;
    ticker;
    constructor(props) {
        this.contractType = props.contractType;
        this.baseAsset = props.baseAsset;
        this.pair = props.pair;
        this.quoteAsset = props.quoteAsset;
        this.status = props.status;
        this.symbol = props.symbol;
        this.ticker = new FuturesTicker24hr(props.ticker);
    }
    get displayName() {
        return `${this.baseAsset ?? this.symbol}/${this.quoteAsset ?? 'USDT'}`;
    }
    get isTrading() {
        return this.status === 'TRADING';
    }
}
export class FuturesMarketSymbolDetail {
    exchangeInfo;
    symbol;
    candles;
    constructor(props) {
        this.exchangeInfo = props.exchangeInfo;
        this.symbol = props.symbol;
        this.candles = props.candles;
    }
    get symbolInfo() {
        return this.exchangeInfo.symbols?.find((item) => item.symbol === this.symbol.symbol);
    }
}
export class FuturesMarketSymbolSnapshot {
    exchangeInfo;
    symbol;
    constructor(props) {
        this.exchangeInfo = props.exchangeInfo;
        this.symbol = props.symbol;
    }
    get symbolInfo() {
        return this.exchangeInfo.symbols?.find((item) => item.symbol === this.symbol.symbol);
    }
}
