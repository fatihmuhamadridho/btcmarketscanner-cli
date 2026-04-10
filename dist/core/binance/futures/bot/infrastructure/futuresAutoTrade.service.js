import { createHmac, randomUUID } from 'crypto';
import { BASE_API_BINANCE, BINANCE_API_KEY, BINANCE_SECRET_KEY } from '../../../../../configs/base.config.js';
import { getBinanceFuturesBaseUrl } from '../../../../../configs/binance-futures-url.js';
import { FuturesMarketController } from '../../market/domain/futuresMarket.controller.js';
const futuresMarketController = new FuturesMarketController();
function buildBaseUrl() { return getBinanceFuturesBaseUrl(BASE_API_BINANCE()); }
function signQueryString(queryString) { return createHmac('sha256', BINANCE_SECRET_KEY() ?? '').update(queryString).digest('hex'); }
function roundDownToStep(value, step) { if (!Number.isFinite(value) || !Number.isFinite(step) || step <= 0)
    return value; const precision = Math.max(0, (step.toString().split('.')[1]?.length ?? 0) + 2); return Number((Math.floor(value / step) * step).toFixed(precision)); }
function normalizePrice(value, tickSize, precision) { if (Number.isFinite(tickSize) && tickSize > 0)
    return roundDownToStep(value, tickSize); if (typeof precision === 'number' && precision >= 0)
    return Number(value.toFixed(precision)); return value; }
function parseNumber(value) { if (!value)
    return null; const parsed = Number(value); return Number.isFinite(parsed) ? parsed : null; }
function pickSymbolRule(symbolInfo, filterType) { return symbolInfo?.filters?.find((item) => item.filterType === filterType) ?? null; }
function extractStepSize(symbolInfo) { const lotSize = pickSymbolRule(symbolInfo, 'LOT_SIZE'); const marketLotSize = pickSymbolRule(symbolInfo, 'MARKET_LOT_SIZE'); return parseNumber(marketLotSize?.stepSize ?? lotSize?.stepSize) ?? 0.001; }
function extractTickSize(symbolInfo) { return parseNumber(pickSymbolRule(symbolInfo, 'PRICE_FILTER')?.tickSize) ?? 0.01; }
function splitTakeProfitQuantityByWeights(totalQuantity, stepSize, weights) { if (weights.length === 0)
    return []; const totalWeight = weights.reduce((sum, weight) => sum + weight, 0); if (totalWeight <= 0)
    return weights.map(() => 0); const normalizedWeights = weights.map((weight) => weight / totalWeight); const quantities = []; let remainingQuantity = totalQuantity; normalizedWeights.forEach((weight, index) => { const isLast = index === normalizedWeights.length - 1; const quantity = isLast ? roundDownToStep(remainingQuantity, stepSize) : roundDownToStep(totalQuantity * weight, stepSize); quantities.push(quantity); remainingQuantity = Math.max(0, remainingQuantity - quantity); }); return quantities; }
function createClientAlgoId(symbol, suffix) { const randomPart = randomUUID().replace(/-/g, '').slice(0, 8); return `${symbol}-${suffix}-${randomPart}`.slice(0, 32); }
function isProtectionOrderType(type) { return Boolean(type && (type.includes('STOP') || type.includes('TAKE_PROFIT'))); }
function matchesPositionSide(orderPositionSide, positionSide) { return !positionSide || positionSide === 'BOTH' ? true : orderPositionSide === positionSide || orderPositionSide === 'BOTH'; }
function getEntryLimitPrice(plan, currentPrice) { return plan.entryMid ?? (plan.direction === 'long' ? plan.entryZone.high : plan.entryZone.low) ?? currentPrice; }
export class FuturesAutoTradeService {
    async request(path, options = {}) { if (!BINANCE_API_KEY() || !BINANCE_SECRET_KEY())
        throw new Error('Binance credentials are missing.'); const { method = 'GET', params = {}, signed = false } = options; const url = new URL(path, buildBaseUrl()); const searchParams = new URLSearchParams(); Object.entries(params).forEach(([key, value]) => { if (value === undefined || value === null)
        return; searchParams.set(key, String(value)); }); if (signed) {
        searchParams.set('recvWindow', '5000');
        searchParams.set('timestamp', String(Date.now()));
        searchParams.set('signature', signQueryString(searchParams.toString()));
    } url.search = searchParams.toString(); const response = await fetch(url.toString(), { method, headers: { 'Content-Type': 'application/json', 'X-MBX-APIKEY': BINANCE_API_KEY(), 'User-Agent': 'binance-algo/1.1.0 (Skill)', Accept: 'application/json' } }); if (!response.ok) {
        const errorText = await response.text();
        throw new Error(errorText || `Binance request failed with status ${response.status}`);
    } return (await response.json()); }
    getAccount() { return this.request('/fapi/v2/account', { signed: true }); }
    getOpenPositions(symbol) { return this.request('/fapi/v2/positionRisk', { params: symbol ? { symbol } : undefined, signed: true }); }
    getOpenOrders(symbol) { return Promise.all([this.request('/fapi/v1/openOrders', { params: { symbol }, signed: true }), this.request('/fapi/v1/openAlgoOrders', { params: { symbol }, signed: true })]); }
    async getRealizedPnlHistory(symbol, limit = 20) { const history = await this.request('/fapi/v1/income', { params: { incomeType: 'REALIZED_PNL', limit: Math.max(1, Math.trunc(limit)), symbol }, signed: true }); return history.filter((item) => item.symbol === symbol && item.incomeType === 'REALIZED_PNL').map((item) => ({ asset: item.asset ?? 'USDT', income: parseNumber(item.income ?? null), info: item.info ?? 'n/a', symbol: item.symbol ?? symbol, time: typeof item.time === 'number' && Number.isFinite(item.time) ? item.time : null, tranId: typeof item.tranId === 'number' && Number.isFinite(item.tranId) ? item.tranId : null })).filter((item) => item.income !== null && item.time !== null); }
    getCurrentPrice(symbol) { return this.request('/fapi/v1/ticker/price', { params: { symbol } }); }
    async closePosition(symbol, positionSide) { const symbolInfo = await this.getSymbolInfo(symbol); const stepSize = extractStepSize(symbolInfo ?? undefined); const [account] = await Promise.all([this.getAccount()]); const dualSidePosition = Boolean(account.dualSidePosition); const resolveTargetPosition = async () => (await this.getOpenPositions(symbol)).find((position) => { if (position.symbol !== symbol || parseNumber(position.positionAmt) === 0)
        return false; if (!positionSide || positionSide === 'BOTH')
        return true; const rawQuantity = parseNumber(position.positionAmt) ?? 0; return dualSidePosition ? position.positionSide === positionSide : positionSide === 'LONG' ? rawQuantity > 0 : rawQuantity < 0; }) ?? null; let targetPosition = await resolveTargetPosition(); if (!targetPosition)
        throw new Error(`No open position found for ${symbol}.`); await this.cancelProtectionOrders(symbol, targetPosition.positionSide ?? positionSide ?? 'BOTH'); let lastOrderResponse = null; for (let attempt = 0; attempt < 2; attempt += 1) {
        targetPosition = await resolveTargetPosition();
        if (!targetPosition)
            break;
        const rawQuantity = Math.abs(parseNumber(targetPosition.positionAmt) ?? 0);
        const quantity = roundDownToStep(rawQuantity, stepSize);
        if (quantity <= 0)
            break;
        const exitSide = (parseNumber(targetPosition.positionAmt) ?? 0) > 0 ? 'SELL' : 'BUY';
        lastOrderResponse = await this.request('/fapi/v1/order', { method: 'POST', params: { symbol, side: exitSide, type: 'MARKET', quantity, ...(dualSidePosition ? { positionSide: targetPosition.positionSide ?? positionSide ?? 'BOTH' } : { reduceOnly: true }), newOrderRespType: 'RESULT' }, signed: true });
        await new Promise((resolve) => setTimeout(resolve, 250));
    } if (!lastOrderResponse)
        throw new Error(`Unable to close position for ${symbol}.`); await this.cancelProtectionOrders(symbol, positionSide ?? 'BOTH'); return lastOrderResponse; }
    async cancelProtectionOrders(symbol, positionSide) { const [regularOrders, algoOrders] = await this.getOpenOrders(symbol); await Promise.allSettled([...regularOrders.filter((order) => isProtectionOrderType(order.type) && matchesPositionSide(order.positionSide, positionSide)).map((order) => this.cancelOpenOrder(symbol, { mode: 'Regular', clientOrderId: order.clientOrderId ?? null, orderId: order.orderId })), ...algoOrders.filter((order) => (order.reduceOnly === true || isProtectionOrderType(order.type) || order.closePosition === true) && matchesPositionSide(order.positionSide, positionSide)).map((order) => this.cancelOpenOrder(symbol, { mode: 'Algo', algoId: order.algoId, clientOrderId: order.clientAlgoId ?? null }))]); }
    cancelOpenOrder(symbol, order) { return order.mode === 'Regular' ? this.request('/fapi/v1/order', { method: 'DELETE', params: { symbol, ...(order.orderId !== undefined ? { orderId: order.orderId } : {}), ...(order.clientOrderId ? { origClientOrderId: order.clientOrderId } : {}) }, signed: true }) : this.request('/fapi/v1/algoOrder', { method: 'DELETE', params: { symbol, ...(order.algoId !== undefined ? { algoId: order.algoId } : {}), ...(order.clientOrderId ? { clientAlgoId: order.clientOrderId } : {}) }, signed: true }); }
    cancelOpenOrders(symbol) { return Promise.allSettled([this.request('/fapi/v1/allOpenOrders', { method: 'DELETE', params: { symbol }, signed: true }), this.request('/fapi/v1/algoOpenOrders', { method: 'DELETE', params: { symbol }, signed: true })]).then((results) => { const rejected = results.filter((result) => result.status === 'rejected'); if (rejected.length === results.length)
        throw rejected[0]?.reason instanceof Error ? rejected[0].reason : new Error('Failed to cancel open orders.'); return results; }); }
    async placeProtectionOrders(plan, quantity, options) { const [account, symbolInfo] = await Promise.all([this.getAccount(), this.getSymbolInfo(plan.symbol)]); const stepSize = extractStepSize(symbolInfo ?? undefined); const tickSize = extractTickSize(symbolInfo ?? undefined); const takeProfitStartIndex = Math.max(0, options?.takeProfitStartIndex ?? 0); const takeProfitPlan = plan.takeProfits.slice(takeProfitStartIndex); const takeProfitPrices = takeProfitPlan.map((item) => (item.price !== null ? normalizePrice(item.price, tickSize, symbolInfo?.pricePrecision) : null)).filter((value) => value !== null); const stopLossPrice = plan.stopLoss !== null ? normalizePrice(plan.stopLoss, tickSize, symbolInfo?.pricePrecision) : null; const positionSide = account.dualSidePosition ? plan.direction === 'long' ? 'LONG' : 'SHORT' : null; const positionSideParam = positionSide ? { positionSide } : {}; const algoOrderOwnershipParam = account.dualSidePosition ? positionSideParam : { reduceOnly: true }; const exitSide = plan.direction === 'long' ? 'SELL' : 'BUY'; const stopLossAlgoOrder = stopLossPrice ? await this.request('/fapi/v1/algoOrder', { method: 'POST', params: { algoType: 'CONDITIONAL', clientAlgoId: createClientAlgoId(plan.symbol, 'sl'), quantity, side: exitSide, symbol: plan.symbol, triggerPrice: stopLossPrice, type: 'STOP_MARKET', workingType: 'MARK_PRICE', ...positionSideParam, ...algoOrderOwnershipParam }, signed: true }) : null; const takeProfitQuantities = splitTakeProfitQuantityByWeights(quantity, stepSize, [0.4, 0.3, 0.3].slice(takeProfitStartIndex)); const takeProfitAlgoOrders = []; for (let index = 0; index < takeProfitPrices.length; index += 1) {
        const takeProfitPrice = takeProfitPrices[index];
        const takeProfitQuantity = takeProfitQuantities[index];
        if (takeProfitPrice === undefined || takeProfitQuantity === undefined || takeProfitQuantity <= 0)
            continue;
        const order = await this.request('/fapi/v1/algoOrder', { method: 'POST', params: { algoType: 'CONDITIONAL', clientAlgoId: createClientAlgoId(plan.symbol, `tp${index + 1}`), quantity: takeProfitQuantity, symbol: plan.symbol, side: exitSide, triggerPrice: takeProfitPrice, type: 'TAKE_PROFIT_MARKET', workingType: 'MARK_PRICE', ...positionSideParam, ...algoOrderOwnershipParam }, signed: true });
        takeProfitAlgoOrders.push(order);
    } return { algoOrderClientIds: [stopLossAlgoOrder?.clientAlgoId ?? null, ...takeProfitAlgoOrders.map((order) => order.clientAlgoId ?? null)].filter((value) => value !== null), positionSide, stopLossAlgoOrder, takeProfitAlgoOrders }; }
    async getSymbolInfo(symbol) { const snapshot = await futuresMarketController.getMarketSymbolSnapshot(symbol); return snapshot.data.symbolInfo ?? null; }
    setSymbolLeverage(symbol, leverage) { return this.request('/fapi/v1/leverage', { method: 'POST', params: { leverage: Math.max(1, Math.trunc(leverage)), symbol }, signed: true }); }
    async executeTrade(plan, currentPrice) { const [account, symbolInfo] = await Promise.all([this.getAccount(), this.getSymbolInfo(plan.symbol)]); const availableBalance = parseNumber(account.availableBalance ?? account.totalWalletBalance) ?? 0; const stepSize = extractStepSize(symbolInfo ?? undefined); const tickSize = extractTickSize(symbolInfo ?? undefined); await this.setSymbolLeverage(plan.symbol, plan.leverage); const allocatedMargin = plan.allocationUnit === 'usdt' ? plan.allocationValue : availableBalance * (plan.allocationValue / 100); const notional = allocatedMargin * Math.max(plan.leverage, 1); if (!Number.isFinite(currentPrice) || currentPrice <= 0)
        throw new Error(`Invalid current price for ${plan.symbol}.`); const quantity = roundDownToStep(notional / currentPrice, stepSize); const entryPrice = getEntryLimitPrice(plan, currentPrice); const normalizedEntryPrice = normalizePrice(entryPrice, tickSize, symbolInfo?.pricePrecision); const positionSide = account.dualSidePosition ? plan.direction === 'long' ? 'LONG' : 'SHORT' : null; const entrySide = plan.direction === 'long' ? 'BUY' : 'SELL'; if (quantity <= 0)
        throw new Error('Calculated order quantity is too small for the current balance and allocation.'); const entryOrder = await this.request('/fapi/v1/order', { method: 'POST', params: { symbol: plan.symbol, side: entrySide, type: 'LIMIT', quantity, price: normalizedEntryPrice, timeInForce: 'GTC', newOrderRespType: 'RESULT', ...(positionSide ? { positionSide } : {}) }, signed: true }); const entryFilled = entryOrder.status === 'FILLED' || Number(entryOrder.executedQty ?? '0') > 0; const protectionOrders = entryFilled ? await this.placeProtectionOrders(plan, quantity) : null; return { entryOrder, entryPrice: normalizedEntryPrice, entryFilled, algoOrderClientIds: protectionOrders?.algoOrderClientIds ?? [], allocatedMargin, positionSide, quantity, stopLossAlgoOrder: protectionOrders?.stopLossAlgoOrder ?? null, takeProfitAlgoOrders: protectionOrders?.takeProfitAlgoOrders ?? [] }; }
}
export const futuresAutoTradeService = new FuturesAutoTradeService();
