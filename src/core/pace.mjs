// The recent pace of a plan limit: how fast its usage grew over the window's look-back, read
// from the shared readings (limit-history.mjs). Readings of earlier windows count too, so the
// 7-day pace can look back a whole day across the weekly reset. The pace of work is the same
// growth over the time the sessions worked (activity.mjs).

import { activeMsBetween, activityStartMs } from './activity.mjs';
import { isSameWindow } from './limit-history.mjs';
import { minPaceSpanMs } from './limit-windows.mjs';
import { MS_PER_HOUR } from './time.mjs';

/**
 * A fall of at least this many points within one window is a limit reset given on claude.ai
 * ("Reset for free"); a smaller one is an older figure that arrived late.
 */
export const RESET_DROP_PERCENT = 5;

/**
 * @typedef {import('./limit-history.mjs').LimitPoint} LimitPoint
 * @typedef {import('./metrics.mjs').LimitReading} LimitReading
 * @typedef {import('./limit-windows.mjs').LimitWindow} LimitWindow
 */

/**
 * Usage per hour over the look-back that ends now, or null when the readings cover too little.
 * @param {LimitPoint[]} points the shared readings of this kind of window
 * @param {LimitReading | null} reading the session's own figure
 * @param {LimitWindow} window
 * @param {number} nowMs
 * @returns {number | null}
 */
export function recentRate(points, reading, window, nowMs) {
  if (!reading || !Number.isFinite(reading.percentUsed) || !Number.isFinite(reading.resetsAtMs)) return null;
  const series = cumulativeUsage(seriesPoints(pointsUpTo(points, nowMs), reading, window, nowMs));
  const fromMs = Math.max(nowMs - window.paceLookbackMs, series[0][0]);
  if (nowMs - fromMs < minPaceSpanMs(window)) return null;
  return (series.at(-1)[1] - valueAt(series, fromMs)) / ((nowMs - fromMs) / MS_PER_HOUR);
}

/**
 * Usage per hour of work over the same look-back: the rise divided by the time the sessions
 * worked in it, not by the clock. Null for a window that has no pace of work, and when the
 * record holds too little work. The look-back starts no earlier than the record of work does,
 * so usage from before it is never divided by work that was not recorded.
 * @param {LimitPoint[]} points the shared readings of this kind of window
 * @param {import('./activity.mjs').ActivitySpan[]} activity when the sessions worked
 * @param {LimitReading | null} reading the session's own figure
 * @param {LimitWindow} window
 * @param {number} nowMs
 * @returns {number | null}
 */
export function workRate(points, activity, reading, window, nowMs) {
  if (window.minWorkSpanMs === null) return null;
  if (!reading || !Number.isFinite(reading.percentUsed) || !Number.isFinite(reading.resetsAtMs)) return null;
  const recordedFromMs = activityStartMs(activity);
  if (recordedFromMs === null) return null;
  const series = cumulativeUsage(seriesPoints(pointsUpTo(points, nowMs), reading, window, nowMs));
  const fromMs = Math.max(nowMs - window.paceLookbackMs, series[0][0], recordedFromMs);
  const workedMs = activeMsBetween(activity, fromMs, nowMs);
  if (workedMs < window.minWorkSpanMs) return null;
  return (series.at(-1)[1] - valueAt(series, fromMs)) / (workedMs / MS_PER_HOUR);
}

/**
 * The freshest figure known for the session's window: the newest shared reading of that window,
 * which may come from another session, else the session's own.
 * @param {LimitPoint[]} points
 * @param {LimitReading} reading
 * @param {number} nowMs readings stamped later are left out, as in recentRate
 * @returns {number}
 */
export function currentPercent(points, reading, nowMs) {
  const newest = sameWindowPoints(pointsUpTo(points, nowMs), reading)
    .reduce((best, point) => (!best || point[0] > best[0] ? point : best), null);
  return newest ? newest[1] : reading.percentUsed;
}

const pointsUpTo = (points, nowMs) => points.filter(([atMs]) => atMs <= nowMs);
const sameWindowPoints = (points, reading) => points.filter(([, , resetsAtMs]) => isSameWindow(resetsAtMs, reading.resetsAtMs));

// The readings plus the window's opening at 0%, unless a reading of the window is as old (reset
// times rounded apart). Without a shared reading of this window the session's own figure stands
// for now, which makes the pace the average since the window opened, as before there were
// shared readings.
function seriesPoints(points, reading, window, nowMs) {
  const opening = [reading.resetsAtMs - window.windowMs, 0, reading.resetsAtMs];
  const shared = sameWindowPoints(points, reading);
  const hasOpening = opening[0] <= nowMs && shared.every(([atMs]) => atMs > opening[0]);
  const own = shared.length === 0 ? [[nowMs, reading.percentUsed, reading.resetsAtMs]] : [];
  return [...points, ...(hasOpening ? [opening] : []), ...own].sort((a, b) => a[0] - b[0]);
}

// Readings → [atMs, total used since the first reading], summing each window's rises. A new
// window adds its own figure (used since it opened); an earlier window's figure and a small fall
// (a late figure) are skipped; a large fall is a manual reset.
function cumulativeUsage(points) {
  const [first, ...rest] = points;
  const series = [[first[0], 0]];
  let total = 0;
  let level = first[1];
  let windowResetMs = first[2];
  for (const [atMs, percent, resetsAtMs] of rest) {
    if (isSameWindow(resetsAtMs, windowResetMs)) {
      // An unchanged figure still counts: it pins the time up to which nothing was used.
      if (percent >= level) total += percent - level;
      else if (level - percent >= RESET_DROP_PERCENT) total += percent;
      else continue;
    } else if (resetsAtMs > windowResetMs) {
      total += percent;
      windowResetMs = resetsAtMs;
    } else {
      continue;
    }
    level = percent;
    series.push([atMs, total]);
  }
  return series;
}

// The total at `atMs` on the straight line between the readings around it.
function valueAt(series, atMs) {
  const after = series.findIndex(([pointMs]) => pointMs >= atMs);
  if (after === -1) return series.at(-1)[1];
  if (after === 0) return series[0][1];
  const [t0, v0] = series[after - 1];
  const [t1, v1] = series[after];
  return t1 === t0 ? v1 : v0 + ((v1 - v0) * (atMs - t0)) / (t1 - t0);
}
