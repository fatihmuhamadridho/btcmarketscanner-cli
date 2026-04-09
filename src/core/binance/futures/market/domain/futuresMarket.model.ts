import type { FuturesExchangeInfo } from '../../exchange-info/domain/futuresExchangeInfo.model';
import { formatDecimalString } from '@utils/format-number.util';

export type FuturesTicker24hrProps = {
  lastPrice?: string;
  openPrice?: string;
  highPrice?: string;
  lowPrice?: string;
  priceChange?: string;
  priceChangePercent?: string;
  quoteVolume?: string;
  symbol: string;
  volume?: string;
  openTime?: number;
  closeTime?: number;
};

export class FuturesTicker24hr implements FuturesTicker24hrProps {
  lastPrice?: string;
  openPrice?: string;
  highPrice?: string;
  lowPrice?: string;
  priceChange?: string;
  priceChangePercent?: string;
  quoteVolume?: string;
  symbol!: string;
  volume?: string;
  openTime?: number;
  closeTime?: number;

  constructor(props: FuturesTicker24hrProps) {
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

export type FuturesMarketOverviewItemProps = {
  contractType?: string;
  baseAsset?: string;
  pair?: string;
  quoteAsset?: string;
  status?: string;
  symbol: string;
  ticker: FuturesTicker24hrProps;
};

export class FuturesMarketOverviewItem implements FuturesMarketOverviewItemProps {
  contractType?: string;
  baseAsset?: string;
  pair?: string;
  quoteAsset?: string;
  status?: string;
  symbol: string;
  ticker: FuturesTicker24hr;

  constructor(props: FuturesMarketOverviewItemProps) {
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

export type FuturesKlineCandle = {
  close: number;
  closeTime: number;
  high: number;
  low: number;
  numberOfTrades?: number;
  open: number;
  openTime: number;
  quoteAssetVolume?: number;
  volume: number;
};

export type FuturesMarketSymbolDetailProps = {
  exchangeInfo: FuturesExchangeInfo;
  symbol: FuturesMarketOverviewItem;
  candles: FuturesKlineCandle[];
};

export class FuturesMarketSymbolDetail implements FuturesMarketSymbolDetailProps {
  exchangeInfo: FuturesExchangeInfo;
  symbol: FuturesMarketOverviewItem;
  candles: FuturesKlineCandle[];

  constructor(props: FuturesMarketSymbolDetailProps) {
    this.exchangeInfo = props.exchangeInfo;
    this.symbol = props.symbol;
    this.candles = props.candles;
  }

  get symbolInfo() {
    return this.exchangeInfo.symbols?.find((item) => item.symbol === this.symbol.symbol);
  }
}

export type FuturesMarketSymbolSnapshotProps = {
  exchangeInfo: FuturesExchangeInfo;
  symbol: FuturesMarketOverviewItem;
};

export class FuturesMarketSymbolSnapshot implements FuturesMarketSymbolSnapshotProps {
  exchangeInfo: FuturesExchangeInfo;
  symbol: FuturesMarketOverviewItem;

  constructor(props: FuturesMarketSymbolSnapshotProps) {
    this.exchangeInfo = props.exchangeInfo;
    this.symbol = props.symbol;
  }

  get symbolInfo() {
    return this.exchangeInfo.symbols?.find((item) => item.symbol === this.symbol.symbol);
  }
}
