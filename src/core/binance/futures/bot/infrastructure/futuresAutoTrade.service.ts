import { createHmac, randomUUID } from 'crypto';
import { BASE_API_BINANCE, BINANCE_API_KEY, BINANCE_SECRET_KEY } from '@configs/base.config';
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
    let quantity: number;
    if (isLast) {
      // Last TP gets all remaining quantity (ensures perfect split with no leftover)
      quantity = remainingQuantity;
    } else {
      // Other TPs get weighted share, rounded down
      quantity = roundDownToStep(totalQuantity * weight, stepSize);
    }
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
    } else {
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

    console.log(`[closePosition] Starting to close position for ${symbol}, side=${targetPosition.positionSide}, amount=${targetPosition.positionAmt}`);

    await this.cancelProtectionOrders(symbol, targetPosition.positionSide ?? positionSide ?? 'BOTH');
    let lastOrderResponse: FuturesOrderResponse | null = null;
    const maxAttempts = 10; // Increased from 2 to handle multiple partial closes
    let closedQuantity = 0;

    for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
      targetPosition = await resolveTargetPosition();
      if (!targetPosition) {
        console.log(`[closePosition] Position fully closed after ${attempt} attempts, total closed: ${closedQuantity}`);
        break;
      }

      const rawQuantity = Math.abs(parseNumber(targetPosition.positionAmt) ?? 0);

      // Consider positions smaller than 0.00001 as dust and close them anyway
      if (rawQuantity < 0.00001) {
        console.log(`[closePosition] Dust position detected: ${rawQuantity}, attempting to close as ${rawQuantity}`);
      } else if (rawQuantity === 0) {
        console.log(`[closePosition] No remaining position after attempt ${attempt}`);
        break;
      }

      // Try to round down to step size, but if that results in 0, use the raw quantity
      const quantity = roundDownToStep(rawQuantity, stepSize);
      let finalQuantity = quantity;

      if (quantity <= 0 && rawQuantity > 0) {
        // Rounding resulted in 0, but we have a position - try to close anyway
        // Use a smaller value that respects step size
        const minStep = stepSize && stepSize > 0 ? stepSize : 0.00001;
        finalQuantity = Math.max(minStep, rawQuantity);
        console.log(`[closePosition] Rounded quantity was 0, using final quantity ${finalQuantity} (raw: ${rawQuantity})`);
      } else if (quantity <= 0) {
        console.log(`[closePosition] Quantity too small to close: ${rawQuantity}, breaking after ${attempt} attempts`);
        break;
      }
      const exitSide: FuturesOrderSide = (parseNumber(targetPosition.positionAmt) ?? 0) > 0 ? 'SELL' : 'BUY';

      try {
        console.log(`[closePosition] Attempt ${attempt + 1}/${maxAttempts}: closing ${finalQuantity} (raw: ${rawQuantity}), side=${exitSide}`);
        lastOrderResponse = await this.request<FuturesOrderResponse>('/fapi/v1/order', {
          method: 'POST',
          params: {
            symbol,
            side: exitSide,
            type: 'MARKET',
            quantity: finalQuantity,
            ...(dualSidePosition
              ? { positionSide: targetPosition.positionSide ?? positionSide ?? 'BOTH' }
              : { reduceOnly: true }),
            newOrderRespType: 'RESULT',
          },
          signed: true,
        });

        closedQuantity += finalQuantity;
        console.log(`[closePosition] Order placed, executedQty=${lastOrderResponse.executedQty}, status=${lastOrderResponse.status}`);

        // Wait before next attempt to let order settle
        await new Promise((resolve) => setTimeout(resolve, 300));
      } catch (error) {
        const errMsg = error instanceof Error ? error.message : 'Unknown error';
        console.error(`[closePosition] Error on attempt ${attempt + 1}: ${errMsg}`);
        throw error;
      }
    }

    if (!lastOrderResponse) throw new Error(`Unable to close position for ${symbol}.`);

    // Final verification: check remaining position
    await new Promise((resolve) => setTimeout(resolve, 500));
    const finalPosition = await resolveTargetPosition();
    if (finalPosition) {
      const remainingAmt = Math.abs(parseNumber(finalPosition.positionAmt) ?? 0);
      console.warn(`[closePosition] WARNING: Position still has ${remainingAmt} remaining after close attempt!`);
    }

    await this.cancelProtectionOrders(symbol, positionSide ?? 'BOTH');
    return lastOrderResponse;
  }
  async cancelProtectionOrders(symbol: string, positionSide?: 'BOTH' | 'LONG' | 'SHORT') {
    const [regularOrders, algoOrders] = await this.getOpenOrders(symbol);

    // Filter protection orders more carefully
    const regularProtectionOrders = regularOrders.filter(
      (order) => isProtectionOrderType(order.type) && matchesPositionSide(order.positionSide, positionSide),
    );

    const algoProtectionOrders = algoOrders.filter(
      (order) =>
        (order.reduceOnly === true || isProtectionOrderType(order.type) || order.closePosition === true) &&
        matchesPositionSide(order.positionSide, positionSide),
    );

    console.log(
      `[cancelProtectionOrders] ${symbol}: Found ${regularProtectionOrders.length} regular + ${algoProtectionOrders.length} algo protection orders to cancel (positionSide=${positionSide})`,
    );

    // Log details of orders being cancelled
    regularProtectionOrders.forEach((order) => {
      console.log(
        `[cancelProtectionOrders] ${symbol}: Canceling regular order - orderId=${order.orderId}, type=${order.type}, side=${order.positionSide}`,
      );
    });
    algoProtectionOrders.forEach((order) => {
      console.log(
        `[cancelProtectionOrders] ${symbol}: Canceling algo order - algoId=${order.algoId}, type=${order.type}, side=${order.positionSide}, reduceOnly=${order.reduceOnly}, closePosition=${order.closePosition}`,
      );
    });

    if (regularProtectionOrders.length === 0 && algoProtectionOrders.length === 0) {
      console.log(`[cancelProtectionOrders] ${symbol}: No protection orders found to cancel`);
      console.log(`[cancelProtectionOrders] ${symbol}: All open orders: ${JSON.stringify(regularOrders.concat(algoOrders as any))}`);
    }

    await Promise.allSettled([
      ...regularProtectionOrders.map((order) =>
        this.cancelOpenOrder(symbol, {
          mode: 'Regular',
          clientOrderId: order.clientOrderId ?? null,
          orderId: order.orderId,
        }),
      ),
      ...algoProtectionOrders.map((order) =>
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

    // Diagnostic: log TP setup
    console.log(
      `[placeProtectionOrders] ${plan.symbol}: takeProfitStartIndex=${takeProfitStartIndex}, plan.takeProfits=${JSON.stringify(plan.takeProfits.map((tp) => ({ label: tp.label, price: tp.price })))}, takeProfitPrices=${JSON.stringify(takeProfitPrices)}`,
    );
    const stopLossPrice =
      plan.stopLoss !== null ? normalizePrice(plan.stopLoss, tickSize, symbolInfo?.pricePrecision) : null;

    // Diagnostic logging for SL placement
    console.log(
      `[placeProtectionOrders] ${plan.symbol}: SL setup - plan.stopLoss=${plan.stopLoss}, tickSize=${tickSize}, pricePrecision=${symbolInfo?.pricePrecision}, normalized stopLossPrice=${stopLossPrice}`,
    );
    const positionSide: FuturesPositionSide | null = account.dualSidePosition
      ? plan.direction === 'long'
        ? 'LONG'
        : 'SHORT'
      : null;
    const positionSideParam = positionSide ? { positionSide } : {};
    const algoOrderOwnershipParam = account.dualSidePosition ? positionSideParam : { reduceOnly: true };
    const exitSide: FuturesOrderSide = plan.direction === 'long' ? 'SELL' : 'BUY';

    // Place SL order with proper error handling
    let stopLossAlgoOrder: FuturesAlgoOrderResponse | null = null;
    let slError: Error | null = null;

    if (stopLossPrice) {
      try {
        stopLossAlgoOrder = await this.request<FuturesAlgoOrderResponse>('/fapi/v1/algoOrder', {
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
        });
      } catch (error) {
        slError = error instanceof Error ? error : new Error('Failed to place SL order');
        console.error(`[placeProtectionOrders] Failed to place SL order for ${plan.symbol}: ${slError.message}`);
      }
    }

    // Calculate weighted distribution favoring earlier TPs (more likely to hit)
    // TP1: 70%, TP2: 30% (for better execution likelihood)
    const numTPs = Math.max(1, takeProfitPrices.length);
    let weights: number[];
    if (numTPs === 1) {
      weights = [1.0];
    } else if (numTPs === 2) {
      weights = [0.7, 0.3];
    } else {
      // For 3+ TPs: distribute as 50%, 30%, 15%, 5%, ...
      weights = [];
      let remaining = 1.0;
      for (let i = 0; i < numTPs; i += 1) {
        if (i === 0) {
          weights.push(0.5);
          remaining -= 0.5;
        } else if (i === 1) {
          weights.push(0.3);
          remaining -= 0.3;
        } else if (i === numTPs - 1) {
          // Last TP gets remainder
          weights.push(remaining);
          remaining = 0;
        } else {
          const share = remaining / (numTPs - i);
          weights.push(share);
          remaining -= share;
        }
      }
    }
    const takeProfitQuantities = splitTakeProfitQuantityByWeights(
      quantity,
      stepSize,
      weights.slice(takeProfitStartIndex),
    );

    const takeProfitAlgoOrders: FuturesAlgoOrderResponse[] = [];
    const failedTpIndices: number[] = [];

    for (let index = 0; index < takeProfitPrices.length; index += 1) {
      const takeProfitPrice = takeProfitPrices[index];
      // Important: takeProfitQuantities is sliced, so map index correctly
      const quantityIndex = index - takeProfitStartIndex;
      const takeProfitQuantity = quantityIndex >= 0 ? takeProfitQuantities[quantityIndex] : undefined;

      console.log(
        `[placeProtectionOrders] ${plan.symbol}: TP${index + 1} - price=${takeProfitPrice}, quantityIndex=${quantityIndex}, quantity=${takeProfitQuantity}, skip=${takeProfitPrice === undefined || takeProfitQuantity === undefined || takeProfitQuantity <= 0}`,
      );

      if (takeProfitPrice === undefined || takeProfitQuantity === undefined || takeProfitQuantity <= 0) continue;

      try {
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
      } catch (error) {
        const tpError = error instanceof Error ? error.message : 'Unknown error';
        console.error(`[placeProtectionOrders] Failed to place TP${index + 1} order for ${plan.symbol}: ${tpError}`);
        failedTpIndices.push(index + 1);
      }
    }

    // Validate that at least SL or at least one TP was placed
    if (!stopLossAlgoOrder && takeProfitAlgoOrders.length === 0) {
      const errorMsg = slError
        ? `Failed to place both SL and TP orders. SL error: ${slError.message}, TP failed: ${failedTpIndices.length > 0}`
        : 'Failed to place both SL and TP orders.';
      throw new Error(errorMsg);
    }

    // Log warnings for partially failed orders
    if (slError) {
      console.warn(`[placeProtectionOrders] SL order failed for ${plan.symbol}, but TPs were placed (${takeProfitAlgoOrders.length}). This position is at risk!`);
    }
    if (failedTpIndices.length > 0) {
      console.warn(`[placeProtectionOrders] Some TP orders failed for ${plan.symbol}: TP${failedTpIndices.join(', TP')}. SL placed: ${Boolean(stopLossAlgoOrder)}`);
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
  setSymbolMarginMode(symbol: string, marginMode: 'isolated' | 'cross') {
    return this.request<{ symbol: string; marginMode: string }>('/fapi/v1/marginType', {
      method: 'POST',
      params: { marginType: marginMode.toUpperCase(), symbol },
      signed: true,
    });
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

    // Set margin mode FIRST (before leverage)
    const marginMode = plan.marginMode || 'isolated';
    try {
      await this.setSymbolMarginMode(plan.symbol, marginMode);
      console.log(`[executeTrade] Set margin mode to ${marginMode} for ${plan.symbol}`);
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : 'Unknown error';
      console.warn(`[executeTrade] Failed to set margin mode for ${plan.symbol}: ${errorMsg}`);
      // Continue anyway, might already be set
    }

    await this.setSymbolLeverage(plan.symbol, plan.leverage);
    const allocatedMargin =
      plan.allocationUnit === 'usdt' ? plan.allocationValue : availableBalance * (plan.allocationValue / 100);
    const notional = allocatedMargin * Math.max(plan.leverage, 1);
    if (!Number.isFinite(currentPrice) || currentPrice <= 0)
      throw new Error(`Invalid current price for ${plan.symbol}.`);

    // Cap notional value to prevent "Exceeded maximum allowable position" errors
    // Binance typically allows ~500k USD notional per position at high leverage
    const maxNotional = Math.min(500000, availableBalance * plan.leverage * 2); // Conservative limit
    const cappedNotional = Math.min(notional, maxNotional);

    const quantity = roundDownToStep(cappedNotional / currentPrice, stepSize);
    const entryPrice = getEntryLimitPrice(plan, currentPrice);

    // Debug logging
    console.log(
      `[executeTrade] ${plan.symbol}: entryMid=${plan.entryMid}, entryZone=[${plan.entryZone.low}, ${plan.entryZone.high}], currentPrice=${currentPrice}, calculatedEntryPrice=${entryPrice}`,
    );
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

    // CRITICAL FIX: Place TP/SL immediately after entry order, do NOT wait for fill
    // With reduceOnly=true, TP/SL won't execute until position exists, so it's safe to place early
    let protectionOrders: Awaited<ReturnType<typeof this.placeProtectionOrders>> | null = null;
    let protectionOrdersError: Error | null = null;

    try {
      protectionOrders = await this.placeProtectionOrders(plan, quantity);

      // CRITICAL VALIDATIONS: SL and at least 1 TP must be placed!
      const hasSL = Boolean(protectionOrders?.stopLossAlgoOrder);
      const hasTP = (protectionOrders?.takeProfitAlgoOrders?.length ?? 0) > 0;

      if (!hasSL) {
        throw new Error(
          `SL order FAILED to place! This is CRITICAL - position would be UNPROTECTED. TPs placed: ${protectionOrders?.takeProfitAlgoOrders?.length ?? 0}`,
        );
      }
      if (!hasTP) {
        throw new Error(
          `No TP orders were placed! Position has no profit targets. SL placed: ${protectionOrders?.stopLossAlgoOrder ? 'YES' : 'NO'}`,
        );
      }

      console.log(
        `[executeTrade] ${plan.symbol}: TP/SL placed successfully - SL=${protectionOrders?.stopLossAlgoOrder?.algoId}, TPs=${protectionOrders?.takeProfitAlgoOrders?.length}`,
      );
    } catch (error) {
      protectionOrdersError = error instanceof Error ? error : new Error('Failed to place TP/SL orders');
      console.error(
        `[executeTrade] ${plan.symbol}: CRITICAL - TP/SL placement failed! Entry order ${entryOrder.orderId} is at risk!`,
        protectionOrdersError.message,
      );

      // Try to cancel entry order if TP/SL placement failed to prevent naked position
      if (!entryFilled) {
        let cancelSucceeded = false;
        try {
          console.log(`[executeTrade] ${plan.symbol}: Attempting to cancel entry order ${entryOrder.orderId} due to TP/SL placement failure...`);
          await this.cancelOpenOrder(plan.symbol, {
            mode: 'Regular',
            orderId: entryOrder.orderId,
          });
          console.log(`[executeTrade] ${plan.symbol}: Entry order ${entryOrder.orderId} cancelled successfully.`);
          cancelSucceeded = true;
        } catch (cancelError) {
          const cancelMsg = cancelError instanceof Error ? cancelError.message : 'Unknown error';
          console.error(`[executeTrade] ${plan.symbol}: CRITICAL - Failed to cancel entry order after TP/SL failure: ${cancelMsg}`);
          // Cancellation failed - entry order is still pending and unprotected
          throw new Error(
            `Failed to place TP/SL orders AND failed to cancel entry order. Entry order ${entryOrder.orderId} is UNPROTECTED! TP/SL error: ${protectionOrdersError.message}`,
          );
        }

        // Cancellation succeeded - still throw error because TP/SL placement failed
        if (cancelSucceeded) {
          throw new Error(
            `TP/SL placement failed - entry order ${entryOrder.orderId} was cancelled to prevent naked position. Original TP/SL error: ${protectionOrdersError.message}`,
          );
        }
      } else {
        // Entry already filled - we MUST have TP/SL, so rethrow original error
        throw protectionOrdersError;
      }
    }

    console.log(
      `[executeTrade] ${plan.symbol}: entryFilled=${entryFilled}, protectionOrders=${protectionOrders ? 'placed' : 'placement attempted'}, SL=${protectionOrders?.stopLossAlgoOrder?.algoId ?? 'MISSING'}, TPs=${protectionOrders?.takeProfitAlgoOrders?.length ?? 0}`,
    );

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
