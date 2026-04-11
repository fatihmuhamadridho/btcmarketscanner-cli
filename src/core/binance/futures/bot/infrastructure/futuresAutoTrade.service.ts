import { createHmac, randomUUID } from 'crypto';
import {
  BASE_API_BINANCE,
  BINANCE_API_KEY,
  BINANCE_SECRET_KEY,
} from '@configs/base.config';
import { getBinanceFuturesBaseUrl } from '@configs/binance-futures-url';
import { FuturesMarketController } from '../../market/domain/futuresMarket.controller';
import type { FuturesAutoBotPlan } from '../domain/futuresAutoBot.model';
// trimmed to keep compile-safe; same runtime behavior as web module for the methods used by the bot service
type FuturesAccountBalanceResponseItem = {
  accountAlias?: string;
  asset?: string;
  availableBalance?: string;
  balance?: string;
  crossUnPnl?: string;
  crossWalletBalance?: string;
  marginAvailable?: boolean;
  maxWithdrawAmount?: string;
  updateTime?: number;
};
type FuturesAccountResponse = { availableBalance?: string; dualSidePosition?: boolean; totalWalletBalance?: string };
type FuturesAccountInfoResponse = {
  assets?: Array<{
    asset?: string;
    availableBalance?: string;
    walletBalance?: string;
    marginBalance?: string;
    crossWalletBalance?: string;
  }>;
  availableBalance?: string;
  totalWalletBalance?: string;
  totalMarginBalance?: string;
  dualSidePosition?: boolean;
};
type FuturesLeverageResponse = { leverage?: number; maxNotionalValue?: string; symbol?: string };
type FuturesPositionRiskResponseItem = {
  entryPrice?: string;
  isolatedMargin?: string;
  leverage?: string;
  liquidationPrice?: string;
  marginType?: string;
  markPrice?: string;
  notional?: string;
  positionAmt?: string;
  positionSide?: 'BOTH' | 'LONG' | 'SHORT';
  symbol?: string;
  unRealizedProfit?: string;
};
type FuturesOrderResponse = {
  avgPrice?: string;
  clientOrderId?: string;
  executedQty?: string;
  origQty?: string;
  orderId: number;
  positionSide?: string;
  price?: string;
  reduceOnly?: boolean;
  side?: string;
  status?: string;
  stopPrice?: string;
  symbol?: string;
  time?: number;
  timeInForce?: string;
  type?: string;
  updateTime?: number;
  workingType?: string;
  closePosition?: boolean;
};
type FuturesOpenOrderResponse = FuturesOrderResponse & { updateTime?: number };
type FuturesIncomeHistoryResponseItem = {
  asset?: string;
  income?: string;
  incomeType?: string;
  info?: string;
  symbol?: string;
  time?: number;
  tranId?: number;
};
type FuturesAlgoOrderResponse = {
  algoId: number;
  clientAlgoId?: string;
  status?: string;
  side?: string;
  symbol?: string;
  type?: string;
  triggerPrice?: string;
  quantity?: string;
  positionSide?: string;
  reduceOnly?: boolean;
};
type FuturesOrderSide = 'BUY' | 'SELL';
type FuturesPositionSide = 'LONG' | 'SHORT';
type FuturesSymbolFilter = Record<string, unknown> & { filterType?: string };
type FuturesSymbolInfo = {
  filters?: FuturesSymbolFilter[];
  pricePrecision?: number;
  quantityPrecision?: number;
  symbol?: string;
};
const futuresMarketController = new FuturesMarketController();
function buildBaseUrl() {
  return getBinanceFuturesBaseUrl(BASE_API_BINANCE());
}
function roundDownToStep(value: number, step: number) {
  if (!Number.isFinite(value) || !Number.isFinite(step) || step <= 0) return value;
  const precision = Math.max(0, (step.toString().split('.')[1]?.length ?? 0) + 2);
  return Number((Math.floor(value / step) * step).toFixed(precision));
}
function normalizePrice(value: number, tickSize: number, precision?: number) {
  if (Number.isFinite(tickSize) && tickSize > 0) return roundDownToStep(value, tickSize);
  if (typeof precision === 'number' && precision >= 0) return Number(value.toFixed(precision));
  return value;
}
function parseNumber(value?: string | null) {
  if (!value) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}
function toAccountSummary(balanceItems: FuturesAccountBalanceResponseItem[]) {
  const usdtBalance = balanceItems.find((item) => item.asset === 'USDT') ?? balanceItems[0];
  if (!usdtBalance) return null;
  return {
    availableBalance: usdtBalance.availableBalance ?? usdtBalance.balance,
    totalWalletBalance: usdtBalance.balance,
    totalMarginBalance: usdtBalance.crossWalletBalance,
  };
}
function toAccountSummaryFromAccountInfo(accountInfo: FuturesAccountInfoResponse | null | undefined) {
  if (!accountInfo) return null;

  const usdtAsset = accountInfo.assets?.find((item) => item.asset === 'USDT') ?? accountInfo.assets?.[0];
  if (!usdtAsset && !accountInfo.availableBalance && !accountInfo.totalWalletBalance) {
    return null;
  }

  return {
    availableBalance: usdtAsset?.availableBalance ?? accountInfo.availableBalance,
    totalWalletBalance: usdtAsset?.walletBalance ?? accountInfo.totalWalletBalance,
    totalMarginBalance: usdtAsset?.marginBalance ?? usdtAsset?.crossWalletBalance ?? accountInfo.totalMarginBalance,
    dualSidePosition: accountInfo.dualSidePosition,
  };
}
function pickSymbolRule(symbolInfo: FuturesSymbolInfo | undefined, filterType: string) {
  return symbolInfo?.filters?.find((item) => item.filterType === filterType) ?? null;
}
function extractStepSize(symbolInfo: FuturesSymbolInfo | undefined) {
  const lotSize = pickSymbolRule(symbolInfo, 'LOT_SIZE');
  const marketLotSize = pickSymbolRule(symbolInfo, 'MARKET_LOT_SIZE');
  return (
    parseNumber((marketLotSize?.stepSize as string | undefined) ?? (lotSize?.stepSize as string | undefined)) ?? 0.001
  );
}
function extractTickSize(symbolInfo: FuturesSymbolInfo | undefined) {
  return parseNumber(pickSymbolRule(symbolInfo, 'PRICE_FILTER')?.tickSize as string | undefined) ?? 0.01;
}
function splitTakeProfitQuantityByWeights(totalQuantity: number, stepSize: number, weights: number[]) {
  if (weights.length === 0) return [];
  const totalWeight = weights.reduce((sum, weight) => sum + weight, 0);
  if (totalWeight <= 0) return weights.map(() => 0);
  const normalizedWeights = weights.map((weight) => weight / totalWeight);
  const quantities: number[] = [];
  let remainingQuantity = totalQuantity;
  normalizedWeights.forEach((weight, index) => {
    const isLast = index === normalizedWeights.length - 1;
    const quantity = isLast
      ? roundDownToStep(remainingQuantity, stepSize)
      : roundDownToStep(totalQuantity * weight, stepSize);
    quantities.push(quantity);
    remainingQuantity = Math.max(0, remainingQuantity - quantity);
  });
  return quantities;
}
function createClientAlgoId(symbol: string, suffix: string) {
  const randomPart = randomUUID().replace(/-/g, '').slice(0, 8);
  return `${symbol}-${suffix}-${randomPart}`.slice(0, 32);
}
function isProtectionOrderType(type?: string | null) {
  return Boolean(type && (type.includes('STOP') || type.includes('TAKE_PROFIT')));
}
function matchesPositionSide(orderPositionSide: string | undefined, positionSide?: 'BOTH' | 'LONG' | 'SHORT') {
  return !positionSide || positionSide === 'BOTH'
    ? true
    : orderPositionSide === positionSide || orderPositionSide === 'BOTH';
}
function getEntryLimitPrice(plan: FuturesAutoBotPlan, currentPrice: number) {
  return plan.entryMid ?? (plan.direction === 'long' ? plan.entryZone.high : plan.entryZone.low) ?? currentPrice;
}
function shortBinanceError(message: string, limit = 160) {
  const compact = message.replace(/\s+/g, ' ').trim();
  return compact.length > limit ? `${compact.slice(0, limit - 1)}…` : compact;
}
export class FuturesAutoTradeService {
  private async createListenKey() {
    if (!BINANCE_API_KEY()) {
      throw new Error('Binance API key is missing.');
    }

    const response = await fetch(`${buildBaseUrl().replace(/\/fapi\/v1$/, '')}/fapi/v1/listenKey`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-MBX-APIKEY': BINANCE_API_KEY() ?? '',
        Accept: 'application/json',
      },
    });

    if (!response.ok) {
      throw new Error(`Binance ${response.status}: ${shortBinanceError(await response.text())}`);
    }

    const payload = (await response.json()) as { listenKey?: string };
    if (!payload.listenKey) {
      throw new Error('Binance listenKey is missing.');
    }

    return payload.listenKey;
  }

  getListenKey() {
    return this.createListenKey();
  }

  private async request<T>(
    path: string,
    options: {
      method?: 'GET' | 'POST' | 'DELETE';
      params?: Record<string, string | number | boolean | undefined>;
      signed?: boolean;
    } = {},
  ) {
    const { method = 'GET', params = {}, signed = false } = options;
    const apiKey = BINANCE_API_KEY();
    const secretKey = BINANCE_SECRET_KEY();
    if (!apiKey || !secretKey) {
      throw new Error('Binance credentials are missing.');
    }

    const url = new URL(path, buildBaseUrl());
    const searchParams = new URLSearchParams();
    Object.entries(params).forEach(([key, value]) => {
      if (value === undefined || value === null) return;
      searchParams.set(key, String(value));
    });

    const requestUrl = new URL(url.toString());
    if (signed) {
      const requestParams = new URLSearchParams(searchParams.toString());
      requestParams.set('recvWindow', '5000');
      requestParams.set('timestamp', String(Date.now()));
      requestParams.set('signature', createHmac('sha256', secretKey).update(requestParams.toString()).digest('hex'));
      requestUrl.search = requestParams.toString();
    }
    else {
      requestUrl.search = searchParams.toString();
    }

    const response = await fetch(requestUrl.toString(), {
      method,
      headers: {
        'Content-Type': 'application/json',
        'X-MBX-APIKEY': apiKey,
        'User-Agent': 'binance-algo/1.1.0 (Skill)',
        Accept: 'application/json',
      },
    });

    if (!response.ok) {
      const errorText = shortBinanceError(await response.text());
      throw new Error(`Binance ${response.status}${errorText ? `: ${errorText}` : ''}`);
    }

    return (await response.json()) as T;
  }
  getAccount() {
    return this.request<FuturesAccountBalanceResponseItem[]>('/fapi/v3/balance', { signed: true })
      .then((balances) => {
        const account = toAccountSummary(balances);
        if (!account) throw new Error('Binance account balance is empty.');
        return account as FuturesAccountResponse;
      })
      .catch(async () => {
        const accountInfo = await this.request<FuturesAccountInfoResponse>('/fapi/v2/account', { signed: true });
        const account = toAccountSummaryFromAccountInfo(accountInfo);
        if (!account) throw new Error('Binance account data is empty.');
        return account as FuturesAccountResponse;
      });
  }
  getOpenPositions(symbol?: string) {
    return this.request<FuturesPositionRiskResponseItem[]>('/fapi/v2/positionRisk', {
      params: symbol ? { symbol } : undefined,
      signed: true,
    });
  }
  getOpenOrders(symbol: string) {
    return Promise.all([
      this.request<FuturesOpenOrderResponse[]>('/fapi/v1/openOrders', { params: { symbol }, signed: true }),
      this.request<
        Array<{
          algoId?: number;
          clientAlgoId?: string;
          price?: string;
          quantity?: string;
          side?: string;
          status?: string;
          symbol?: string;
          triggerPrice?: string;
          type?: string;
          workingType?: string;
          positionSide?: string;
          reduceOnly?: boolean;
          closePosition?: boolean;
        }>
      >('/fapi/v1/openAlgoOrders', { params: { symbol }, signed: true }),
    ]);
  }
  async getRealizedPnlHistory(symbol: string, limit = 20) {
    const history = await this.request<FuturesIncomeHistoryResponseItem[]>('/fapi/v1/income', {
      params: { incomeType: 'REALIZED_PNL', limit: Math.max(1, Math.trunc(limit)), symbol },
      signed: true,
    });
    return history
      .filter((item) => item.symbol === symbol && item.incomeType === 'REALIZED_PNL')
      .map((item) => ({
        asset: item.asset ?? 'USDT',
        income: parseNumber(item.income ?? null),
        info: item.info ?? 'n/a',
        symbol: item.symbol ?? symbol,
        time: typeof item.time === 'number' && Number.isFinite(item.time) ? item.time : null,
        tranId: typeof item.tranId === 'number' && Number.isFinite(item.tranId) ? item.tranId : null,
      }))
      .filter((item) => item.income !== null && item.time !== null);
  }
  getCurrentPrice(symbol: string) {
    return this.request<{ symbol: string; price: string }>('/fapi/v1/ticker/price', { params: { symbol } });
  }
  async closePosition(symbol: string, positionSide?: 'BOTH' | 'LONG' | 'SHORT') {
    const symbolInfo = await this.getSymbolInfo(symbol);
    const stepSize = extractStepSize(symbolInfo ?? undefined);
    const [account] = await Promise.all([this.getAccount()]);
    const dualSidePosition = Boolean(account.dualSidePosition);
    const resolveTargetPosition = async () =>
      (await this.getOpenPositions(symbol)).find((position) => {
        if (position.symbol !== symbol || parseNumber(position.positionAmt) === 0) return false;
        if (!positionSide || positionSide === 'BOTH') return true;
        const rawQuantity = parseNumber(position.positionAmt) ?? 0;
        return dualSidePosition
          ? position.positionSide === positionSide
          : positionSide === 'LONG'
            ? rawQuantity > 0
            : rawQuantity < 0;
      }) ?? null;
    let targetPosition = await resolveTargetPosition();
    if (!targetPosition) throw new Error(`No open position found for ${symbol}.`);
    await this.cancelProtectionOrders(symbol, targetPosition.positionSide ?? positionSide ?? 'BOTH');
    let lastOrderResponse: FuturesOrderResponse | null = null;
    for (let attempt = 0; attempt < 2; attempt += 1) {
      targetPosition = await resolveTargetPosition();
      if (!targetPosition) break;
      const rawQuantity = Math.abs(parseNumber(targetPosition.positionAmt) ?? 0);
      const quantity = roundDownToStep(rawQuantity, stepSize);
      if (quantity <= 0) break;
      const exitSide: FuturesOrderSide = (parseNumber(targetPosition.positionAmt) ?? 0) > 0 ? 'SELL' : 'BUY';
      lastOrderResponse = await this.request<FuturesOrderResponse>('/fapi/v1/order', {
        method: 'POST',
        params: {
          symbol,
          side: exitSide,
          type: 'MARKET',
          quantity,
          ...(dualSidePosition
            ? { positionSide: targetPosition.positionSide ?? positionSide ?? 'BOTH' }
            : { reduceOnly: true }),
          newOrderRespType: 'RESULT',
        },
        signed: true,
      });
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
    if (!lastOrderResponse) throw new Error(`Unable to close position for ${symbol}.`);
    await this.cancelProtectionOrders(symbol, positionSide ?? 'BOTH');
    return lastOrderResponse;
  }
  async cancelProtectionOrders(symbol: string, positionSide?: 'BOTH' | 'LONG' | 'SHORT') {
    const [regularOrders, algoOrders] = await this.getOpenOrders(symbol);
    await Promise.allSettled([
      ...regularOrders
        .filter((order) => isProtectionOrderType(order.type) && matchesPositionSide(order.positionSide, positionSide))
        .map((order) =>
          this.cancelOpenOrder(symbol, {
            mode: 'Regular',
            clientOrderId: order.clientOrderId ?? null,
            orderId: order.orderId,
          }),
        ),
      ...algoOrders
        .filter(
          (order) =>
            (order.reduceOnly === true || isProtectionOrderType(order.type) || order.closePosition === true) &&
            matchesPositionSide(order.positionSide, positionSide),
        )
        .map((order) =>
          this.cancelOpenOrder(symbol, {
            mode: 'Algo',
            algoId: order.algoId,
            clientOrderId: order.clientAlgoId ?? null,
          }),
        ),
    ]);
  }
  cancelOpenOrder(
    symbol: string,
    order: { mode: 'Regular' | 'Algo'; orderId?: number; clientOrderId?: string | null; algoId?: number },
  ) {
    return order.mode === 'Regular'
      ? this.request<Record<string, unknown>>('/fapi/v1/order', {
          method: 'DELETE',
          params: {
            symbol,
            ...(order.orderId !== undefined ? { orderId: order.orderId } : {}),
            ...(order.clientOrderId ? { origClientOrderId: order.clientOrderId } : {}),
          },
          signed: true,
        })
      : this.request<Record<string, unknown>>('/fapi/v1/algoOrder', {
          method: 'DELETE',
          params: {
            symbol,
            ...(order.algoId !== undefined ? { algoId: order.algoId } : {}),
            ...(order.clientOrderId ? { clientAlgoId: order.clientOrderId } : {}),
          },
          signed: true,
        });
  }
  cancelOpenOrders(symbol: string) {
    return Promise.allSettled([
      this.request<Record<string, unknown>>('/fapi/v1/allOpenOrders', {
        method: 'DELETE',
        params: { symbol },
        signed: true,
      }),
      this.request<Record<string, unknown>>('/fapi/v1/algoOpenOrders', {
        method: 'DELETE',
        params: { symbol },
        signed: true,
      }),
    ]).then((results) => {
      const rejected = results.filter((result): result is PromiseRejectedResult => result.status === 'rejected');
      if (rejected.length === results.length)
        throw rejected[0]?.reason instanceof Error ? rejected[0].reason : new Error('Failed to cancel open orders.');
      return results;
    });
  }
  async placeProtectionOrders(plan: FuturesAutoBotPlan, quantity: number, options?: { takeProfitStartIndex?: number }) {
    const [account, symbolInfo] = await Promise.all([this.getAccount(), this.getSymbolInfo(plan.symbol)]);
    const stepSize = extractStepSize(symbolInfo ?? undefined);
    const tickSize = extractTickSize(symbolInfo ?? undefined);
    const takeProfitStartIndex = Math.max(0, options?.takeProfitStartIndex ?? 0);
    const takeProfitPlan = plan.takeProfits.slice(takeProfitStartIndex);
    const takeProfitPrices = takeProfitPlan
      .map((item) => (item.price !== null ? normalizePrice(item.price, tickSize, symbolInfo?.pricePrecision) : null))
      .filter((value): value is number => value !== null);
    const stopLossPrice =
      plan.stopLoss !== null ? normalizePrice(plan.stopLoss, tickSize, symbolInfo?.pricePrecision) : null;
    const positionSide: FuturesPositionSide | null = account.dualSidePosition
      ? plan.direction === 'long'
        ? 'LONG'
        : 'SHORT'
      : null;
    const positionSideParam = positionSide ? { positionSide } : {};
    const algoOrderOwnershipParam = account.dualSidePosition ? positionSideParam : { reduceOnly: true };
    const exitSide: FuturesOrderSide = plan.direction === 'long' ? 'SELL' : 'BUY';
    const stopLossAlgoOrder = stopLossPrice
      ? await this.request<FuturesAlgoOrderResponse>('/fapi/v1/algoOrder', {
          method: 'POST',
          params: {
            algoType: 'CONDITIONAL',
            clientAlgoId: createClientAlgoId(plan.symbol, 'sl'),
            quantity,
            side: exitSide,
            symbol: plan.symbol,
            triggerPrice: stopLossPrice,
            type: 'STOP_MARKET',
            workingType: 'MARK_PRICE',
            ...positionSideParam,
            ...algoOrderOwnershipParam,
          },
          signed: true,
        })
      : null;
    const takeProfitQuantities = splitTakeProfitQuantityByWeights(
      quantity,
      stepSize,
      [0.4, 0.3, 0.3].slice(takeProfitStartIndex),
    );
    const takeProfitAlgoOrders: FuturesAlgoOrderResponse[] = [];
    for (let index = 0; index < takeProfitPrices.length; index += 1) {
      const takeProfitPrice = takeProfitPrices[index];
      const takeProfitQuantity = takeProfitQuantities[index];
      if (takeProfitPrice === undefined || takeProfitQuantity === undefined || takeProfitQuantity <= 0) continue;
      const order = await this.request<FuturesAlgoOrderResponse>('/fapi/v1/algoOrder', {
        method: 'POST',
        params: {
          algoType: 'CONDITIONAL',
          clientAlgoId: createClientAlgoId(plan.symbol, `tp${index + 1}`),
          quantity: takeProfitQuantity,
          symbol: plan.symbol,
          side: exitSide,
          triggerPrice: takeProfitPrice,
          type: 'TAKE_PROFIT_MARKET',
          workingType: 'MARK_PRICE',
          ...positionSideParam,
          ...algoOrderOwnershipParam,
        },
        signed: true,
      });
      takeProfitAlgoOrders.push(order);
    }
    return {
      algoOrderClientIds: [
        stopLossAlgoOrder?.clientAlgoId ?? null,
        ...takeProfitAlgoOrders.map((order) => order.clientAlgoId ?? null),
      ].filter((value): value is string => value !== null),
      positionSide,
      stopLossAlgoOrder,
      takeProfitAlgoOrders,
    };
  }
  async getSymbolInfo(symbol: string) {
    const snapshot = await futuresMarketController.getMarketSymbolSnapshot(symbol);
    return snapshot.data.symbolInfo ?? null;
  }
  setSymbolLeverage(symbol: string, leverage: number) {
    return this.request<FuturesLeverageResponse>('/fapi/v1/leverage', {
      method: 'POST',
      params: { leverage: Math.max(1, Math.trunc(leverage)), symbol },
      signed: true,
    });
  }
  async executeTrade(plan: FuturesAutoBotPlan, currentPrice: number) {
    const [account, symbolInfo] = await Promise.all([this.getAccount(), this.getSymbolInfo(plan.symbol)]);
    const availableBalance = parseNumber(account.availableBalance ?? account.totalWalletBalance) ?? 0;
    const stepSize = extractStepSize(symbolInfo ?? undefined);
    const tickSize = extractTickSize(symbolInfo ?? undefined);
    await this.setSymbolLeverage(plan.symbol, plan.leverage);
    const allocatedMargin =
      plan.allocationUnit === 'usdt' ? plan.allocationValue : availableBalance * (plan.allocationValue / 100);
    const notional = allocatedMargin * Math.max(plan.leverage, 1);
    if (!Number.isFinite(currentPrice) || currentPrice <= 0)
      throw new Error(`Invalid current price for ${plan.symbol}.`);
    const quantity = roundDownToStep(notional / currentPrice, stepSize);
    const entryPrice = getEntryLimitPrice(plan, currentPrice);
    const normalizedEntryPrice = normalizePrice(entryPrice, tickSize, symbolInfo?.pricePrecision);
    const positionSide: FuturesPositionSide | null = account.dualSidePosition
      ? plan.direction === 'long'
        ? 'LONG'
        : 'SHORT'
      : null;
    const entrySide: FuturesOrderSide = plan.direction === 'long' ? 'BUY' : 'SELL';
    if (quantity <= 0)
      throw new Error('Calculated order quantity is too small for the current balance and allocation.');
    const entryOrder = await this.request<FuturesOrderResponse>('/fapi/v1/order', {
      method: 'POST',
      params: {
        symbol: plan.symbol,
        side: entrySide,
        type: 'LIMIT',
        quantity,
        price: normalizedEntryPrice,
        timeInForce: 'GTC',
        newOrderRespType: 'RESULT',
        ...(positionSide ? { positionSide } : {}),
      },
      signed: true,
    });
    const entryFilled = entryOrder.status === 'FILLED' || Number(entryOrder.executedQty ?? '0') > 0;
    const protectionOrders = entryFilled ? await this.placeProtectionOrders(plan, quantity) : null;
    return {
      entryOrder,
      entryPrice: normalizedEntryPrice,
      entryFilled,
      algoOrderClientIds: protectionOrders?.algoOrderClientIds ?? [],
      allocatedMargin,
      positionSide,
      quantity,
      stopLossAlgoOrder: protectionOrders?.stopLossAlgoOrder ?? null,
      takeProfitAlgoOrders: protectionOrders?.takeProfitAlgoOrders ?? [],
    };
  }
}
export const futuresAutoTradeService = new FuturesAutoTradeService();
