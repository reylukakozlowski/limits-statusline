import { test } from 'node:test';
import assert from 'node:assert/strict';
import { FULL_PERCENT, analyzeLimit, cacheHitRatio } from '../../src/core/metrics.mjs';
import { LIMIT_KINDS, LIMIT_WINDOWS, retentionMs } from '../../src/core/limit-windows.mjs';
import { nightBeforeReset } from '../../src/core/night.mjs';
import { MIN_ELAPSED_MS } from '../../src/core/pace.mjs';

const HOUR = 3_600_000;
const near = (actual, expected, tolerance) =>
  assert.ok(Math.abs(actual - expected) <= tolerance, `${actual} is not within ${tolerance} of ${expected}`);
const { fiveHour: FIVE_HOUR, sevenDay: SEVEN_DAY } = LIMIT_WINDOWS;
// Without a time zone there is no night to leave out, so the numbers run to the reset.
const clockAt = (nowMs, timeZone = null) => ({ nowMs, timeZone });
// Warsaw (CET): Sunday 2026-11-01 19:00, and the Tuesday after at 07:00.
const SUNDAY_19 = Date.parse('2026-11-01T18:00:00Z');
const TUESDAY_07 = Date.parse('2026-11-03T06:00:00Z');
const warsawAt = (nowMs) => clockAt(nowMs, 'Europe/Warsaw');

test('the windows are five hours and seven days, with 30-minute and one-day look-backs', () => {
  assert.deepEqual(LIMIT_KINDS, ['fiveHour', 'sevenDay']);
  assert.equal(FIVE_HOUR.windowMs, 18_000_000);
  assert.equal(FIVE_HOUR.paceLookbackMs, 1_800_000);
  assert.equal(FIVE_HOUR.bucketMs, 60_000);
  assert.equal(SEVEN_DAY.windowMs, 604_800_000);
  assert.equal(SEVEN_DAY.paceLookbackMs, 86_400_000);
  assert.equal(SEVEN_DAY.bucketMs, 300_000);
  assert.equal(retentionMs(FIVE_HOUR), 3_600_000);
  assert.equal(retentionMs(SEVEN_DAY), 172_800_000);
  assert.equal(MIN_ELAPSED_MS, 900_000);
  assert.equal(FULL_PERCENT, 100);
});

test('only the 7-day window pauses before its reset, for the night', () => {
  assert.equal(SEVEN_DAY.pauseBeforeReset, nightBeforeReset);
  assert.equal(FIVE_HOUR.pauseBeforeReset(TUESDAY_07, warsawAt(SUNDAY_19)), null);
});

test('analyzeLimit reproduces the mockup 5h numbers (12% after 50 min)', () => {
  const result = analyzeLimit({ percentUsed: 12, resetsAtMs: 15_000_000 }, FIVE_HOUR, clockAt(0));
  assert.equal(result.percentUsed, 12);
  assert.equal(result.remainingMs, 15_000_000);
  near(result.ratePerHour, 14.4, 0.05);
  near(result.projectedPercent, 72, 0.05);
  assert.equal(result.limitInMs, null);
});

test('analyzeLimit reproduces the mockup 7d numbers (39% with 76h10m left)', () => {
  const result = analyzeLimit({ percentUsed: 39, resetsAtMs: 274_200_000 }, SEVEN_DAY, clockAt(0));
  near(result.ratePerHour, 0.4247, 0.001);
  near(result.projectedPercent, 71.35, 0.05);
});

test('analyzeLimit says when the limit runs out if that comes before the reset (70% three hours in)', () => {
  const result = analyzeLimit({ percentUsed: 70, resetsAtMs: 2 * HOUR }, FIVE_HOUR, clockAt(0));
  near(result.ratePerHour, 70 / 3, 1e-9);
  near(result.projectedPercent, 70 + (70 / 3) * 2, 1e-9);
  near(result.limitInMs, (30 / (70 / 3)) * HOUR, 1); // 1h17m
});

test('analyzeLimit uses the shared readings: the freshest figure and the pace of the last 30 minutes', () => {
  const reset = 3 * HOUR;
  const points = [[-HOUR, 20, reset], [-0.5 * HOUR, 30, reset], [-0.1 * HOUR, 45, reset]];
  const result = analyzeLimit({ percentUsed: 40, resetsAtMs: reset }, FIVE_HOUR, clockAt(0), points);
  assert.equal(result.percentUsed, 45); // another session saw 45% after this one's 40%
  near(result.ratePerHour, 30, 1e-9); // 15 points in the last half hour
  near(result.projectedPercent, 45 + 30 * 3, 1e-9);
  near(result.limitInMs, (55 / 30) * HOUR, 1);
});

test('analyzeLimit gives no time to the limit when it is already used up or nothing is being used', () => {
  assert.equal(analyzeLimit({ percentUsed: 100, resetsAtMs: 2 * HOUR }, FIVE_HOUR, clockAt(0)).limitInMs, null);
  const idle = [[-2 * HOUR, 10, 2 * HOUR], [-HOUR, 30, 2 * HOUR]];
  const result = analyzeLimit({ percentUsed: 30, resetsAtMs: 2 * HOUR }, FIVE_HOUR, clockAt(0), idle);
  assert.equal(result.ratePerHour, 0);
  assert.equal(result.projectedPercent, 30);
  assert.equal(result.limitInMs, null);
});

test('analyzeLimit early window: no rate before 15 minutes have elapsed', () => {
  const result = analyzeLimit({ percentUsed: 2, resetsAtMs: FIVE_HOUR.windowMs - 600_000 }, FIVE_HOUR, clockAt(0));
  assert.equal(result.remainingMs, FIVE_HOUR.windowMs - 600_000);
  assert.equal(result.ratePerHour, null);
  assert.equal(result.projectedPercent, null);
  assert.equal(result.limitInMs, null);
});

test('analyzeLimit skewed reset: a reset further away than the window gives no rate', () => {
  const result = analyzeLimit({ percentUsed: 5, resetsAtMs: FIVE_HOUR.windowMs + 1 }, FIVE_HOUR, clockAt(0));
  assert.equal(result.ratePerHour, null);
  assert.equal(result.projectedPercent, null);
});

test('analyzeLimit skewed reset: a reset in the past means nothing remains and the projection is the usage', () => {
  const result = analyzeLimit({ percentUsed: 64, resetsAtMs: 1_000 }, FIVE_HOUR, clockAt(5_000));
  assert.equal(result.remainingMs, 0);
  assert.equal(result.projectedPercent, 64);
  assert.equal(result.limitInMs, null);
});

test('analyzeLimit without a reset time keeps the usage but no countdown or rate', () => {
  assert.deepEqual(analyzeLimit({ percentUsed: 30, resetsAtMs: null }, SEVEN_DAY, clockAt(0)), {
    percentUsed: 30, remainingMs: null, ratePerHour: null, projectedPercent: null, limitInMs: null,
  });
});

test('analyzeLimit rejects a missing or non-finite usage', () => {
  assert.equal(analyzeLimit({ percentUsed: NaN, resetsAtMs: 10 }, FIVE_HOUR, clockAt(0)), null);
  assert.equal(analyzeLimit(null, FIVE_HOUR, clockAt(0)), null);
});

// A pace of `perHour` over the last day, ending at `percent` now.
const paceOf = (percent, perHour, nowMs, resetsAtMs) => [[nowMs - 24 * HOUR, percent - 24 * perHour, resetsAtMs], [nowMs, percent, resetsAtMs]];
const weekly = (percent, perHour, nowMs, resetsAtMs, clock) =>
  analyzeLimit({ percentUsed: percent, resetsAtMs }, SEVEN_DAY, clock, paceOf(percent, perHour, nowMs, resetsAtMs));

test('the 7-day projection leaves out the night before a 07:00 reset: it ends at 02:00', () => {
  const result = weekly(66, 1, SUNDAY_19, TUESDAY_07, warsawAt(SUNDAY_19));
  assert.equal(result.remainingMs, 36 * HOUR); // the countdown still runs to the reset
  near(result.ratePerHour, 1, 1e-9);
  near(result.projectedPercent, 66 + 31, 1e-9); // 31 working hours, not 36
  assert.equal(result.limitInMs, null); // 100% after 34 working hours comes after 02:00
});

test('without a time zone the 7-day projection runs to the reset, as before', () => {
  const result = weekly(66, 1, SUNDAY_19, TUESDAY_07, clockAt(SUNDAY_19));
  near(result.projectedPercent, 66 + 36, 1e-9);
  near(result.limitInMs, 34 * HOUR, 1);
});

test('working into that night counts the time to the reset again', () => {
  const threeAm = TUESDAY_07 - 4 * HOUR;
  const result = weekly(90, 1, threeAm, TUESDAY_07, warsawAt(threeAm));
  near(result.projectedPercent, 94, 1e-9);
});

test('the time to 100% skips the night when the limit runs out after it', () => {
  // 23:00, reset at 12:00: 90% at 2%/h reaches 100% after five working hours, at 09:00.
  const elevenPm = TUESDAY_07 - 8 * HOUR;
  const noon = TUESDAY_07 + 5 * HOUR;
  const result = weekly(90, 2, elevenPm, noon, warsawAt(elevenPm));
  near(result.projectedPercent, 90 + 2 * 8, 1e-9); // 13 hours to the reset, 5 of them night
  near(result.limitInMs, 10 * HOUR, 1);
});

test('the time to 100% before the night is the working time itself', () => {
  // 20:00, reset at 07:00: 90% at 2%/h reaches 100% at 01:00, before the night.
  const eightPm = TUESDAY_07 - 11 * HOUR;
  const result = weekly(90, 2, eightPm, TUESDAY_07, warsawAt(eightPm));
  near(result.projectedPercent, 90 + 2 * 6, 1e-9);
  near(result.limitInMs, 5 * HOUR, 1);
});

test('the 5-hour limit never leaves out the night', () => {
  // 23:00, the 5-hour window resets at 04:00: the two night hours before it still count.
  const elevenPm = TUESDAY_07 - 8 * HOUR;
  const fourAm = elevenPm + 5 * HOUR;
  const points = [[elevenPm - 0.5 * HOUR, 20, fourAm], [elevenPm, 30, fourAm]];
  const result = analyzeLimit({ percentUsed: 30, resetsAtMs: fourAm }, FIVE_HOUR, warsawAt(elevenPm), points);
  near(result.ratePerHour, 20, 1e-9);
  near(result.projectedPercent, 30 + 20 * 5, 1e-9);
});

test('cacheHitRatio is cache reads over all input tokens', () => {
  assert.equal(cacheHitRatio({ inputTokens: 10, cacheCreationTokens: 0, cacheReadTokens: 990 }), 0.99);
  assert.equal(cacheHitRatio({ inputTokens: 0, cacheCreationTokens: 0, cacheReadTokens: 0 }), null);
  assert.equal(cacheHitRatio({ cacheReadTokens: 50 }), 1);
  assert.equal(cacheHitRatio(null), null);
});
