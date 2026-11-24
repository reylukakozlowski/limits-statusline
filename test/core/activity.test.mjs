import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  ACTIVITY_BUCKET_MS, activeMsBetween, activityStartMs, markActive, pruneActivity, readActivity,
} from '../../src/core/activity.mjs';

const MINUTE = 60_000;
// A time on a five-minute boundary, so the buckets below are easy to read.
const T0 = 1_800_000_000_000 - (1_800_000_000_000 % (5 * MINUTE));

test('a moment of work marks its whole five-minute bucket', () => {
  assert.equal(ACTIVITY_BUCKET_MS, 300_000);
  assert.deepEqual(markActive([], T0 + 2 * MINUTE), [[T0, T0 + 5 * MINUTE]]);
  // The bucket's first and last millisecond belong to it; the next millisecond to the next one.
  assert.deepEqual(markActive([], T0), [[T0, T0 + 5 * MINUTE]]);
  assert.deepEqual(markActive([], T0 + 5 * MINUTE - 1), [[T0, T0 + 5 * MINUTE]]);
  assert.deepEqual(markActive([], T0 + 5 * MINUTE), [[T0 + 5 * MINUTE, T0 + 10 * MINUTE]]);
});

test('work in a bucket that is marked already changes nothing and returns the same spans', () => {
  const spans = markActive([], T0 + MINUTE);
  assert.equal(markActive(spans, T0 + 4 * MINUTE), spans);
});

test('work in the next bucket lengthens the span; after a gap it starts a new one', () => {
  const one = markActive([], T0 + MINUTE);
  assert.deepEqual(markActive(one, T0 + 6 * MINUTE), [[T0, T0 + 10 * MINUTE]]);
  assert.deepEqual(markActive(one, T0 + 11 * MINUTE), [[T0, T0 + 5 * MINUTE], [T0 + 10 * MINUTE, T0 + 15 * MINUTE]]);
});

test('work reported late lands at its own time and joins the spans on both sides', () => {
  const apart = [[T0, T0 + 5 * MINUTE], [T0 + 10 * MINUTE, T0 + 15 * MINUTE]];
  assert.deepEqual(markActive(apart, T0 + 7 * MINUTE), [[T0, T0 + 15 * MINUTE]]);
  assert.deepEqual(markActive(apart, T0 - 8 * MINUTE), [[T0 - 10 * MINUTE, T0 - 5 * MINUTE], ...apart]);
});

test('a span that does not lie on the buckets is joined with the bucket it overlaps, never counted twice', () => {
  const offGrid = [[T0 - 20 * MINUTE, T0 + 2 * MINUTE]];
  assert.deepEqual(markActive(offGrid, T0 + 3 * MINUTE), [[T0 - 20 * MINUTE, T0 + 5 * MINUTE]]);
});

test('a time that is no number marks nothing', () => {
  const spans = markActive([], T0);
  for (const bad of [null, undefined, NaN, Infinity, '5']) assert.equal(markActive(spans, bad), spans, String(bad));
});

test('pruning drops the spans that ended by the cutoff and keeps one that reaches past it', () => {
  const spans = [[T0, T0 + 5 * MINUTE], [T0 + 10 * MINUTE, T0 + 20 * MINUTE], [T0 + 30 * MINUTE, T0 + 35 * MINUTE]];
  assert.deepEqual(pruneActivity(spans, T0 + 5 * MINUTE), spans.slice(1));
  assert.deepEqual(pruneActivity(spans, T0 + 5 * MINUTE - 1), spans);
  assert.deepEqual(pruneActivity(spans, T0 + 15 * MINUTE), spans.slice(1)); // still running at the cutoff
  assert.equal(pruneActivity(spans, T0), spans); // nothing to drop: the same spans
});

test('the active time between two moments is the part of the spans that lies between them', () => {
  const spans = [[T0, T0 + 10 * MINUTE], [T0 + 30 * MINUTE, T0 + 35 * MINUTE]];
  assert.equal(activeMsBetween(spans, T0, T0 + 60 * MINUTE), 15 * MINUTE);
  assert.equal(activeMsBetween(spans, T0 + 4 * MINUTE, T0 + 32 * MINUTE), 6 * MINUTE + 2 * MINUTE);
  assert.equal(activeMsBetween(spans, T0 + 10 * MINUTE, T0 + 30 * MINUTE), 0);
  assert.equal(activeMsBetween(spans, T0 + 60 * MINUTE, T0), 0);
  assert.equal(activeMsBetween([], T0, T0 + 60 * MINUTE), 0);
});

test('the activity starts with its earliest span, and never without one', () => {
  assert.equal(activityStartMs([[T0 + 10 * MINUTE, T0 + 15 * MINUTE], [T0, T0 + 5 * MINUTE]]), T0);
  assert.equal(activityStartMs([]), null);
});

test('reading the stored spans drops the malformed ones and sorts the rest', () => {
  const stored = [[T0 + 10 * MINUTE, T0 + 15 * MINUTE], [T0, T0 + 5 * MINUTE], ['x', 2], [T0, T0], [T0 + 5, T0], [T0], null];
  assert.deepEqual(readActivity(stored), [[T0, T0 + 5 * MINUTE], [T0 + 10 * MINUTE, T0 + 15 * MINUTE]]);
  for (const none of [undefined, null, 'nope', {}]) assert.deepEqual(readActivity(none), [], String(none));
});
