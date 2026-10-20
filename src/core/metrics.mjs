// Plan-limit arithmetic: the recent pace (pace.mjs) extended to the reset, the time left until
// the limit runs out at that pace, and the prompt-cache hit ratio.

import { currentPercent, recentRate } from './pace.mjs';
import { MS_PER_HOUR } from './time.mjs';

/** Usage at which a limit runs out. */
export const FULL_PERCENT = 100;

/**
 * @typedef {{ percentUsed: number, resetsAtMs: number | null }} LimitReading
 * @typedef {{ percentUsed: number, remainingMs: number | null, ratePerHour: number | null,
 *             projectedPercent: number | null, limitInMs: number | null }} LimitAnalysis
 * `limitInMs` is set only when the limit runs out before the reset at the current pace.
 */

/**
 * @param {LimitReading | null} reading the session's figure for this window
 * @param {import('./limit-windows.mjs').LimitWindow} window
 * @param {number} nowMs
 * @param {import('./limit-history.mjs').LimitPoint[]} [points] shared readings of this kind
 * @returns {LimitAnalysis | null} null when there is no usable usage figure
 */
export function analyzeLimit(reading, window, nowMs, points = []) {
  if (!reading || !Number.isFinite(reading.percentUsed)) return null;
  const unknown = { ratePerHour: null, projectedPercent: null, limitInMs: null };
  if (!Number.isFinite(reading.resetsAtMs)) return { percentUsed: reading.percentUsed, remainingMs: null, ...unknown };
  const percentUsed = currentPercent(points, reading, nowMs);
  const remainingMs = Math.max(0, reading.resetsAtMs - nowMs);
  const ratePerHour = recentRate(points, reading, window, nowMs);
  if (ratePerHour === null) return { percentUsed, remainingMs, ...unknown };
  return {
    percentUsed,
    remainingMs,
    ratePerHour,
    projectedPercent: percentUsed + ratePerHour * (remainingMs / MS_PER_HOUR),
    limitInMs: timeUntilFull(percentUsed, ratePerHour, remainingMs),
  };
}

function timeUntilFull(percentUsed, ratePerHour, remainingMs) {
  if (percentUsed >= FULL_PERCENT || !(ratePerHour > 0)) return null;
  const untilFullMs = ((FULL_PERCENT - percentUsed) / ratePerHour) * MS_PER_HOUR;
  return untilFullMs < remainingMs ? untilFullMs : null;
}

const tokens = (value) => (Number.isFinite(value) && value > 0 ? value : 0);

/**
 * Share of input tokens served from the prompt cache, 0–1; null when nothing was counted.
 * @param {{ inputTokens?: number, cacheCreationTokens?: number, cacheReadTokens?: number } | null} usage
 */
export function cacheHitRatio(usage) {
  if (!usage) return null;
  const read = tokens(usage.cacheReadTokens);
  const total = tokens(usage.inputTokens) + tokens(usage.cacheCreationTokens) + read;
  return total > 0 ? read / total : null;
}
