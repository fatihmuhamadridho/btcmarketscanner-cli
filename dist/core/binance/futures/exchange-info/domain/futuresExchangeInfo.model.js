export class FuturesExchangeInfo {
    exchangeFilters;
    rateLimits;
    assets;
    symbols;
    timezone;
    constructor(props) {
        Object.assign(this, props);
        this.exchangeFilters ??= [];
        this.rateLimits ??= [];
        this.assets ??= [];
        this.symbols ??= [];
        this.timezone ??= 'UTC';
    }
    get requestWeightLimit() {
        return this.rateLimits?.find((rateLimit) => rateLimit.rateLimitType === 'REQUEST_WEIGHT')?.limit ?? null;
    }
    get orderLimit() {
        return this.rateLimits?.find((rateLimit) => rateLimit.rateLimitType === 'ORDERS')?.limit ?? null;
    }
    get tradingSymbols() {
        return this.symbols?.filter((symbol) => symbol.status === 'TRADING') ?? [];
    }
    get perpetualSymbolCount() {
        return this.symbols?.filter((symbol) => symbol.contractType === 'PERPETUAL').length ?? 0;
    }
    get summary() {
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
