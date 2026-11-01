// The night before a plan limit's reset: hours on the user's clock in which no one works, so the
// usage stops growing. The 7-day window leaves the last such night out of its projection
// (limit-windows.mjs): with a reset at 07:00 the week is, in practice, over at 02:00.

import { MS_PER_DAY, MS_PER_HOUR } from './time.mjs';
import { lastTimeOfDayBefore } from './zone-time.mjs';

/** 02:00–07:00 on the user's clock, as times of day. */
export const NIGHT = Object.freeze({ startTimeOfDayMs: 2 * MS_PER_HOUR, endTimeOfDayMs: 7 * MS_PER_HOUR });

/**
 * The part of the last night before the reset that is still to come, or null: when that night has
 * begun already (whoever works through it is awake, so the whole time to the reset counts), and
 * when the reset, the time or the zone is unknown. On the night the clocks go forward it runs from
 * the jump to 07:00, four hours; on the night they go back, from the second 02:00.
 * @param {number | null} resetsAtMs
 * @param {import('./zone-time.mjs').Clock} clock
 * @returns {import('./metrics.mjs').Pause | null}
 */
export function nightBeforeReset(resetsAtMs, { nowMs, timeZone }) {
  if (!Number.isFinite(nowMs)) return null;
  const startMs = lastTimeOfDayBefore(resetsAtMs, NIGHT.startTimeOfDayMs, timeZone);
  if (startMs === null || startMs <= nowMs) return null;
  // The first 07:00 after the start: the last one before the same time a day later.
  const endMs = lastTimeOfDayBefore(startMs + MS_PER_DAY, NIGHT.endTimeOfDayMs, timeZone);
  return { startMs, endMs: Math.min(endMs, resetsAtMs) };
}
