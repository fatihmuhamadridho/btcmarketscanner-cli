import { spawn } from 'child_process';
import { createHash } from 'crypto';
import { buildCoinValidationSnapshot } from '../../../../../features/coin/logic/CoinValidationSnapshot.logic.js';
const openClawPromptInstructions = ['Validate this futures setup snapshot before any Binance entry order is opened.', 'Use 15m as the setup anchor, 1h as the primary bias, 4h as soft macro context, and 1m as the trigger.', 'Return only JSON with: setup_id, symbol, exchange, market_type, is_perpetual, confidence, decision, accepted, rejection_reasons, adjustment_notes, next_action, suggested_setup, validated_setup.', 'Confidence must be 0 to 1 and should reflect setup strength even on rejects.', 'Accept only when the setup is coherent, the higher timeframe bias is aligned enough, and risk/reward is valid.', 'Reject with accepted=false, concise rejection_reasons, suggested_setup for the best adjusted setup, and validated_setup=null.', 'If accepted, validated_setup must be the executable plan and suggested_setup must be null.'].join(' ');
const validationCache = new Map();
const pendingValidationRequests = new Map();
const DEFAULT_CACHE_TTL_MS = 5 * 60 * 1000;
const QUOTA_ERROR_CACHE_TTL_MS = 60 * 60 * 1000;
function getValidationCacheKey(snapshot) { const { generated_at, ...cacheSnapshot } = snapshot; void generated_at; return createHash('sha256').update(JSON.stringify(cacheSnapshot)).digest('hex'); }
function getCacheTtlMs(error) { return error instanceof Error && /quota exceeded/i.test(error.message) ? QUOTA_ERROR_CACHE_TTL_MS : DEFAULT_CACHE_TTL_MS; }
function extractJsonPayload(rawResponse) { const trimmed = rawResponse.trim(); if (trimmed.startsWith('```')) {
    const firstLineBreak = trimmed.indexOf('\n');
    const lastFence = trimmed.lastIndexOf('```');
    if (firstLineBreak >= 0 && lastFence > firstLineBreak)
        return trimmed.slice(firstLineBreak + 1, lastFence).trim();
} const firstBrace = trimmed.indexOf('{'); const lastBrace = trimmed.lastIndexOf('}'); return firstBrace >= 0 && lastBrace > firstBrace ? trimmed.slice(firstBrace, lastBrace + 1).trim() : trimmed; }
function getSession(value) { const hour = value.getUTCHours(); if (hour >= 7 && hour < 9)
    return 'overlap'; if (hour >= 13 && hour < 16)
    return 'overlap'; if (hour >= 0 && hour < 7)
    return 'asia'; if (hour >= 7 && hour < 14)
    return 'europe'; return 'us'; }
function getVolatilityState(price, atr14) { if (price === null || atr14 === null || price <= 0)
    return 'normal'; const atrRatio = atr14 / price; if (atrRatio < 0.005)
    return 'low'; if (atrRatio < 0.05)
    return 'normal'; if (atrRatio < 0.1)
    return 'high'; return 'extreme'; }
async function runOpenClawValidation(snapshot) { const child = spawn('openclaw', ['agent', '--session-id', 'main', '--thinking', 'low', '--message', `${openClawPromptInstructions}\n\nSnapshot JSON:\n${JSON.stringify(snapshot)}`], { env: process.env, stdio: ['ignore', 'pipe', 'pipe'] }); let stderr = ''; let stdout = ''; const rawOutput = await new Promise((resolve, reject) => { child.stderr.on('data', (chunk) => { stderr += chunk.toString(); }); child.stdout.on('data', (chunk) => { stdout += chunk.toString(); }); child.on('error', reject); child.on('close', (code, signal) => { if (code === 0) {
    const preferredOutput = stdout.trim() || stderr.trim();
    if (!preferredOutput) {
        reject(new Error(`openclaw agent returned no output.${stderr ? ` stderr: ${stderr.trim()}` : ''}`));
        return;
    }
    resolve(preferredOutput);
    return;
} const suffix = signal ? ` signal ${signal}` : ''; reject(new Error(`openclaw agent exited with code ${code ?? 'unknown'}${suffix}${stderr ? `: ${stderr.trim()}` : ''}`)); }); }); return rawOutput; }
function normalizeValidatedSetup(setup) { const entryLow = setup.entry_zone[0] ?? setup.planned_entry ?? 0; const entryHigh = setup.entry_zone[1] ?? setup.planned_entry ?? 0; const low = Math.min(entryLow, entryHigh); const high = Math.max(entryLow, entryHigh); return { direction: setup.direction, entry_zone: [low, high], planned_entry: setup.planned_entry ?? low, risk_reward: { tp1: setup.risk_reward.tp1 ?? 0, tp2: setup.risk_reward.tp2 ?? 0 }, setup_type: setup.setup_type, stop_loss: setup.stop_loss ?? 0, take_profit: { tp1: setup.take_profit.tp1 ?? 0, tp2: setup.take_profit.tp2 ?? 0 } }; }
function createRejectedResult(snapshot, reason, confidence = 0.1, details) { return { adjustment_notes: details?.adjustment_notes ?? [], confidence, reason, setup_id: snapshot.setup_id, next_action: details?.next_action ?? 'wait_for_new_data', suggested_setup: details?.suggested_setup ?? null, validated_setup: normalizeValidatedSetup(snapshot.setup_candidate ?? { direction: 'long', distance_to_resistance: null, distance_to_support: null, entry_zone: [snapshot.current_context.price ?? 0, snapshot.current_context.price ?? 0], planned_entry: snapshot.current_context.price ?? 0, risk_reward: { tp1: 0, tp2: 0 }, setup_type: 'continuation', sl_distance: null, stop_loss: snapshot.current_context.price ?? 0, take_profit: { tp1: snapshot.current_context.price ?? 0, tp2: snapshot.current_context.price ?? 0 }, tp_distance: { tp1: null, tp2: null } }), validation_result: 'rejected' }; }
function parseOpenClawResponse(rawResponse) { const parsed = JSON.parse(extractJsonPayload(rawResponse)); if (typeof parsed.setup_id !== 'string' || typeof parsed.symbol !== 'string' || parsed.exchange !== 'binance' || parsed.market_type !== 'futures' || typeof parsed.is_perpetual !== 'boolean' || typeof parsed.confidence !== 'number' || !Number.isFinite(parsed.confidence) || parsed.confidence < 0 || parsed.confidence > 1 || (parsed.decision !== 'accept' && parsed.decision !== 'reject') || typeof parsed.accepted !== 'boolean' || !Array.isArray(parsed.rejection_reasons) || parsed.rejection_reasons.some((item) => typeof item !== 'string') || !Array.isArray(parsed.adjustment_notes) || parsed.adjustment_notes.some((item) => typeof item !== 'string') || (parsed.next_action !== 'wait_for_entry_zone' && parsed.next_action !== 'wait_for_new_data' && parsed.next_action !== 'flip_direction' && parsed.next_action !== 'ready_to_enter') || !('validated_setup' in parsed))
    throw new Error('OpenClaw returned an invalid validation payload.'); return parsed; }
function parseValidationResult(snapshot, rawResponse) { try {
    const response = parseOpenClawResponse(rawResponse);
    if (response.setup_id !== snapshot.setup_id)
        return createRejectedResult(snapshot, 'OpenClaw returned an invalid validation payload.');
    if (response.decision !== 'accept' || response.accepted !== true || response.validated_setup === null)
        return createRejectedResult(snapshot, response.rejection_reasons.length > 0 ? response.rejection_reasons.join(' ') : 'OpenClaw rejected the setup.', response.confidence, { adjustment_notes: response.adjustment_notes, next_action: response.next_action, suggested_setup: response.suggested_setup });
    return { adjustment_notes: response.adjustment_notes, confidence: response.confidence, reason: response.rejection_reasons.length > 0 ? response.rejection_reasons.join(' ') : 'OpenClaw accepted the setup.', setup_id: snapshot.setup_id, next_action: response.next_action, suggested_setup: response.suggested_setup, validated_setup: response.validated_setup, validation_result: 'accepted' };
}
catch (error) {
    return createRejectedResult(snapshot, error instanceof Error ? error.message : 'OpenClaw returned an unreadable validation response.');
} }
function readCachedValidation(cacheKey) { const cached = validationCache.get(cacheKey); if (!cached)
    return null; if (cached.expiresAt <= Date.now()) {
    validationCache.delete(cacheKey);
    return null;
} return cached.result; }
function writeCachedValidation(cacheKey, result, ttlMs) { validationCache.set(cacheKey, { expiresAt: Date.now() + ttlMs, result }); }
function toValidationSnapshot(input) {
    const currentTime = new Date();
    const currentTrend = input.timeframeSnapshots.find((item) => item.interval === '1h')?.trend ?? input.timeframeSnapshots[0]?.trend ?? {
        direction: 'sideways',
        color: 'gray',
        endPrice: input.currentPrice,
        atr14: null,
        ema100: null,
        ema20: null,
        ema200: null,
        ema50: null,
        label: 'Sideways',
        ma20: null,
        ma50: null,
        ma200: null,
        rsi14: null,
        reasons: [],
        rangePercent: 0,
        score: 0,
        startPrice: input.currentPrice,
        structurePattern: 'Mixed',
        structure: 'Insufficient data',
        volumeRatio: null,
    };
    const snapshot = buildCoinValidationSnapshot({
        accountSize: input.accountSize,
        consensusSetup: input.consensusSetup,
        setupCandidateOverride: input.setupCandidateOverride ?? null,
        currentPrice: input.currentPrice,
        currentTrend,
        isPerpetual: input.isPerpetual,
        leverage: input.leverage,
        symbol: input.symbol,
        timeframeSources: {
            '1m': input.timeframeSnapshots.find((item) => item.interval === '1m')?.candles ?? [],
            '15m': input.timeframeSnapshots.find((item) => item.interval === '15m')?.candles ?? [],
            '1h': input.timeframeSnapshots.find((item) => item.interval === '1h')?.candles ?? [],
            '4h': input.timeframeSnapshots.find((item) => item.interval === '4h')?.candles ?? [],
        },
        timeframeSupportResistance: input.timeframeSnapshots
            .filter((snapshot) => snapshot.interval === '1m' || snapshot.interval === '15m' || snapshot.interval === '1h' || snapshot.interval === '4h')
            .map((snapshot) => ({
            interval: snapshot.interval,
            label: snapshot.interval,
            atr14: snapshot.trend.atr14,
            ema20: snapshot.trend.ema20,
            ema50: snapshot.trend.ema50,
            ema100: snapshot.trend.ema100,
            ema200: snapshot.trend.ema200,
            supportResistance: snapshot.supportResistance
                ? {
                    averageResistance: snapshot.supportResistance.resistance,
                    averageSupport: snapshot.supportResistance.support,
                    resistance: snapshot.supportResistance.resistance,
                    support: snapshot.supportResistance.support,
                }
                : null,
            rsi14: snapshot.trend.rsi14,
            trendDirection: snapshot.trend.direction,
            trendLabel: snapshot.trend.label,
        })),
    });
    if (!snapshot) {
        return {
            account_size: input.accountSize,
            current_context: {
                price: input.currentPrice,
                session: getSession(currentTime),
                trend: currentTrend.direction,
                volatility_state: getVolatilityState(input.currentPrice, currentTrend.atr14),
            },
            current_trend: currentTrend,
            data_quality: { candle_consistency: false, has_null_values: true, indicator_validity: false, is_complete: false },
            exchange: 'binance',
            generated_at: currentTime.toISOString(),
            is_perpetual: input.isPerpetual,
            leverage: input.leverage,
            market_type: 'futures',
            risk_config: { account_size: input.accountSize, leverage: input.leverage, risk_percent: 1 },
            setup_candidate: null,
            setup_id: `${input.symbol}-${currentTime.toISOString().slice(0, 10)}-001`,
            symbol: input.symbol,
            timeframe_roles: { '1m': 'trigger', '15m': 'setup_main', '1h': 'bias_primary', '4h': 'macro_soft' },
            timeframes: {
                '1m': { atr14: null, candles: [], current_price: null, distance_to_resistance: null, distance_to_support: null, ema100: null, ema20: null, ema200: null, ema50: null, ema_alignment: 'neutral', resistance: null, rsi14: null, structure_state: 'Mixed', support: null, trend_state: 'sideways' },
                '15m': { atr14: null, candles: [], current_price: null, distance_to_resistance: null, distance_to_support: null, ema100: null, ema20: null, ema200: null, ema50: null, ema_alignment: 'neutral', resistance: null, rsi14: null, structure_state: 'Mixed', support: null, trend_state: 'sideways' },
                '1h': { atr14: null, candles: [], current_price: null, distance_to_resistance: null, distance_to_support: null, ema100: null, ema20: null, ema200: null, ema50: null, ema_alignment: 'neutral', resistance: null, rsi14: null, structure_state: 'Mixed', support: null, trend_state: 'sideways' },
                '4h': { atr14: null, candles: [], current_price: null, distance_to_resistance: null, distance_to_support: null, ema100: null, ema20: null, ema200: null, ema50: null, ema_alignment: 'neutral', resistance: null, rsi14: null, structure_state: 'Mixed', support: null, trend_state: 'sideways' },
            },
            validation_rules: { min_rr: 2, max_distance_to_resistance_atr_multiple: 1, min_sl_atr_multiple: 0.8, min_tp1_atr_multiple: 1.5, require_htf_trend_alignment: true },
        };
    }
    return snapshot;
}
export class FuturesAutoValidationService {
    async validateSetup(input, options) { const snapshot = toValidationSnapshot(input); const cacheKey = getValidationCacheKey(snapshot); const cachedResult = options?.bypassCache ? null : readCachedValidation(cacheKey); if (cachedResult)
        return cachedResult; const pendingRequest = options?.bypassCache ? null : pendingValidationRequests.get(cacheKey); if (pendingRequest)
        return pendingRequest; const validationPromise = (async () => { try {
        const rawResponse = await runOpenClawValidation(snapshot);
        const parsedResult = parseValidationResult(snapshot, rawResponse);
        writeCachedValidation(cacheKey, parsedResult, DEFAULT_CACHE_TTL_MS);
        return parsedResult;
    }
    catch (error) {
        const rejectedResult = createRejectedResult(snapshot, `OpenClaw validation unavailable: ${error instanceof Error ? error.message : 'Unknown OpenClaw validation error.'}`);
        writeCachedValidation(cacheKey, rejectedResult, getCacheTtlMs(error));
        return rejectedResult;
    }
    finally {
        pendingValidationRequests.delete(cacheKey);
    } })(); pendingValidationRequests.set(cacheKey, validationPromise); try {
        return await validationPromise;
    }
    catch {
        return createRejectedResult(snapshot, 'OpenClaw validation promise unexpectedly failed.');
    } }
}
export const futuresAutoValidationService = new FuturesAutoValidationService();
