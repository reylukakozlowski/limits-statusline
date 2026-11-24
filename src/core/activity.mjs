// When the user worked: the stretches of time in which a session received a response, kept with
// the shared limit readings (limit-history.mjs). The pace of work (pace.mjs) divides the usage by
// this time instead of by the clock, so nights and breaks do not dilute it.
//
// A moment of work marks its whole five-minute bucket, and buckets next to each other join into
// one span. Fixed buckets bound the record (a day holds 288) and let a session whose bucket is
// marked already skip the write.

import { MS_PER_MINUTE } from './time.mjs';

export const ACTIVITY_BUCKET_MS = 5 * MS_PER_MINUTE;

/** @typedef {[fromMs: number, toMs: number]} ActivitySpan a stretch of work, `fromMs` < `toMs` */

const isSpan = (span) => Array.isArray(span) && span.length === 2
  && Number.isFinite(span[0]) && Number.isFinite(span[1]) && span[0] < span[1];
const byStart = (a, b) => a[0] - b[0];

/**
 * @param {ActivitySpan[]} spans sorted by start, none touching another
 * @param {unknown} atMs when a session worked
 * @returns {ActivitySpan[]} `spans` itself when that bucket is marked already, or `atMs` is no time
 */
export function markActive(spans, atMs) {
  if (typeof atMs !== 'number' || !Number.isFinite(atMs)) return spans;
  const fromMs = Math.floor(atMs / ACTIVITY_BUCKET_MS) * ACTIVITY_BUCKET_MS;
  const toMs = fromMs + ACTIVITY_BUCKET_MS;
  if (spans.some(([spanFrom, spanTo]) => spanFrom <= fromMs && toMs <= spanTo)) return spans;
  // Spans the bucket touches or overlaps (one read from a file need not lie on the buckets).
  const isNext = ([spanFrom, spanTo]) => spanFrom <= toMs && fromMs <= spanTo;
  const next = spans.filter(isNext);
  const joined = [Math.min(fromMs, ...next.map(([spanFrom]) => spanFrom)), Math.max(toMs, ...next.map(([, spanTo]) => spanTo))];
  return [...spans.filter((span) => !isNext(span)), joined].sort(byStart);
}

/**
 * @param {ActivitySpan[]} spans @param {number} cutoffMs
 * @returns {ActivitySpan[]} without the spans that ended by `cutoffMs`; `spans` itself when none did
 */
export function pruneActivity(spans, cutoffMs) {
  const kept = spans.filter(([, toMs]) => toMs > cutoffMs);
  return kept.length === spans.length ? spans : kept;
}

/** @param {ActivitySpan[]} spans @param {number} fromMs @param {number} toMs */
export function activeMsBetween(spans, fromMs, toMs) {
  return spans.reduce((total, [spanFrom, spanTo]) => total + Math.max(0, Math.min(spanTo, toMs) - Math.max(spanFrom, fromMs)), 0);
}

/** @param {ActivitySpan[]} spans @returns {number | null} since when work is on record, null when none is */
export function activityStartMs(spans) {
  return spans.length === 0 ? null : Math.min(...spans.map(([fromMs]) => fromMs));
}

/** @param {unknown} stored @returns {ActivitySpan[]} the well-formed spans, sorted by start */
export function readActivity(stored) {
  return Array.isArray(stored) ? stored.filter(isSpan).sort(byStart) : [];
}
