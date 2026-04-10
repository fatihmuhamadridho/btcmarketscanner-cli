import { jsx as _jsx, jsxs as _jsxs, Fragment as _Fragment } from "react/jsx-runtime";
import React from 'react';
import { Box, Text } from 'ink';
import { Badge } from '../atoms/Badge.atom.js';
import { Panel } from '../molecules/Panel.molecule.js';
function pct(value) {
    if (value === null || Number.isNaN(value))
        return 'n/a';
    const sign = value > 0 ? '+' : '';
    return `${sign}${value.toFixed(2)}%`;
}
function price(value) {
    if (value === null || Number.isNaN(value))
        return 'n/a';
    const absoluteValue = Math.abs(value);
    const decimals = absoluteValue >= 1000 ? 2 :
        absoluteValue >= 100 ? 3 :
            absoluteValue >= 1 ? 4 :
                absoluteValue >= 0.1 ? 5 :
                    absoluteValue >= 0.01 ? 6 :
                        absoluteValue >= 0.001 ? 8 :
                            10;
    return value.toLocaleString('en-US', {
        minimumFractionDigits: 0,
        maximumFractionDigits: decimals,
    });
}
function tone(direction) {
    if (direction === 'bullish' || direction === 'long')
        return '#50fa7b';
    if (direction === 'bearish' || direction === 'short')
        return '#ff6b6b';
    return '#c9d1d9';
}
function numberTone(value, fallback = '#f8f8f2') {
    if (value === null || Number.isNaN(value))
        return '#8b949e';
    if (value > 0)
        return '#50fa7b';
    if (value < 0)
        return '#ff6b6b';
    return fallback;
}
function renderList(items, fallback) {
    const text = items.filter(Boolean).join(' • ');
    return text.length > 0 ? text : fallback;
}
function compact(value) {
    return value.length > 26 ? `${value.slice(0, 23)}...` : value;
}
function line(label, value, labelWidth = 18) {
    return (_jsxs(Box, { flexDirection: "row", children: [_jsx(Box, { width: labelWidth, marginRight: 1, flexShrink: 0, children: _jsx(Text, { color: "#8b949e", bold: true, children: label }) }), _jsx(Box, { flexGrow: 1, flexShrink: 1, children: _jsx(Text, { color: "#f8f8f2", children: value }) })] }));
}
function ema(candles, period) {
    if (candles.length < period)
        return null;
    const closes = candles.map((candle) => candle.close);
    const seedWindow = closes.slice(0, period);
    let value = seedWindow.reduce((sum, close) => sum + close, 0) / period;
    const multiplier = 2 / (period + 1);
    for (let index = period; index < closes.length; index += 1) {
        value = (closes[index] - value) * multiplier + value;
    }
    return value;
}
export function TradingDashboard({ snapshot, mode, tick, autoTrade, liveState, view, panelWidth, }) {
    const marketCandles = liveState.initialCandles.length
        ? liveState.initialCandles
        : liveState.symbolDetail?.data.candles.length
            ? liveState.symbolDetail.data.candles
            : snapshot.candles;
    const lastPrice = marketCandles.at(-1)?.close ?? null;
    const highPrice = marketCandles.reduce((max, candle) => Math.max(max, candle.high), Number.NEGATIVE_INFINITY);
    const lowPrice = marketCandles.reduce((min, candle) => Math.min(min, candle.low), Number.POSITIVE_INFINITY);
    const openPrice = snapshot.trend.startPrice ?? marketCandles.at(0)?.close ?? null;
    const change = snapshot.trend.changePercent;
    const trendColor = tone(snapshot.trend.direction);
    const setupColor = tone(snapshot.setup.direction);
    const botStateLabel = liveState.bot?.status ?? 'idle';
    const openOrderCount = liveState.openOrders ? liveState.openOrders[0].length + liveState.openOrders[1].length : 0;
    const openPositionCount = liveState.openPositions?.filter((position) => Math.abs(Number(position.positionAmt ?? 0)) > 0).length ?? 0;
    const support = snapshot.supportResistance?.support ?? null;
    const resistance = snapshot.supportResistance?.resistance ?? null;
    const rangeValue = Number.isFinite(highPrice) && Number.isFinite(lowPrice) ? highPrice - lowPrice : null;
    const watchMode = view === 'overview' || view === 'market';
    const emaCandles = marketCandles;
    const ema20 = snapshot.trend.ema20 ?? ema(emaCandles, 20);
    const ema50 = snapshot.trend.ema50 ?? ema(emaCandles, 50);
    const ema100 = snapshot.trend.ema100 ?? ema(emaCandles, 100);
    const ema200 = snapshot.trend.ema200 ?? ema(emaCandles, 200);
    return (_jsx(Box, { flexDirection: "column", children: _jsxs(Box, { flexDirection: "column", children: [_jsxs(Panel, { title: "Market", width: panelWidth, children: [line('pair', _jsxs(_Fragment, { children: [_jsx(Badge, { label: snapshot.trend.label.toUpperCase(), color: trendColor }), " ", _jsx(Text, { dimColor: true, children: snapshot.pair })] }), 6), line('ohlc', _jsxs(_Fragment, { children: ["o ", _jsx(Text, { color: "#f8f8f2", children: price(openPrice) }), " h", ' ', _jsx(Text, { color: "#f8f8f2", children: price(Number.isFinite(highPrice) ? highPrice : null) }), " l", ' ', _jsx(Text, { color: "#f8f8f2", children: price(Number.isFinite(lowPrice) ? lowPrice : null) }), " c", ' ', _jsx(Text, { color: numberTone(change), children: price(lastPrice) })] }), 6), line('bars', _jsx(Text, { color: "#8be9fd", children: marketCandles.length }), 6), line('now', _jsxs(_Fragment, { children: ["cur ", _jsx(Text, { color: numberTone(liveState.currentPrice ?? lastPrice), children: price(liveState.currentPrice ?? lastPrice) }), " chg", ' ', _jsx(Text, { color: numberTone(change), children: pct(change) }), " rng ", _jsx(Text, { color: "#f8f8f2", children: price(rangeValue) }), " rsi", ' ', _jsx(Text, { color: snapshot.trend.rsi14 !== null ? '#f1fa8c' : '#8b949e', children: price(snapshot.trend.rsi14) })] }), 6), line('ema', _jsxs(_Fragment, { children: ["20 ", _jsx(Text, { color: "#8be9fd", children: price(ema20) }), " 50 ", _jsx(Text, { color: "#8be9fd", children: price(ema50) }), " 100", ' ', _jsx(Text, { color: "#8be9fd", children: price(ema100) }), " 200 ", _jsx(Text, { color: "#8be9fd", children: price(ema200) })] }), 6), line('hl', _jsxs(_Fragment, { children: ["atr ", _jsx(Text, { color: "#f1fa8c", children: price(snapshot.trend.atr14) }), " sup ", _jsx(Text, { color: "#50fa7b", children: price(support) }), " res", ' ', _jsx(Text, { color: "#ff6b6b", children: price(resistance) })] }), 6)] }), watchMode ? (_jsx(Box, { marginTop: 0, children: _jsxs(Panel, { title: "Status", width: panelWidth, children: [line('view', _jsx(Text, { color: "#8be9fd", children: `${mode.toUpperCase()} ${view.toUpperCase()}` }), 14), line('auto-trade', _jsx(Text, { color: autoTrade ? '#50fa7b' : '#ff6b6b', children: autoTrade ? 'on' : 'off' }), 14), line('bot-state', _jsx(Text, { color: botStateLabel === 'idle' ? '#c9d1d9' : '#8be9fd', children: botStateLabel }), 14), line('open-orders', _jsx(Text, { color: "#f1fa8c", children: openOrderCount }), 14), line('open-positions', _jsx(Text, { color: "#f1fa8c", children: openPositionCount }), 14)] }) })) : (_jsxs(_Fragment, { children: [_jsx(Box, { marginTop: 1, children: _jsxs(Panel, { title: "Setup", width: panelWidth, children: [line('bias', _jsxs(_Fragment, { children: [_jsx(Badge, { label: snapshot.setup.label.toUpperCase(), color: setupColor }), " ", _jsx(Text, { dimColor: true, children: snapshot.setup.grade })] }), 6), line('zone', _jsxs(_Fragment, { children: ["entry ", _jsx(Text, { color: "#50fa7b", children: price(snapshot.setup.entryMid) }), " stop ", _jsx(Text, { color: "#ff6b6b", children: price(snapshot.setup.stopLoss) }), " tp", ' ', _jsx(Text, { color: "#f1fa8c", children: price(snapshot.setup.takeProfit) })] }), 6), line('risk', _jsxs(_Fragment, { children: ["r/r", ' ', _jsx(Text, { color: snapshot.setup.riskReward !== null ? '#f1fa8c' : '#8b949e', children: snapshot.setup.riskReward !== null ? `1:${snapshot.setup.riskReward.toFixed(2)}` : 'n/a' }), ' ', "mode ", _jsx(Text, { color: "#8be9fd", children: snapshot.setup.pathMode })] }), 6), line('path', compact(snapshot.setup.path.map((step) => `${step.label}:${step.status}`).join(' / ')), 6)] }) }), _jsx(Box, { marginTop: 1, children: _jsxs(Panel, { title: "Exec", width: panelWidth, children: [line('mode', _jsx(Text, { color: "#8be9fd", children: mode.toUpperCase() }), 14), line('auto', _jsx(Text, { color: autoTrade ? '#50fa7b' : '#ff6b6b', children: autoTrade ? 'on' : 'off' }), 14), line('view', _jsx(Text, { color: "#8be9fd", children: view.toUpperCase() }), 14), line('bot', _jsx(Text, { color: botStateLabel === 'idle' ? '#c9d1d9' : '#8be9fd', children: botStateLabel }), 14), line('ord', _jsxs(Text, { color: "#f1fa8c", children: [openOrderCount, " open"] }), 14), line('pos', _jsxs(Text, { color: "#f1fa8c", children: [openPositionCount, " open"] }), 14)] }) }), _jsx(Box, { marginTop: 1, children: _jsxs(Panel, { title: "Core", width: panelWidth, children: [line('exch', liveState.exchangeInfoSummary
                                        ? _jsxs(_Fragment, { children: ["sym ", _jsx(Text, { color: "#8be9fd", children: liveState.exchangeInfoSummary.tradingSymbolCount }), "/", _jsx(Text, { color: "#8be9fd", children: liveState.exchangeInfoSummary.symbolCount }), " perp", ' ', _jsx(Text, { color: "#8be9fd", children: liveState.exchangeInfoSummary.perpetualSymbolCount })] })
                                        : 'exchange unavailable'), line('watch', _jsx(Text, { color: "#f8f8f2", children: renderList(liveState.overview?.data.slice(0, 3).map((item) => item.symbol) ?? [], 'overview unavailable') })), line('candles', liveState.symbolDetail?.data.candles.length
                                        ? _jsxs(_Fragment, { children: [_jsx(Text, { color: "#8be9fd", children: liveState.symbolDetail.data.candles.length }), " bars current", ' ', _jsx(Text, { color: numberTone(liveState.currentPrice), children: price(liveState.currentPrice) })] })
                                        : 'candles unavailable')] }) }), _jsx(Box, { marginTop: 1, children: _jsxs(Panel, { title: "Bot / Orders", width: panelWidth, children: [line('bot', liveState.bot ? `${liveState.bot.status} ${liveState.bot.planSource ?? 'n/a'}` : 'idle'), line('log', liveState.botLogs.at(-1)?.message ?? 'no bot log yet'), line('orders', liveState.openOrders ? (_jsxs(_Fragment, { children: [_jsx(Text, { color: "#8be9fd", children: liveState.openOrders[0].length }), " reg / ", _jsx(Text, { color: "#8be9fd", children: liveState.openOrders[1].length }), " algo"] })) : ('orders unavailable')), line('pos', liveState.openPositions?.length ? (_jsx(_Fragment, { children: _jsx(Text, { color: "#8be9fd", children: liveState.openPositions.slice(0, 2).map((position) => `${position.symbol}:${position.positionSide}`).join(' • ') }) })) : ('no positions')), line('pnl', liveState.realizedPnlHistory?.length ? (_jsx(_Fragment, { children: _jsx(Text, { color: "#8be9fd", children: liveState.realizedPnlHistory.slice(0, 2).map((item) => `${item.symbol}:${price(item.income)}`).join(' • ') }) })) : ('no pnl history'))] }) })] }))] }) }));
}
