// Plan-limit arithmetic: the recent pace (pace.mjs) extended to the reset, less the window's
// pause before it (limit-windows.mjs), the time left until the limit runs out at that pace, on
// the clock and in hours of work, and the prompt-cache hit ratio.

import { currentPercent, recentRate, workRate } from './pace.mjs';
import { MS_PER_HOUR } from './time.mjs';

/** Usage at which a limit runs out. */
export const FULL_PERCENT = 100;

/**
 * @typedef {{ percentUsed: number, resetsAtMs: number | null }} LimitReading
 * @typedef {{ percentUsed: number, resetsAtMs: number | null, usedUsd: number | null, limitUsd: number | null }} SpendLimit
 *   a Claude apps gateway's spend limit: the share used (past 100 once exceeded), its reset, and
 *   the amounts in US dollars when they were sent
 * @typedef {{ percentUsed: number, remainingMs: number | null, ratePerHour: number | null,
 *             projectedPercent: number | null, limitInMs: number | null,
 *             limitInWorkMs: number | null }} LimitAnalysis
 * `remainingMs` runs to the reset; the projection counts no growth during the pause before it.
 * `limitInMs` is the time on the clock until the limit runs out, the pause counted as time in
 * which nothing is used; it is set only when that happens before the reset.
 * `limitInWorkMs` is the time of work until then, at the pace of work (pace.mjs); it is set only
 * with `limitInMs`, for a window that has a pace of work and enough work on record.
 * @typedef {{ startMs: number, endMs: number }} Pause
 * A stretch before the reset in which the usage does not grow, all of it still to come:
 * now < `startMs` < `endMs` <= the reset.
 */

/**
 * @param {LimitReading | null} reading the session's figure for this window
 * @param {import('./limit-windows.mjs').LimitWindow} window
 * @param {import('./zone-time.mjs').Clock} clock now, and the zone the window's pause follows
 * @param {import('./limit-history.mjs').LimitPoint[]} [points] shared readings of this kind
 * @param {import('./activity.mjs').ActivitySpan[]} [activity] when the sessions worked
 * @returns {LimitAnalysis | null} null when there is no usable usage figure
 */
export function analyzeLimit(reading, window, clock, points = [], activity = []) {
  if (!reading || !Number.isFinite(reading.percentUsed)) return null;
  const { nowMs } = clock;
  const unknown = { ratePerHour: null, projectedPercent: null, limitInMs: null, limitInWorkMs: null };
  if (!Number.isFinite(reading.resetsAtMs)) return { percentUsed: reading.percentUsed, remainingMs: null, ...unknown };
  const percentUsed = currentPercent(points, reading, nowMs);
  const remainingMs = Math.max(0, reading.resetsAtMs - nowMs);
  const ratePerHour = recentRate(points, reading, window, nowMs);
  if (ratePerHour === null) return { percentUsed, remainingMs, ...unknown };
  const pause = window.pauseBeforeReset(reading.resetsAtMs, clock);
  const usableMs = remainingMs - pausedMs(pause);
  const limitInMs = timeUntilFull(percentUsed, ratePerHour, usableMs, pause, nowMs);
  return {
    percentUsed,
    remainingMs,
    ratePerHour,
    projectedPercent: percentUsed + ratePerHour * (usableMs / MS_PER_HOUR),
    limitInMs,
    limitInWorkMs: limitInMs === null
      ? null
      : workUntilFull(percentUsed, workRate(points, activity, reading, window, nowMs), limitInMs),
  };
}

/**
 * The work left at the pace of work. Work is never slower than the clock, which also counts the
 * breaks, so a figure past the time on the clock comes from a record that does not fit the
 * readings, and is left out.
 * @param {number} percentUsed @param {number | null} workRatePerHour @param {number} limitInMs
 */
function workUntilFull(percentUsed, workRatePerHour, limitInMs) {
  if (workRatePerHour === null || !(workRatePerHour > 0)) return null;
  const workMs = ((FULL_PERCENT - percentUsed) / workRatePerHour) * MS_PER_HOUR;
  return workMs <= limitInMs ? workMs : null;
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
