// Mods API answers ($.session.usage(), model(), cwd()) plus the tracker → core Snapshot.

import { EMPTY_LIMIT_HISTORY } from '../core/limit-history.mjs';
import { cacheHitRatio } from '../core/metrics.mjs';
import { prettyModelName } from '../core/model-name.mjs';
import { folderName } from '../core/paths.mjs';
import { promptCacheAfter } from '../core/prompt-cache.mjs';
import { numberOrNull, recordOf } from '../core/values.mjs';
import { initialTracker } from './tracker.mjs';

/**
 * @param {{
 *   usage: Record<string, unknown> | null, modelRaw: unknown, cwd: unknown,
 *   tracker: import('./tracker.mjs').Tracker | null, nowMs: number, timeZone?: string | null,
 *   limitReadings?: import('../core/limit-history.mjs').LimitReadings, cacheTtlMs?: number | null,
 * }} sources `cacheTtlMs`: the main conversation's cache lifetime, null when unknown
 * @returns {import('../core/layout.mjs').Snapshot}
 */
export function snapshotFromSession({
  usage, modelRaw, cwd, tracker, nowMs, timeZone = null, limitReadings, cacheTtlMs = null,
}) {
  const figures = recordOf(usage);
  const state = tracker ?? initialTracker();
  const context = recordOf(figures.context);
  const startedAt = numberOrNull(figures.startedAt);
  return {
    nowMs,
    timeZone,
    project: folderName(cwd),
    git: state.git ?? null,
    modelName: prettyModelName(modelRaw),
    costUsd: numberOrNull(recordOf(figures.cost).usd),
    durationMs: startedAt !== null && nowMs >= startedAt ? nowMs - startedAt : null,
    cacheHitRatio: cacheHitRatio({
      inputTokens: state.cache.input,
      cacheCreationTokens: state.cache.creation,
      cacheReadTokens: state.cache.read,
    }),
    promptCache: Number.isFinite(cacheTtlMs) ? promptCacheAfter(state.lastTurn ?? null, cacheTtlMs) : null,
    effort: state.effort ?? null,
    linesChanged: null, // the mods API has no count of changed lines; the terminal gets Claude Code's own
    context: {
      usedTokens: numberOrNull(context.tokens),
      windowTokens: numberOrNull(context.window),
      percent: numberOrNull(context.percent),
    },
    contextHistory: [...state.history],
    limits: limitsFromRateLimits(figures.rateLimits, nowMs),
    limitReadings: limitReadings ?? EMPTY_LIMIT_HISTORY.readings,
  };
}

/**
 * The 7-day and 5-hour readings among the windows the last response reported.
 * @param {unknown} windows `rateLimits` of `$.session.usage()` or of `session.measure`
 * @param {number} nowMs
 * @returns {import('../core/limit-history.mjs').Limits}
 */
export function limitsFromRateLimits(windows, nowMs) {
  const list = Array.isArray(windows) ? windows : [];
  return {
    sevenDay: limitReading(list, 'seven_day', nowMs),
    fiveHour: limitReading(list, 'five_hour', nowMs),
  };
}

// A window whose reset time has passed is stale; the terminal's stdin drops it the same way.
function limitReading(windows, kind, nowMs) {
  const window = recordOf(windows.find((candidate) => candidate?.kind === kind));
  const percentUsed = numberOrNull(window.percentUsed);
  if (percentUsed === null) return null;
  const parsed = typeof window.resetsAt === 'string' ? Date.parse(window.resetsAt) : NaN;
  const resetsAtMs = Number.isFinite(parsed) ? parsed : null;
  if (resetsAtMs !== null && resetsAtMs <= nowMs) return null;
  return { percentUsed, resetsAtMs };
}
