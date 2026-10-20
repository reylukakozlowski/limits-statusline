// The two plan windows and everything that depends on their kind: their length, how far back
// their pace looks, and how finely their readings are kept. One table, so the history's
// retention can never fall behind the pace's look-back.

import { MS_PER_DAY, MS_PER_HOUR, MS_PER_MINUTE } from './time.mjs';

/**
 * The look-backs won a simulation of bursty work (`npm run simulate:pace`): 30 minutes keeps the
 * 5-hour colour right most often, and a whole day lets the 7-day pace include the nights.
 * @typedef {{ windowMs: number, paceLookbackMs: number, bucketMs: number }} LimitWindow
 * `bucketMs`: readings in one bucket of this length keep only the newest, which bounds the history.
 */
export const LIMIT_WINDOWS = Object.freeze({
  fiveHour: Object.freeze({ windowMs: 5 * MS_PER_HOUR, paceLookbackMs: 30 * MS_PER_MINUTE, bucketMs: MS_PER_MINUTE }),
  sevenDay: Object.freeze({ windowMs: 7 * MS_PER_DAY, paceLookbackMs: MS_PER_DAY, bucketMs: 5 * MS_PER_MINUTE }),
});

/** @type {ReadonlyArray<'fiveHour' | 'sevenDay'>} */
export const LIMIT_KINDS = Object.freeze(Object.keys(LIMIT_WINDOWS));

/**
 * How long readings are kept: twice the look-back, so a reading before the look-back's start is
 * still there to read the start off.
 * @param {LimitWindow} window
 */
export const retentionMs = (window) => 2 * window.paceLookbackMs;
