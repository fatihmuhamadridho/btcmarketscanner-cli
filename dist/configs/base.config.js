import { createDefaultConfig, getBinanceWebsocketBaseUrl, } from './app-config.js';
let runtimeConfig = createDefaultConfig();
function isDevelopmentMode() {
    return process.env.NODE_ENV?.trim().toLowerCase() === 'development';
}
export function getRuntimeMode() {
    return isDevelopmentMode() ? 'development' : 'production';
}
export function setRuntimeConfig(config) {
    runtimeConfig = config;
}
export function getRuntimeConfig() {
    return runtimeConfig;
}
export function APP_VERSION() {
    return process.env.APP_VERSION;
}
export function BASE_API_BINANCE() {
    return process.env.BASE_API_BINANCE ?? 'https://fapi.binance.com/fapi/v1';
}
export function BASE_API_WEBSOCKET_BINANCE() {
    return process.env.BASE_API_WEBSOCKET_BINANCE ?? getBinanceWebsocketBaseUrl();
}
export function BINANCE_API_KEY() {
    const envValue = isDevelopmentMode() ? process.env.BINANCE_API_KEY?.trim() : '';
    return envValue || runtimeConfig.auth.profiles.binance.api_key;
}
export function BINANCE_SECRET_KEY() {
    const envValue = isDevelopmentMode() ? process.env.BINANCE_SECRET_KEY?.trim() : '';
    return envValue || runtimeConfig.auth.profiles.binance.secret_key;
}
export function HAS_BINANCE_CREDENTIALS() {
    return Boolean(BINANCE_API_KEY() && BINANCE_SECRET_KEY());
}
export function getBinanceCredentialSource() {
    if (isDevelopmentMode() && process.env.BINANCE_API_KEY?.trim() && process.env.BINANCE_SECRET_KEY?.trim()) {
        return 'env';
    }
    if (runtimeConfig.auth.profiles.binance.api_key.trim() && runtimeConfig.auth.profiles.binance.secret_key.trim()) {
        return 'json';
    }
    return 'missing';
}
export function getBinanceProfileLabel() {
    return 'Binance';
}
