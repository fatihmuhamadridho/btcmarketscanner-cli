type FuturesExchangeRateLimitProps = {
  interval?: string;
  intervalNum?: number;
  limit?: number;
  rateLimitType?: string;
};

type FuturesExchangeAssetProps = {
  asset?: string;
  autoAssetExchange?: string | null;
  marginAvailable?: boolean;
};

type FuturesExchangeSymbolProps = {
  baseAsset?: string;
  baseAssetPrecision?: number;
  contractType?: string;
  deliveryDate?: number;
  filters?: Array<Record<string, unknown> & { filterType?: string }>;
  liquidationFee?: string;
  maintMarginPercent?: string;
  marginAsset?: string;
  marketTakeBound?: string;
  onboardDate?: number;
  orderTypes?: string[];
  pair?: string;
  pricePrecision?: number;
  quantityPrecision?: number;
  quoteAssetPrecision?: number;
  quoteAsset?: string;
  quotePrecision?: number;
  settlePlan?: number;
  requiredMarginPercent?: string;
  status?: string;
  symbol?: string;
  timeInForce?: string[];
  triggerProtect?: string;
  underlyingSubType?: string[];
  underlyingType?: string;
};

type FuturesExchangeInfoProps = {
  exchangeFilters?: unknown[];
  rateLimits?: FuturesExchangeRateLimitProps[];
  assets?: FuturesExchangeAssetProps[];
  symbols?: FuturesExchangeSymbolProps[];
  timezone?: string;
};

export type FuturesExchangeInfoSummary = {
  assetCount: number;
  featuredAssets: string[];
  featuredSymbols: string[];
  marginAvailableAssetCount: number;
  orderLimit: number | null;
  perpetualSymbolCount: number;
  requestWeightLimit: number | null;
  symbolCount: number;
  tradingSymbolCount: number;
  timezone: string;
};

export class FuturesExchangeInfo implements FuturesExchangeInfoProps {
  exchangeFilters?: FuturesExchangeInfoProps['exchangeFilters'];
  rateLimits?: FuturesExchangeRateLimitProps[];
  assets?: FuturesExchangeAssetProps[];
  symbols?: FuturesExchangeSymbolProps[];
  timezone?: string;

  constructor(props?: FuturesExchangeInfoProps) {
    Object.assign(this, props);
    this.exchangeFilters ??= [];
    this.rateLimits ??= [];
    this.assets ??= [];
    this.symbols ??= [];
    this.timezone ??= 'UTC';
  }

  get requestWeightLimit(): number | null {
    return this.rateLimits?.find((rateLimit) => rateLimit.rateLimitType === 'REQUEST_WEIGHT')?.limit ?? null;
  }

  get orderLimit(): number | null {
    return this.rateLimits?.find((rateLimit) => rateLimit.rateLimitType === 'ORDERS')?.limit ?? null;
  }

  get tradingSymbols() {
    return this.symbols?.filter((symbol) => symbol.status === 'TRADING') ?? [];
  }

  get perpetualSymbolCount(): number {
    return this.symbols?.filter((symbol) => symbol.contractType === 'PERPETUAL').length ?? 0;
  }

  get summary(): FuturesExchangeInfoSummary {
    const tradingSymbols = this.tradingSymbols;
    const marginAvailableAssets = this.assets?.filter((asset) => asset.marginAvailable) ?? [];

    return {
      assetCount: this.assets?.length ?? 0,
      featuredAssets: (this.assets ?? []).slice(0, 6).map((asset) => asset.asset ?? ''),
      featuredSymbols: tradingSymbols.slice(0, 6).map((symbol) => symbol.symbol ?? ''),
      marginAvailableAssetCount: marginAvailableAssets.length,
      orderLimit: this.orderLimit,
      perpetualSymbolCount: this.perpetualSymbolCount,
      requestWeightLimit: this.requestWeightLimit,
      symbolCount: this.symbols?.length ?? 0,
      tradingSymbolCount: tradingSymbols.length,
      timezone: this.timezone ?? 'UTC',
    };
  }
}
