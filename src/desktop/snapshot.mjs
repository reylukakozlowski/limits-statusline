// Mods API answers ($.session.usage(), model(), cwd()) plus the tracker → core Snapshot.

import { cacheHitRatio } from '../core/metrics.mjs';
import { prettyModelName } from '../core/model-name.mjs';
import { folderName } from '../core/paths.mjs';
import { numberOrNull, recordOf } from '../core/values.mjs';
import { initialTracker } from './tracker.mjs';

/**
 * @param {{
 *   usage: Record<string, unknown> | null, modelRaw: unknown, cwd: unknown,
 *   tracker: import('./tracker.mjs').Tracker | null, nowMs: number,
 * }} sources
 * @returns {import('../core/layout.mjs').Snapshot}
 */
export function snapshotFromSession({ usage, modelRaw, cwd, tracker, nowMs }) {
  const figures = recordOf(usage);
  const state = tracker ?? initialTracker();
  const context = recordOf(figures.context);
  const windows = Array.isArray(figures.rateLimits) ? figures.rateLimits : [];
  const startedAt = numberOrNull(figures.startedAt);
  return {
    nowMs,
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
    effort: state.effort ?? null,
    context: {
      usedTokens: numberOrNull(context.tokens),
      windowTokens: numberOrNull(context.window),
      percent: numberOrNull(context.percent),
    },
    contextHistory: [...state.history],
    limits: {
      sevenDay: limitReading(windows, 'seven_day', nowMs),
      fiveHour: limitReading(windows, 'five_hour', nowMs),
    },
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
