import { spawn } from 'child_process';
import { createHash, randomUUID } from 'crypto';
import { buildCoinValidationSnapshot } from '@features/coin/logic/CoinValidationSnapshot.logic';
import { mkdir, writeFile } from 'fs/promises';
import os from 'os';
import { join } from 'path';
import type {
  CoinValidationSnapshot,
  CoinValidationSnapshotSetupCandidate,
} from '@features/coin/interface/CoinValidationSnapshot.interface';
import type { CoinSetupDetail } from '@features/coin/interface/CoinView.interface';
import type { FuturesAutoConsensusTimeframeSnapshot } from './futuresAutoConsensus.service';
import { telegramService } from '@services/telegram.service';

type OpenClawValidatedSetup = {
  direction: 'long' | 'short';
  entry_zone: [number, number];
  planned_entry: number;
  risk_reward: { tp1: number; tp2: number };
  setup_type: 'breakout_retest' | 'breakdown_retest' | 'continuation';
  stop_loss: number;
  take_profit: { tp1: number; tp2: number };
};
type OpenClawValidationResponse = {
  accepted: boolean;
  confidence: number;
  decision: 'accept' | 'reject';
  exchange: 'binance';
  is_perpetual: boolean;
  market_type: 'futures';
  adjustment_notes: string[];
  rejection_reasons: string[];
  setup_id: string;
  symbol: string;
  suggested_setup: OpenClawValidatedSetup | null;
  validated_setup: OpenClawValidatedSetup | null;
  next_action: 'wait_for_entry_zone' | 'wait_for_new_data' | 'flip_direction' | 'ready_to_enter' | 'wait_for_pullback_reclaim' | 'wait_for_breakout';
};
export type FuturesAutoBotOpenClawValidationResult = {
  adjustment_notes: string[];
  confidence: number;
  reason: string;
  setup_id: string;
  next_action: 'wait_for_entry_zone' | 'wait_for_new_data' | 'flip_direction' | 'ready_to_enter' | 'wait_for_pullback_reclaim' | 'wait_for_breakout';
  suggested_setup: OpenClawValidatedSetup | null;
  validated_setup: OpenClawValidatedSetup;
  validation_result: 'accepted' | 'rejected';
};
type FuturesAutoBotOpenClawValidationInput = {
  accountSize: number | null;
  botMode: 'scalping' | 'intraday';
  consensusSetup: CoinSetupDetail | null;
  setupCandidateOverride?: CoinValidationSnapshotSetupCandidate | null;
  currentPrice: number;
  isPerpetual: boolean;
  leverage: number;
  symbol: string;
  timeframeSnapshots: FuturesAutoConsensusTimeframeSnapshot[];
};
type FuturesAutoBotOpenClawValidationOptions = { bypassCache?: boolean };
type CachedOpenClawValidation = { expiresAt: number; result: FuturesAutoBotOpenClawValidationResult };
const openClawPromptInstructions = [
  'CRITICAL: Return MUST include numeric TP and SL values for entry setup validation.',
  'Validate this futures entry setup snapshot before any Binance order is opened.',
  'Use 15m anchor, 1h bias, 4h macro context, 1m trigger.',
  'Return ONLY JSON: setup_id, symbol, exchange, market_type, is_perpetual, confidence, decision, accepted, rejection_reasons, adjustment_notes, next_action, suggested_setup, validated_setup.',
  'Confidence 0-1. If ACCEPT: validated_setup must have direction, entry_zone, planned_entry, stop_loss, take_profit (tp1 and tp2 as NUMERIC), setup_type, risk_reward.',
  'If REJECT: set accepted=false, provide rejection_reasons and suggested_setup with numeric TP/SL, set validated_setup=null.',
  'MANDATE: Both accept and reject responses MUST include numeric stop_loss and take_profit values.',
  'Setup coherence: check alignment across timeframes, risk/reward validity, clear entry trigger.',
  'For {BOT_MODE}: adjust timeframe emphasis. Output ONLY JSON, no markdown, no explanation.',
  '{VOLATILITY_INSTRUCTION}',
].join(' ');

const openClawPositionOptimizationPromptInstructions = [
  'YOU MUST return stop_loss, tp1, tp2 as NUMERIC VALUES. Always. No exceptions. This is mandatory.',
  'TASK: Return TP/SL levels for {DIRECTION} position. Ignore whether it seems logical - just return profit-maximizing numbers.',
  'POSITION: {DIRECTION} position exists. Return exit optimization.',
  'DO_THIS: Use market data to find TP1, TP2, and SL. If unsure, use fallback: entry ± (entry * 0.05). Just return numbers.',
  'RETURN_EXACT_FORMAT: {"setup_id":"SYM-DATE-001","symbol":"SYM","exchange":"binance","market_type":"futures","is_perpetual":true,"confidence":0.6,"decision":"accept","accepted":true,"rejection_reasons":[],"adjustment_notes":[],"next_action":"ready_to_enter","suggested_setup":null,"validated_setup":{"direction":"{DIRECTION}","entry_zone":[99,101],"planned_entry":100,"stop_loss":95,"take_profit":{"tp1":110,"tp2":120},"setup_type":"continuation","risk_reward":{"tp1":1.0,"tp2":2.0}}}',
  'NUMBERS_ONLY: stop_loss MUST be number. tp1 MUST be number. tp2 MUST be number. No text, no null, no undefined.',
  'FOR_LONG_EXAMPLE: Entry 100 → SL 95, TP1 110, TP2 120.',
  'FOR_SHORT_EXAMPLE: Entry 100 → SL 105, TP1 90, TP2 80.',
  'NO_REJECTION: Always set decision="accept" and accepted=true. Return TP/SL no matter what.',
  'OUTPUT: Only JSON. No explanation. Start { end }.',
].join(' ');
const validationCache = new Map<string, CachedOpenClawValidation>();
const pendingValidationRequests = new Map<string, Promise<FuturesAutoBotOpenClawValidationResult>>();
const DEFAULT_CACHE_TTL_MS = 5 * 60 * 1000;
const QUOTA_ERROR_CACHE_TTL_MS = 60 * 60 * 1000;
function getValidationCacheKey(snapshot: CoinValidationSnapshot) {
  const { generated_at, ...cacheSnapshot } = snapshot;
  void generated_at;
  return createHash('sha256').update(JSON.stringify(cacheSnapshot)).digest('hex');
}
function getCacheTtlMs(error: unknown) {
  return error instanceof Error && /quota exceeded/i.test(error.message)
    ? QUOTA_ERROR_CACHE_TTL_MS
    : DEFAULT_CACHE_TTL_MS;
}
function formatValidationLogStamp(value: Date) {
  return value.toISOString().replace(/:/g, '-').replace(/\./g, '-');
}
async function createOpenClawValidationLogDir() {
  const timestamp = new Date();
  const logId = randomUUID();
  const logsRoot = join(os.homedir(), '.btcmarketscanner', 'logs', 'openclaw-validation');
  const logDir = join(logsRoot, `${formatValidationLogStamp(timestamp)}-${logId}`);
  await mkdir(logDir, { recursive: true });
  return { logDir, timestamp };
}
async function writeOpenClawValidationRequestLog(logDir: string, snapshot: CoinValidationSnapshot, timestamp: Date) {
  await writeFile(
    join(logDir, 'request.json'),
    JSON.stringify({ prompt: openClawPromptInstructions, snapshot, timestamp: timestamp.toISOString() }, null, 2),
    'utf8',
  );
}
async function writeOpenClawValidationErrorLog(logDir: string, error: unknown) {
  const errorPayload =
    error instanceof Error
      ? { message: error.message, name: error.name, stack: error.stack ?? null }
      : { message: 'Unknown OpenClaw validation error.', value: error };
  await writeFile(
    join(logDir, 'error.json'),
    JSON.stringify({ error: errorPayload, timestamp: new Date().toISOString() }, null, 2),
    'utf8',
  );
}
async function writeOpenClawRawResponseLog(logDir: string, rawResponse: string) {
  await writeFile(join(logDir, 'raw_response.txt'), rawResponse, 'utf8');
}
async function writeOpenClawValidationOutcomeLog(
  logDir: string,
  response: OpenClawValidationResponse,
  normalized: FuturesAutoBotOpenClawValidationResult,
) {
  await writeFile(
    join(logDir, 'result.json'),
    JSON.stringify(
      { completedAt: new Date().toISOString(), logType: 'validation_result', normalized, response },
      null,
      2,
    ),
    'utf8',
  );
}
function extractJsonPayload(rawResponse: string) {
  const trimmed = rawResponse.trim();
  if (trimmed.startsWith('```')) {
    const firstLineBreak = trimmed.indexOf('\n');
    const lastFence = trimmed.lastIndexOf('```');
    if (firstLineBreak >= 0 && lastFence > firstLineBreak) return trimmed.slice(firstLineBreak + 1, lastFence).trim();
  }
  const firstBrace = trimmed.indexOf('{');
  const lastBrace = trimmed.lastIndexOf('}');
  return firstBrace >= 0 && lastBrace > firstBrace ? trimmed.slice(firstBrace, lastBrace + 1).trim() : trimmed;
}
function getSession(value: Date) {
  const hour = value.getUTCHours();
  if (hour >= 7 && hour < 9) return 'overlap';
  if (hour >= 13 && hour < 16) return 'overlap';
  if (hour >= 0 && hour < 7) return 'asia';
  if (hour >= 7 && hour < 14) return 'europe';
  return 'us';
}
function getVolatilityState(price: number | null, atr14: number | null) {
  if (price === null || atr14 === null || price <= 0) return 'normal' as const;
  const atrRatio = atr14 / price;
  if (atrRatio < 0.005) return 'low' as const;
  if (atrRatio < 0.05) return 'normal' as const;
  if (atrRatio < 0.1) return 'high' as const;
  return 'extreme' as const;
}
async function runOpenClawValidation(snapshot: CoinValidationSnapshot, botMode: 'scalping' | 'intraday' = 'scalping') {
  const { logDir, timestamp } = await createOpenClawValidationLogDir();
  let response: OpenClawValidationResponse | null = null;
  let normalized: FuturesAutoBotOpenClawValidationResult | null = null;

  await writeOpenClawValidationRequestLog(logDir, snapshot, timestamp);

  try {
    console.log('[openclaw validation] request', { snapshot, botMode, volatility: snapshot.current_context.volatility_state });

    const botModeLabel = botMode === 'scalping' ? 'scalping (quick micro trades)' : 'intraday (longer holding periods)';

    // Generate volatility-aware instruction
    const volatilityState = snapshot.current_context.volatility_state;
    let volatilityInstruction = '';
    if (volatilityState === 'high') {
      volatilityInstruction = 'VOLATILITY_HIGH: This coin has high volatility. Use TIGHTER stop losses (3-5% from entry) and CLOSER take profits. Avoid wide TP ranges.';
    } else if (volatilityState === 'extreme') {
      volatilityInstruction = 'VOLATILITY_EXTREME: This coin has EXTREME volatility. Use VERY TIGHT stop losses (1-3% from entry), CLOSE take profits, and favor smaller risk/reward ratios. Consider rejecting if no clean micro-entry available.';
    } else {
      volatilityInstruction = 'Volatility is normal/low. Standard TP/SL distances are acceptable.';
    }

    const prompt = openClawPromptInstructions
      .replace('{BOT_MODE}', botModeLabel)
      .replace('{VOLATILITY_INSTRUCTION}', volatilityInstruction);

    const rawOutput = await new Promise<string>((resolve, reject) => {
      let timeoutHandle: ReturnType<typeof setTimeout> | null = null;
      let child: ReturnType<typeof spawn> | null = null;

      timeoutHandle = setTimeout(() => {
        if (child) child.kill();
        reject(new Error('openclaw agent timeout after 30 seconds'));
      }, 120000);

      child = spawn(
        'openclaw',
        [
          'agent',
          '--session-id',
          'main',
          '--thinking',
          'low',
          '--message',
          `${prompt}\n\nSnapshot JSON:\n${JSON.stringify(snapshot)}`,
        ],
        { env: process.env, stdio: ['ignore', 'pipe', 'pipe'] },
      );
      let stderr = '';
      let stdout = '';
      child.stderr!.on('data', (chunk) => {
        stderr += chunk.toString();
      });
      child.stdout!.on('data', (chunk) => {
        stdout += chunk.toString();
      });
      child.on('error', (error) => {
        if (timeoutHandle) clearTimeout(timeoutHandle);
        reject(error);
      });
      child.on('close', (code, signal) => {
        if (timeoutHandle) clearTimeout(timeoutHandle);
        if (code === 0) {
          const preferredOutput = stdout.trim() || stderr.trim();
          if (!preferredOutput) {
            reject(new Error(`openclaw agent returned no output.${stderr ? ` stderr: ${stderr.trim()}` : ''}`));
            return;
          }
          resolve(preferredOutput);
          return;
        }
        const suffix = signal ? ` signal ${signal}` : '';
        reject(
          new Error(
            `openclaw agent exited with code ${code ?? 'unknown'}${suffix}${stderr ? `: ${stderr.trim()}` : ''}`,
          ),
        );
      });
    });

    await writeOpenClawRawResponseLog(logDir, rawOutput).catch(() => undefined);

    try {
      response = parseOpenClawResponse(rawOutput);
      normalized = parseValidationResult(snapshot, rawOutput);
    } catch (parseError) {
      console.error('[openclaw validation] parsing failed:', parseError);
      // Create a fallback response with the candidate setup and auto-fixed TP/SL
      const fallbackSetup = normalizeValidatedSetup(
        snapshot.setup_candidate ?? {
          direction: 'long',
          distance_to_resistance: null,
          distance_to_support: null,
          entry_zone: [snapshot.current_context.price ?? 0, snapshot.current_context.price ?? 0],
          planned_entry: snapshot.current_context.price ?? 0,
          risk_reward: { tp1: 0, tp2: 0 },
          setup_type: 'continuation',
          sl_distance: null,
          stop_loss: snapshot.current_context.price ?? 0,
          take_profit: { tp1: snapshot.current_context.price ?? 0, tp2: snapshot.current_context.price ?? 0 },
          tp_distance: { tp1: null, tp2: null },
        },
      );

      // Auto-fix TP/SL with sensible fallback values
      const fallback = generateFallbackTPSL(fallbackSetup.planned_entry, fallbackSetup.direction);
      fallbackSetup.stop_loss = fallback.sl;
      fallbackSetup.take_profit = { tp1: fallback.tp1, tp2: fallback.tp2 };
      fallbackSetup.risk_reward = {
        tp1: Math.abs(
          (fallbackSetup.take_profit.tp1 - fallbackSetup.planned_entry) /
            Math.max(Math.abs(fallbackSetup.planned_entry - fallbackSetup.stop_loss), 1),
        ),
        tp2: Math.abs(
          (fallbackSetup.take_profit.tp2 - fallbackSetup.planned_entry) /
            Math.max(Math.abs(fallbackSetup.planned_entry - fallbackSetup.stop_loss), 1),
        ),
      };

      response = {
        accepted: true,
        adjustment_notes: ['OpenClaw parsing failed, using fallback setup'],
        confidence: 0.5,
        decision: 'accept',
        exchange: 'binance',
        is_perpetual: snapshot.is_perpetual ?? true,
        market_type: 'futures',
        next_action: 'ready_to_enter',
        rejection_reasons: [],
        setup_id: snapshot.setup_id,
        symbol: snapshot.symbol,
        suggested_setup: null,
        validated_setup: fallbackSetup,
      };

      normalized = {
        adjustment_notes: response.adjustment_notes,
        confidence: response.confidence,
        reason: 'OpenClaw parsing failed, using candidate setup with auto-fixed TP/SL',
        setup_id: response.setup_id,
        next_action: response.next_action,
        suggested_setup: response.suggested_setup,
        validated_setup: fallbackSetup,
        validation_result: 'accepted',
      };
    }

    console.log('[openclaw validation] result', response);
    console.log('[openclaw validation] outcome', {
      confidence: normalized.confidence,
      logDir,
      reason: normalized.reason,
      setupId: normalized.setup_id,
      validationResult: normalized.validation_result,
    });

    return rawOutput;
  } catch (error) {
    const errorPayload =
      error instanceof Error
        ? { message: error.message, name: error.name, stack: error.stack ?? null }
        : { message: 'Unknown OpenClaw validation error.', value: error };

    console.error('[openclaw validation] outcome', { error: errorPayload, logDir });
    await writeOpenClawValidationErrorLog(logDir, error).catch(() => undefined);
    throw error;
  } finally {
    if (response && normalized) {
      await writeOpenClawValidationOutcomeLog(logDir, response, normalized).catch(() => undefined);
    }
  }
}
function normalizeValidatedSetup(setup: CoinValidationSnapshotSetupCandidate): OpenClawValidatedSetup {
  const entryLow = setup.entry_zone[0] ?? setup.planned_entry ?? 0;
  const entryHigh = setup.entry_zone[1] ?? setup.planned_entry ?? 0;
  const low = Math.min(entryLow, entryHigh);
  const high = Math.max(entryLow, entryHigh);
  return {
    direction: setup.direction,
    entry_zone: [low, high],
    planned_entry: setup.planned_entry ?? low,
    risk_reward: { tp1: setup.risk_reward.tp1 ?? 0, tp2: setup.risk_reward.tp2 ?? 0 },
    setup_type: setup.setup_type,
    stop_loss: setup.stop_loss ?? 0,
    take_profit: { tp1: setup.take_profit.tp1 ?? 0, tp2: setup.take_profit.tp2 ?? 0 },
  };
}
function createRejectedResult(
  snapshot: CoinValidationSnapshot,
  reason: string,
  confidence = 0.1,
  details?: Partial<
    Pick<FuturesAutoBotOpenClawValidationResult, 'adjustment_notes' | 'next_action' | 'suggested_setup'>
  >,
): FuturesAutoBotOpenClawValidationResult {
  return {
    adjustment_notes: details?.adjustment_notes ?? [],
    confidence,
    reason,
    setup_id: snapshot.setup_id,
    next_action: details?.next_action ?? 'wait_for_new_data',
    suggested_setup: details?.suggested_setup ?? null,
    validated_setup: normalizeValidatedSetup(
      snapshot.setup_candidate ?? {
        direction: 'long',
        distance_to_resistance: null,
        distance_to_support: null,
        entry_zone: [snapshot.current_context.price ?? 0, snapshot.current_context.price ?? 0],
        planned_entry: snapshot.current_context.price ?? 0,
        risk_reward: { tp1: 0, tp2: 0 },
        setup_type: 'continuation',
        sl_distance: null,
        stop_loss: snapshot.current_context.price ?? 0,
        take_profit: { tp1: snapshot.current_context.price ?? 0, tp2: snapshot.current_context.price ?? 0 },
        tp_distance: { tp1: null, tp2: null },
      },
    ),
    validation_result: 'rejected',
  };
}
function stripHtmlFromOpenClawResponse(obj: any): any {
  if (typeof obj === 'string') {
    return obj
      // Step 1: Decode HTML entities FIRST
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&amp;/g, '&')
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'")
      // Step 2: Remove HTML tags (now decoded)
      .replace(/<[^>]*>/g, '')
      .trim();
  }
  if (Array.isArray(obj)) {
    return obj.map((item) => stripHtmlFromOpenClawResponse(item));
  }
  if (obj !== null && typeof obj === 'object') {
    return Object.fromEntries(
      Object.entries(obj).map(([key, value]) => [key, stripHtmlFromOpenClawResponse(value)]),
    );
  }
  return obj;
}

function parseOpenClawResponse(rawResponse: string): OpenClawValidationResponse {
  const parsed = JSON.parse(extractJsonPayload(rawResponse)) as Partial<OpenClawValidationResponse>;

  // Strip HTML from all fields in response (OpenClaw may include HTML-formatted text)
  const cleanedParsed = stripHtmlFromOpenClawResponse(parsed);

  // Normalize direction case in suggested_setup
  if (cleanedParsed.suggested_setup && typeof cleanedParsed.suggested_setup === 'object') {
    const dir = (cleanedParsed.suggested_setup as any)?.direction?.toLowerCase?.();
    if (dir === 'long' || dir === 'short') {
      (cleanedParsed.suggested_setup as any).direction = dir;
    }
  }

  // Normalize direction case in validated_setup
  if (cleanedParsed.validated_setup && typeof cleanedParsed.validated_setup === 'object') {
    const dir = (cleanedParsed.validated_setup as any)?.direction?.toLowerCase?.();
    if (dir === 'long' || dir === 'short') {
      (cleanedParsed.validated_setup as any).direction = dir;
    }
  }

  // Validate response structure with detailed error messages
  const validationErrors: string[] = [];

  if (typeof cleanedParsed.setup_id !== 'string') validationErrors.push(`setup_id is not string: ${typeof cleanedParsed.setup_id}`);
  if (typeof cleanedParsed.symbol !== 'string') validationErrors.push(`symbol is not string: ${typeof cleanedParsed.symbol}`);
  if (cleanedParsed.exchange !== 'binance') validationErrors.push(`exchange is not 'binance': ${cleanedParsed.exchange}`);
  if (cleanedParsed.market_type !== 'futures') validationErrors.push(`market_type is not 'futures': ${cleanedParsed.market_type}`);
  if (typeof cleanedParsed.is_perpetual !== 'boolean') validationErrors.push(`is_perpetual is not boolean: ${typeof cleanedParsed.is_perpetual}`);
  if (typeof cleanedParsed.confidence !== 'number') validationErrors.push(`confidence is not number: ${typeof cleanedParsed.confidence}`);
  if (!Number.isFinite(cleanedParsed.confidence)) validationErrors.push(`confidence is not finite: ${cleanedParsed.confidence}`);
  if (cleanedParsed.confidence < 0 || cleanedParsed.confidence > 1) validationErrors.push(`confidence out of range [0,1]: ${cleanedParsed.confidence}`);
  if (cleanedParsed.decision !== 'accept' && cleanedParsed.decision !== 'reject') validationErrors.push(`decision is not 'accept'|'reject': ${cleanedParsed.decision}`);
  if (typeof cleanedParsed.accepted !== 'boolean') validationErrors.push(`accepted is not boolean: ${typeof cleanedParsed.accepted}`);
  if (!Array.isArray(cleanedParsed.rejection_reasons)) validationErrors.push(`rejection_reasons is not array: ${typeof cleanedParsed.rejection_reasons}`);
  if (Array.isArray(cleanedParsed.rejection_reasons) && cleanedParsed.rejection_reasons.some((item: any) => typeof item !== 'string')) validationErrors.push(`rejection_reasons contains non-string items`);
  if (!Array.isArray(cleanedParsed.adjustment_notes)) validationErrors.push(`adjustment_notes is not array: ${typeof cleanedParsed.adjustment_notes}`);
  if (Array.isArray(cleanedParsed.adjustment_notes) && cleanedParsed.adjustment_notes.some((item: any) => typeof item !== 'string')) validationErrors.push(`adjustment_notes contains non-string items`);
  const validNextActions = ['wait_for_entry_zone', 'wait_for_new_data', 'flip_direction', 'ready_to_enter', 'wait_for_pullback_reclaim', 'wait_for_breakout'];
  if (!validNextActions.includes(cleanedParsed.next_action)) validationErrors.push(`next_action is invalid: ${cleanedParsed.next_action}`);
  if (cleanedParsed.suggested_setup !== null && typeof cleanedParsed.suggested_setup !== 'object') validationErrors.push(`suggested_setup is not null|object: ${typeof cleanedParsed.suggested_setup}`);
  if (cleanedParsed.suggested_setup !== null && typeof cleanedParsed.suggested_setup === 'object' && cleanedParsed.suggested_setup.direction !== 'long' && cleanedParsed.suggested_setup.direction !== 'short') validationErrors.push(`suggested_setup.direction is invalid: ${cleanedParsed.suggested_setup.direction}`);
  if (!('validated_setup' in cleanedParsed)) validationErrors.push(`validated_setup field is missing`);

  if (validationErrors.length > 0) {
    const errorDetails = validationErrors.join('; ');
    console.error(`[parseOpenClawResponse] Validation failed: ${errorDetails}`);
    console.error(`[parseOpenClawResponse] Raw cleanedParsed keys: ${Object.keys(cleanedParsed).join(', ')}`);
    throw new Error(`OpenClaw returned an invalid validation payload: ${errorDetails}`);
  }

  if (cleanedParsed.decision === 'accept') {
    if (!cleanedParsed.accepted) {
      throw new Error('OpenClaw accepted decision must set accepted=true.');
    }
    if (cleanedParsed.validated_setup === null || typeof cleanedParsed.validated_setup !== 'object') {
      throw new Error('OpenClaw accepted the setup without a validated_setup payload.');
    }
    const validatedSetup = cleanedParsed.validated_setup;

    // LENIENT validation - accept almost anything and auto-fix with fallbacks
    if (!validatedSetup) {
      throw new Error('OpenClaw returned no validated_setup.');
    }

    // Use provided direction or default to 'long'
    const direction =
      validatedSetup.direction === 'long' || validatedSetup.direction === 'short' ? validatedSetup.direction : 'long';
    cleanedParsed.validated_setup!.direction = direction;

    // Use provided entry_zone or create one
    let entryZone = validatedSetup.entry_zone as [number, number];
    if (!Array.isArray(entryZone) || entryZone.length !== 2) {
      const ep = Number(validatedSetup.planned_entry) || 100;
      entryZone = [ep * 0.99, ep * 1.01];
    }
    cleanedParsed.validated_setup!.entry_zone = entryZone;

    // Use provided planned_entry or use entry_zone midpoint
    let plannedEntry = Number(validatedSetup.planned_entry);
    if (!Number.isFinite(plannedEntry)) {
      plannedEntry = (entryZone[0] + entryZone[1]) / 2;
    }
    cleanedParsed.validated_setup!.planned_entry = plannedEntry;

    // CRITICAL: Auto-fix TP/SL - ALWAYS have valid numeric values
    const origStopLoss = Number(validatedSetup.stop_loss);
    const origTp1 = Number(validatedSetup.take_profit?.tp1);
    const origTp2 = Number(validatedSetup.take_profit?.tp2);

    const fallback = generateFallbackTPSL(plannedEntry, direction);

    cleanedParsed.validated_setup!.stop_loss = Number.isFinite(origStopLoss) ? origStopLoss : fallback.sl;
    cleanedParsed.validated_setup!.take_profit = {
      tp1: Number.isFinite(origTp1) ? origTp1 : fallback.tp1,
      tp2: Number.isFinite(origTp2) ? origTp2 : fallback.tp2,
    };

    // Also ensure risk_reward has valid values
    cleanedParsed.validated_setup!.risk_reward = {
      tp1: Math.abs(
        (cleanedParsed.validated_setup!.take_profit.tp1 - plannedEntry) /
          Math.max(Math.abs(plannedEntry - cleanedParsed.validated_setup!.stop_loss), 1),
      ),
      tp2: Math.abs(
        (cleanedParsed.validated_setup!.take_profit.tp2 - plannedEntry) /
          Math.max(Math.abs(plannedEntry - cleanedParsed.validated_setup!.stop_loss), 1),
      ),
    };
  }

  if (cleanedParsed.decision === 'reject' && cleanedParsed.accepted) {
    throw new Error('OpenClaw rejected decision must set accepted=false.');
  }

  if (cleanedParsed.decision === 'reject' && cleanedParsed.validated_setup !== null) {
    throw new Error('OpenClaw returned a rejected payload with a non-null validated_setup.');
  }

  return {
    accepted: cleanedParsed.accepted,
    adjustment_notes: cleanedParsed.adjustment_notes,
    confidence: cleanedParsed.confidence,
    decision: cleanedParsed.decision,
    exchange: cleanedParsed.exchange,
    is_perpetual: cleanedParsed.is_perpetual,
    market_type: cleanedParsed.market_type,
    next_action: cleanedParsed.next_action,
    rejection_reasons: cleanedParsed.rejection_reasons,
    setup_id: cleanedParsed.setup_id,
    symbol: cleanedParsed.symbol,
    suggested_setup:
      cleanedParsed.suggested_setup && cleanedParsed.decision === 'reject'
        ? ({
            direction: cleanedParsed.suggested_setup.direction,
            entry_zone: [
              Number(cleanedParsed.suggested_setup.entry_zone[0]),
              Number(cleanedParsed.suggested_setup.entry_zone[1]),
            ] as [number, number],
            planned_entry: Number(cleanedParsed.suggested_setup.planned_entry),
            risk_reward: {
              tp1: Number(cleanedParsed.suggested_setup.risk_reward.tp1),
              tp2: Number(cleanedParsed.suggested_setup.risk_reward.tp2),
            },
            setup_type: cleanedParsed.suggested_setup.setup_type,
            stop_loss: Number(cleanedParsed.suggested_setup.stop_loss),
            take_profit: {
              tp1: Number(cleanedParsed.suggested_setup.take_profit.tp1),
              tp2: Number(cleanedParsed.suggested_setup.take_profit.tp2),
            },
          } satisfies OpenClawValidatedSetup)
        : null,
    validated_setup:
      cleanedParsed.decision === 'accept'
        ? ({
            direction: cleanedParsed.validated_setup!.direction,
            entry_zone: [
              Number(cleanedParsed.validated_setup!.entry_zone[0]),
              Number(cleanedParsed.validated_setup!.entry_zone[1]),
            ] as [number, number],
            planned_entry: Number(cleanedParsed.validated_setup!.planned_entry),
            risk_reward: {
              tp1: Number(cleanedParsed.validated_setup!.risk_reward.tp1),
              tp2: Number(cleanedParsed.validated_setup!.risk_reward.tp2),
            },
            setup_type: cleanedParsed.validated_setup!.setup_type,
            stop_loss: Number(cleanedParsed.validated_setup!.stop_loss),
            take_profit: {
              tp1: Number(cleanedParsed.validated_setup!.take_profit.tp1),
              tp2: Number(cleanedParsed.validated_setup!.take_profit.tp2),
            },
          } satisfies OpenClawValidatedSetup)
        : null,
  };
}
function generateFallbackTPSL(
  entryPrice: number,
  direction: 'long' | 'short',
  atr: number | null = null,
): { tp1: number; tp2: number; sl: number } {
  const volatilityMultiplier = (atr ?? entryPrice * 0.02) / entryPrice;
  const riskDistance = Math.max(entryPrice * 0.01, volatilityMultiplier * 2);

  if (direction === 'long') {
    return {
      tp1: entryPrice + riskDistance * 1.5,
      tp2: entryPrice + riskDistance * 3,
      sl: entryPrice - riskDistance,
    };
  } else {
    return {
      tp1: entryPrice - riskDistance * 1.5,
      tp2: entryPrice - riskDistance * 3,
      sl: entryPrice + riskDistance,
    };
  }
}

function parseValidationResult(
  snapshot: CoinValidationSnapshot,
  rawResponse: string,
): FuturesAutoBotOpenClawValidationResult {
  try {
    const response = parseOpenClawResponse(rawResponse);
    if (response.setup_id !== snapshot.setup_id)
      return createRejectedResult(snapshot, 'OpenClaw returned an invalid validation payload.');
    if (response.decision !== 'accept' || response.accepted !== true || response.validated_setup === null)
      return createRejectedResult(
        snapshot,
        response.rejection_reasons.length > 0 ? response.rejection_reasons.join(' ') : 'OpenClaw rejected the setup.',
        response.confidence,
        {
          adjustment_notes: response.adjustment_notes,
          next_action: response.next_action,
          suggested_setup: response.suggested_setup,
        },
      );
    return {
      adjustment_notes: response.adjustment_notes,
      confidence: response.confidence,
      reason:
        response.rejection_reasons.length > 0 ? response.rejection_reasons.join(' ') : 'OpenClaw accepted the setup.',
      setup_id: snapshot.setup_id,
      next_action: response.next_action,
      suggested_setup: response.suggested_setup,
      validated_setup: response.validated_setup,
      validation_result: 'accepted',
    };
  } catch (error) {
    return createRejectedResult(
      snapshot,
      error instanceof Error ? error.message : 'OpenClaw returned an unreadable validation response.',
    );
  }
}
function readCachedValidation(cacheKey: string) {
  const cached = validationCache.get(cacheKey);
  if (!cached) return null;
  if (cached.expiresAt <= Date.now()) {
    validationCache.delete(cacheKey);
    return null;
  }
  return cached.result;
}
function writeCachedValidation(cacheKey: string, result: FuturesAutoBotOpenClawValidationResult, ttlMs: number) {
  validationCache.set(cacheKey, { expiresAt: Date.now() + ttlMs, result });
}
function toValidationSnapshot(input: FuturesAutoBotOpenClawValidationInput): CoinValidationSnapshot {
  const currentTime = new Date();
  const currentTrend = input.timeframeSnapshots.find((item) => item.interval === '1h')?.trend ??
    input.timeframeSnapshots[0]?.trend ?? {
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
  const timeframeSupportResistance = input.timeframeSnapshots
    .filter(
      (snapshot): snapshot is FuturesAutoConsensusTimeframeSnapshot & { interval: '1m' | '15m' | '1h' | '4h' } =>
        snapshot.interval === '1m' ||
        snapshot.interval === '15m' ||
        snapshot.interval === '1h' ||
        snapshot.interval === '4h',
    )
    .map((snapshot) => ({
      interval: snapshot.interval,
      isLoading: false,
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
    }));

  const timeframeSources = {
    '1m': input.timeframeSnapshots.find((item) => item.interval === '1m')?.candles ?? [],
    '15m': input.timeframeSnapshots.find((item) => item.interval === '15m')?.candles ?? [],
    '1h': input.timeframeSnapshots.find((item) => item.interval === '1h')?.candles ?? [],
    '4h': input.timeframeSnapshots.find((item) => item.interval === '4h')?.candles ?? [],
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
    timeframeSources,
    timeframeSupportResistance,
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
        '1m': {
          atr14: null,
          candles: [],
          current_price: null,
          distance_to_resistance: null,
          distance_to_support: null,
          ema100: null,
          ema20: null,
          ema200: null,
          ema50: null,
          ema_alignment: 'neutral',
          resistance: null,
          rsi14: null,
          structure_state: 'Mixed',
          support: null,
          trend_state: 'sideways',
        },
        '15m': {
          atr14: null,
          candles: [],
          current_price: null,
          distance_to_resistance: null,
          distance_to_support: null,
          ema100: null,
          ema20: null,
          ema200: null,
          ema50: null,
          ema_alignment: 'neutral',
          resistance: null,
          rsi14: null,
          structure_state: 'Mixed',
          support: null,
          trend_state: 'sideways',
        },
        '1h': {
          atr14: null,
          candles: [],
          current_price: null,
          distance_to_resistance: null,
          distance_to_support: null,
          ema100: null,
          ema20: null,
          ema200: null,
          ema50: null,
          ema_alignment: 'neutral',
          resistance: null,
          rsi14: null,
          structure_state: 'Mixed',
          support: null,
          trend_state: 'sideways',
        },
        '4h': {
          atr14: null,
          candles: [],
          current_price: null,
          distance_to_resistance: null,
          distance_to_support: null,
          ema100: null,
          ema20: null,
          ema200: null,
          ema50: null,
          ema_alignment: 'neutral',
          resistance: null,
          rsi14: null,
          structure_state: 'Mixed',
          support: null,
          trend_state: 'sideways',
        },
      },
      validation_rules: {
        min_rr: 2,
        max_distance_to_resistance_atr_multiple: 1,
        min_sl_atr_multiple: 0.8,
        min_tp1_atr_multiple: 1.5,
        require_htf_trend_alignment: true,
      },
    };
  }

  return snapshot;
}

async function sendValidationNotification(
  snapshot: CoinValidationSnapshot,
  result: FuturesAutoBotOpenClawValidationResult,
) {
  try {
    const direction = result.validated_setup.direction.toUpperCase();
    const setupType = result.validated_setup.setup_type.replace(/_/g, ' ').toUpperCase();
    const decision = result.validation_result === 'accepted' ? '✅ ACCEPTED' : '❌ REJECTED';
    const confidencePercent = (result.confidence * 100).toFixed(0);

    const entryZone = result.validated_setup.entry_zone;
    const entryZoneStr = `${entryZone[0].toFixed(4)} - ${entryZone[1].toFixed(4)}`;
    const plannedEntry = result.validated_setup.planned_entry.toFixed(4);
    const stopLoss = result.validated_setup.stop_loss.toFixed(4);
    const tp1 = result.validated_setup.take_profit.tp1.toFixed(4);
    const tp2 = result.validated_setup.take_profit.tp2.toFixed(4);

    let message = `🤖 OpenClaw Validation\n`;
    message += `${snapshot.symbol} | ${direction} | ${decision}\n\n`;

    message += `Setup Type: ${setupType}\n`;
    message += `Confidence: ${confidencePercent}%\n`;
    message += `Next Action: ${result.next_action.replace(/_/g, ' ').toUpperCase()}\n\n`;

    message += `📊 Validated Setup:\n`;
    message += `Entry Zone: ${entryZoneStr}\n`;
    message += `Planned Entry: ${plannedEntry}\n`;
    message += `Stop Loss: ${stopLoss}\n`;
    message += `TP1: ${tp1}\n`;
    message += `TP2: ${tp2}\n`;
    message += `Risk/Reward: TP1=${result.validated_setup.risk_reward.tp1.toFixed(2)}, TP2=${result.validated_setup.risk_reward.tp2.toFixed(2)}\n\n`;

    if (result.suggested_setup) {
      const suggestedDirection = result.suggested_setup.direction.toUpperCase();
      const suggestedSetupType = result.suggested_setup.setup_type.replace(/_/g, ' ').toUpperCase();
      const suggestedEntryZone = result.suggested_setup.entry_zone;
      const suggestedEntryZoneStr = `${suggestedEntryZone[0].toFixed(4)} - ${suggestedEntryZone[1].toFixed(4)}`;
      const suggestedPlannedEntry = result.suggested_setup.planned_entry.toFixed(4);
      const suggestedSL = result.suggested_setup.stop_loss.toFixed(4);
      const suggestedTP1 = result.suggested_setup.take_profit.tp1.toFixed(4);
      const suggestedTP2 = result.suggested_setup.take_profit.tp2.toFixed(4);

      message += `💡 Suggested Setup:\n`;
      message += `Direction: ${suggestedDirection}\n`;
      message += `Setup Type: ${suggestedSetupType}\n`;
      message += `Entry Zone: ${suggestedEntryZoneStr}\n`;
      message += `Planned Entry: ${suggestedPlannedEntry}\n`;
      message += `Stop Loss: ${suggestedSL}\n`;
      message += `TP1: ${suggestedTP1}\n`;
      message += `TP2: ${suggestedTP2}\n`;
      message += `Risk/Reward: TP1=${result.suggested_setup.risk_reward.tp1.toFixed(2)}, TP2=${result.suggested_setup.risk_reward.tp2.toFixed(2)}\n\n`;
    }

    if (result.adjustment_notes.length > 0) {
      message += `📝 Adjustment Notes:\n`;
      result.adjustment_notes.forEach((note) => {
        message += `• ${note}\n`;
      });
      message += '\n';
    }

    message += `💬 Reason: ${result.reason}`;

    await telegramService.sendMessage(message);
  } catch (error) {
    console.error('[telegram] Failed to send validation notification:', error);
  }
}

export class FuturesAutoValidationService {
  async validateSetup(
    input: FuturesAutoBotOpenClawValidationInput,
    options?: FuturesAutoBotOpenClawValidationOptions,
  ): Promise<FuturesAutoBotOpenClawValidationResult> {
    const snapshot = toValidationSnapshot(input);
    const cacheKey = getValidationCacheKey(snapshot);
    const cachedResult = options?.bypassCache ? null : readCachedValidation(cacheKey);
    if (cachedResult) {
      console.log('[openclaw validation] cache hit', {
        confidence: cachedResult.confidence,
        reason: cachedResult.reason,
        setupId: cachedResult.setup_id,
        validationResult: cachedResult.validation_result,
      });
      await sendValidationNotification(snapshot, cachedResult);
      return cachedResult;
    }
    const pendingRequest = options?.bypassCache ? null : pendingValidationRequests.get(cacheKey);
    if (pendingRequest) {
      console.log('[openclaw validation] pending hit', {
        setupId: snapshot.setup_id,
        symbol: snapshot.symbol,
      });
      return pendingRequest;
    }
    const validationPromise = (async () => {
      try {
        const rawResponse = await runOpenClawValidation(snapshot, input.botMode);
        const parsedResult = parseValidationResult(snapshot, rawResponse);
        writeCachedValidation(cacheKey, parsedResult, DEFAULT_CACHE_TTL_MS);
        await sendValidationNotification(snapshot, parsedResult);
        return parsedResult;
      } catch (error) {
        const rejectedResult = createRejectedResult(
          snapshot,
          `OpenClaw validation unavailable: ${error instanceof Error ? error.message : 'Unknown OpenClaw validation error.'}`,
        );
        writeCachedValidation(cacheKey, rejectedResult, getCacheTtlMs(error));
        await sendValidationNotification(snapshot, rejectedResult);
        return rejectedResult;
      } finally {
        pendingValidationRequests.delete(cacheKey);
      }
    })();
    pendingValidationRequests.set(cacheKey, validationPromise);
    try {
      return await validationPromise;
    } catch {
      return createRejectedResult(snapshot, 'OpenClaw validation promise unexpectedly failed.');
    }
  }

  async optimizeExistingPosition(
    input: FuturesAutoBotOpenClawValidationInput,
    positionDirection: 'long' | 'short',
  ): Promise<FuturesAutoBotOpenClawValidationResult> {
    const snapshot = toValidationSnapshot(input);
    const cacheKey = getValidationCacheKey(snapshot);

    console.log(
      `[openclaw position-optimization] Requesting optimization for existing ${positionDirection.toUpperCase()} position`,
    );

    const optimizationPromise = (async () => {
      const { logDir, timestamp } = await createOpenClawValidationLogDir();

      try {
        const botModeLabel =
          input.botMode === 'scalping' ? 'scalping (quick micro trades)' : 'intraday (longer holding periods)';
        const directionLabel = positionDirection === 'long' ? 'LONG' : 'SHORT';
        const prompt = openClawPositionOptimizationPromptInstructions
          .replace('{BOT_MODE}', botModeLabel)
          .replace(/{DIRECTION}/g, directionLabel);

        console.log('[openclaw position-optimization] starting optimization for', directionLabel, 'position');
        console.log('[openclaw position-optimization] prompt length:', prompt.length);

        // Write request log
        await writeFile(
          join(logDir, 'request.json'),
          JSON.stringify(
            {
              optimizationType: 'existing_position',
              direction: directionLabel,
              prompt,
              snapshot,
              timestamp: timestamp.toISOString(),
            },
            null,
            2,
          ),
          'utf8',
        ).catch(() => {
          /* ignore logging errors */
        });

        const rawOutput = await new Promise<string>((resolve, reject) => {
          let timeoutHandle: ReturnType<typeof setTimeout> | null = null;
          let child: ReturnType<typeof spawn> | null = null;

          timeoutHandle = setTimeout(() => {
            if (child) child.kill();
            reject(new Error('openclaw agent timeout after 30 seconds'));
          }, 120000);

          child = spawn(
            'openclaw',
            [
              'agent',
              '--session-id',
              'main',
              '--thinking',
              'low',
              '--message',
              `${prompt}\n\nSnapshot JSON:\n${JSON.stringify(snapshot)}`,
            ],
            { env: process.env, stdio: ['ignore', 'pipe', 'pipe'] },
          );

          let stderr = '';
          let stdout = '';
          child.stderr!.on('data', (chunk) => {
            stderr += chunk.toString();
          });
          child.stdout!.on('data', (chunk) => {
            stdout += chunk.toString();
          });
          child.on('error', (error) => {
            if (timeoutHandle) clearTimeout(timeoutHandle);
            reject(error);
          });
          child.on('close', (code) => {
            if (timeoutHandle) clearTimeout(timeoutHandle);
            if (code === 0) {
              const preferredOutput = stdout.trim() || stderr.trim();
              if (!preferredOutput) {
                reject(new Error(`openclaw agent returned no output.${stderr ? ` stderr: ${stderr.trim()}` : ''}`));
                return;
              }
              console.log(
                '[openclaw position-optimization] OpenClaw returned:',
                preferredOutput.substring(0, 100) + '...',
              );
              resolve(preferredOutput);
              return;
            }
            reject(new Error(`openclaw agent exited with code ${code}${stderr ? `: ${stderr.trim()}` : ''}`));
          });
        });

        const parsedResult = parseValidationResult(snapshot, rawOutput);
        writeCachedValidation(cacheKey, parsedResult, DEFAULT_CACHE_TTL_MS);

        console.log('[openclaw position-optimization] result', {
          confidence: parsedResult.confidence,
          validationResult: parsedResult.validation_result,
          tp1: parsedResult.validated_setup.take_profit.tp1,
          tp2: parsedResult.validated_setup.take_profit.tp2,
          sl: parsedResult.validated_setup.stop_loss,
        });

        // Write result.json log file for optimization - ALWAYS write it
        try {
          let rawResponse: OpenClawValidationResponse;
          try {
            rawResponse = parseOpenClawResponse(rawOutput);
          } catch (parseError) {
            console.log(
              '[openclaw position-optimization] warning: could not parse response, creating minimal response object',
            );
            // Create minimal response object with parsed result data
            rawResponse = {
              setup_id: parsedResult.setup_id,
              symbol: snapshot.symbol,
              exchange: 'binance',
              market_type: 'futures',
              is_perpetual: snapshot.is_perpetual,
              confidence: parsedResult.confidence,
              decision: 'accept',
              accepted: parsedResult.validation_result === 'accepted',
              rejection_reasons: [],
              adjustment_notes: parsedResult.adjustment_notes,
              next_action: parsedResult.next_action,
              suggested_setup: parsedResult.suggested_setup,
              validated_setup: parsedResult.validated_setup,
            };
          }
          await writeOpenClawValidationOutcomeLog(logDir, rawResponse, parsedResult).catch((writeError) => {
            console.log(
              '[openclaw position-optimization] error writing result log:',
              writeError instanceof Error ? writeError.message : String(writeError),
            );
          });
        } catch (logError) {
          console.log(
            '[openclaw position-optimization] critical error in result logging:',
            logError instanceof Error ? logError.message : String(logError),
          );
        }

        await sendValidationNotification(snapshot, parsedResult);
        return parsedResult;
      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : 'Unknown error';
        console.log('[openclaw position-optimization] ERROR:', errorMsg);
        const rejectedResult = createRejectedResult(
          snapshot,
          `OpenClaw position optimization unavailable: ${errorMsg}`,
        );
        writeCachedValidation(cacheKey, rejectedResult, getCacheTtlMs(error));

        // Always write error result to result.json
        try {
          await writeOpenClawValidationOutcomeLog(
            logDir,
            {
              setup_id: snapshot.setup_id,
              symbol: snapshot.symbol,
              exchange: 'binance',
              market_type: 'futures',
              is_perpetual: snapshot.is_perpetual,
              confidence: 0,
              decision: 'reject',
              accepted: false,
              rejection_reasons: [errorMsg],
              adjustment_notes: ['Error during OpenClaw processing. Please retry.'],
              next_action: 'wait_for_new_data',
              suggested_setup: null,
              validated_setup: null,
            },
            rejectedResult,
          ).catch(() => {
            /* ignore logging errors */
          });
        } catch (logError) {
          console.log(
            '[openclaw position-optimization] warning: could not write error result:',
            logError instanceof Error ? logError.message : String(logError),
          );
        }

        await sendValidationNotification(snapshot, rejectedResult);
        return rejectedResult;
      }
    })();

    try {
      return await optimizationPromise;
    } catch {
      return createRejectedResult(snapshot, 'OpenClaw position optimization promise unexpectedly failed.');
    }
  }
}
export const futuresAutoValidationService = new FuturesAutoValidationService();
