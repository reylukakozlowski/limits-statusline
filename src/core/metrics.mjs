// Plan-limit arithmetic: the recent pace (pace.mjs) extended to the reset, less the window's
// pause before it (limit-windows.mjs), the time left until the limit runs out at that pace, and
// the prompt-cache hit ratio.

import { currentPercent, recentRate } from './pace.mjs';
import { MS_PER_HOUR } from './time.mjs';

/** Usage at which a limit runs out. */
export const FULL_PERCENT = 100;

/**
 * @typedef {{ percentUsed: number, resetsAtMs: number | null }} LimitReading
 * @typedef {{ percentUsed: number, remainingMs: number | null, ratePerHour: number | null,
 *             projectedPercent: number | null, limitInMs: number | null }} LimitAnalysis
 * `remainingMs` runs to the reset; the projection counts no growth during the pause before it.
 * `limitInMs` is the time on the clock until the limit runs out, the pause counted as time in
 * which nothing is used; it is set only when that happens before the reset.
 * @typedef {{ startMs: number, endMs: number }} Pause
 * A stretch before the reset in which the usage does not grow, all of it still to come:
 * now < `startMs` < `endMs` <= the reset.
 */

/**
 * @param {LimitReading | null} reading the session's figure for this window
 * @param {import('./limit-windows.mjs').LimitWindow} window
 * @param {import('./zone-time.mjs').Clock} clock now, and the zone the window's pause follows
 * @param {import('./limit-history.mjs').LimitPoint[]} [points] shared readings of this kind
 * @returns {LimitAnalysis | null} null when there is no usable usage figure
 */
export function analyzeLimit(reading, window, clock, points = []) {
  if (!reading || !Number.isFinite(reading.percentUsed)) return null;
  const { nowMs } = clock;
  const unknown = { ratePerHour: null, projectedPercent: null, limitInMs: null };
  if (!Number.isFinite(reading.resetsAtMs)) return { percentUsed: reading.percentUsed, remainingMs: null, ...unknown };
  const percentUsed = currentPercent(points, reading, nowMs);
  const remainingMs = Math.max(0, reading.resetsAtMs - nowMs);
  const ratePerHour = recentRate(points, reading, window, nowMs);
  if (ratePerHour === null) return { percentUsed, remainingMs, ...unknown };
  const pause = window.pauseBeforeReset(reading.resetsAtMs, clock);
  const usableMs = remainingMs - pausedMs(pause);
  return {
    percentUsed,
    remainingMs,
    ratePerHour,
    projectedPercent: percentUsed + ratePerHour * (usableMs / MS_PER_HOUR),
    limitInMs: timeUntilFull(percentUsed, ratePerHour, usableMs, pause, nowMs),
  };
}

/** @param {Pause | null} pause */
const pausedMs = (pause) => (pause ? pause.endMs - pause.startMs : 0);

/**
 * Usage grows only outside the pause, so a limit that fills up after the pause starts fills up
 * that much later.
 * @param {number} percentUsed @param {number} ratePerHour @param {number} usableMs
 * @param {Pause | null} pause @param {number} nowMs
 */
function timeUntilFull(percentUsed, ratePerHour, usableMs, pause, nowMs) {
  if (percentUsed >= FULL_PERCENT || !(ratePerHour > 0)) return null;
  const usingMs = ((FULL_PERCENT - percentUsed) / ratePerHour) * MS_PER_HOUR;
  if (usingMs >= usableMs) return null;
  return pause && nowMs + usingMs > pause.startMs ? usingMs + pausedMs(pause) : usingMs;
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
