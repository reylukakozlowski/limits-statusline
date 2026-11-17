// The two plan windows and everything that depends on their kind: their length, how far back
// their pace looks, how finely their readings are kept, and the pause before their reset. One
// table, so the history's retention can never fall behind the pace's look-back.

import { nightBeforeReset } from './night.mjs';
import { MS_PER_DAY, MS_PER_HOUR, MS_PER_MINUTE } from './time.mjs';

/**
 * The look-backs won a simulation of bursty work (`npm run simulate:pace`): 30 minutes keeps the
 * 5-hour colour right most often, and a whole day lets the 7-day pace include the nights.
 * @typedef {(resetsAtMs: number | null, clock: import('./zone-time.mjs').Clock) => import('./metrics.mjs').Pause | null} PauseRule
 * @typedef {{ windowMs: number, paceLookbackMs: number, bucketMs: number, pauseBeforeReset: PauseRule }} LimitWindow
 * `bucketMs`: readings in one bucket of this length keep only the newest, which bounds the history.
 * `pauseBeforeReset`: the stretch before the reset that the projection leaves out. A 5-hour window
 * is used up in one sitting; the week's last night before its reset is not worked through.
 */

/** @type {PauseRule} */
const NO_PAUSE = () => null;

export const LIMIT_WINDOWS = Object.freeze({
  fiveHour: Object.freeze({
    windowMs: 5 * MS_PER_HOUR, paceLookbackMs: 30 * MS_PER_MINUTE, bucketMs: MS_PER_MINUTE, pauseBeforeReset: NO_PAUSE,
  }),
  sevenDay: Object.freeze({
    windowMs: 7 * MS_PER_DAY, paceLookbackMs: MS_PER_DAY, bucketMs: 5 * MS_PER_MINUTE, pauseBeforeReset: nightBeforeReset,
  }),
});

/** @type {ReadonlyArray<'fiveHour' | 'sevenDay'>} */
export const LIMIT_KINDS = Object.freeze(Object.keys(LIMIT_WINDOWS));

/**
 * How long a plan window counts as one the account has after it was last reported. Claude Code
 * sends an account's windows with every response, so a window not reported for a week of use is
 * one the account does not have (a verified Ultra account has no 5-hour window), while a window
 * that only reset meanwhile was reported within the week.
 */
export const LIMIT_SEEN_FOR_MS = 7 * MS_PER_DAY;

/**
 * Whether the account has a window: it has a figure now, or one was reported within the week.
 * @param {import('./metrics.mjs').LimitReading | null} reading the session's figure for the window
 * @param {number | null | undefined} seenAtMs when any session last reported the window
 * @param {number} nowMs
 */
export function accountHasWindow(reading, seenAtMs, nowMs) {
  return reading !== null || (Number.isFinite(seenAtMs) && nowMs - seenAtMs <= LIMIT_SEEN_FOR_MS);
}

/**
 * The shortest stretch of readings a pace is read off: half the look-back, so 15 minutes of a
 * 5-hour window and 12 hours of a week. A rate over less is noise, and the projection multiplies
 * it by the time left in the window: 3% in a week's first 20 minutes would project past 1000%.
 * @param {LimitWindow} window
 */
export const minPaceSpanMs = (window) => window.paceLookbackMs / 2;

/**
 * How long readings are kept: twice the look-back, so a reading before the look-back's start is
 * still there to read the start off.
 * @param {LimitWindow} window
 */
export const retentionMs = (window) => 2 * window.paceLookbackMs;
