export const APP_VERSION = process.env.APP_VERSION;
export const BASE_API_BINANCE = process.env.BASE_API_BINANCE;
export const BASE_API_WEBSOCKET_BINANCE = process.env.BASE_API_WEBSOCKET_BINANCE;
export const BINANCE_API_KEY = process.env.BINANCE_API_KEY;
export const BINANCE_SECRET_KEY = process.env.BINANCE_SECRET_KEY;
export const HAS_BINANCE_CREDENTIALS = Boolean(BINANCE_API_KEY && BINANCE_SECRET_KEY);
