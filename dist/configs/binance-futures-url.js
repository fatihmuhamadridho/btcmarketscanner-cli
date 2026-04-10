const DEFAULT_DEMO_FUTURES_BASE_URL = 'https://demo-api.binance.com/api/v3';
const DEFAULT_LIVE_FUTURES_BASE_URL = 'https://fapi.binance.com/fapi/v1';
function normalizeBaseUrl(value) {
    const trimmed = value.trim().replace(/\/+$/, '');
    if (trimmed.includes('demo-api.binance.com/api/v3')) {
        return DEFAULT_DEMO_FUTURES_BASE_URL;
    }
    if (trimmed.includes('api.binance.com/api/v3')) {
        return DEFAULT_LIVE_FUTURES_BASE_URL;
    }
    if (trimmed.includes('demo-fapi.binance.com')) {
        return trimmed.includes('/fapi/v1') ? trimmed : `${trimmed}/fapi/v1`;
    }
    if (trimmed.includes('fapi.binance.com')) {
        return trimmed.includes('/fapi/v1') ? trimmed : `${trimmed}/fapi/v1`;
    }
    return trimmed;
}
export function getBinanceFuturesBaseUrl(baseUrl) {
    if (!baseUrl || baseUrl.trim().length === 0) {
        return DEFAULT_DEMO_FUTURES_BASE_URL;
    }
    return normalizeBaseUrl(baseUrl);
}
