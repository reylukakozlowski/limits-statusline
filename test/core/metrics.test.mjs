import { test } from 'node:test';
import assert from 'node:assert/strict';
import { FULL_PERCENT, analyzeLimit, cacheHitRatio } from '../../src/core/metrics.mjs';
import { LIMIT_KINDS, LIMIT_WINDOWS, retentionMs } from '../../src/core/limit-windows.mjs';
import { MIN_ELAPSED_MS } from '../../src/core/pace.mjs';

const HOUR = 3_600_000;
const near = (actual, expected, tolerance) =>
  assert.ok(Math.abs(actual - expected) <= tolerance, `${actual} is not within ${tolerance} of ${expected}`);
const { fiveHour: FIVE_HOUR, sevenDay: SEVEN_DAY } = LIMIT_WINDOWS;

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

test('analyzeLimit reproduces the mockup 5h numbers (12% after 50 min)', () => {
  const result = analyzeLimit({ percentUsed: 12, resetsAtMs: 15_000_000 }, FIVE_HOUR, 0);
  assert.equal(result.percentUsed, 12);
  assert.equal(result.remainingMs, 15_000_000);
  near(result.ratePerHour, 14.4, 0.05);
  near(result.projectedPercent, 72, 0.05);
  assert.equal(result.limitInMs, null);
});

test('analyzeLimit reproduces the mockup 7d numbers (39% with 76h10m left)', () => {
  const result = analyzeLimit({ percentUsed: 39, resetsAtMs: 274_200_000 }, SEVEN_DAY, 0);
  near(result.ratePerHour, 0.4247, 0.001);
  near(result.projectedPercent, 71.35, 0.05);
});

test('analyzeLimit says when the limit runs out if that comes before the reset (70% three hours in)', () => {
  const result = analyzeLimit({ percentUsed: 70, resetsAtMs: 2 * HOUR }, FIVE_HOUR, 0);
  near(result.ratePerHour, 70 / 3, 1e-9);
  near(result.projectedPercent, 70 + (70 / 3) * 2, 1e-9);
  near(result.limitInMs, (30 / (70 / 3)) * HOUR, 1); // 1h17m
});

test('analyzeLimit uses the shared readings: the freshest figure and the pace of the last 30 minutes', () => {
  const reset = 3 * HOUR;
  const points = [[-HOUR, 20, reset], [-0.5 * HOUR, 30, reset], [-0.1 * HOUR, 45, reset]];
  const result = analyzeLimit({ percentUsed: 40, resetsAtMs: reset }, FIVE_HOUR, 0, points);
  assert.equal(result.percentUsed, 45); // another session saw 45% after this one's 40%
  near(result.ratePerHour, 30, 1e-9); // 15 points in the last half hour
  near(result.projectedPercent, 45 + 30 * 3, 1e-9);
  near(result.limitInMs, (55 / 30) * HOUR, 1);
});

test('analyzeLimit gives no time to the limit when it is already used up or nothing is being used', () => {
  assert.equal(analyzeLimit({ percentUsed: 100, resetsAtMs: 2 * HOUR }, FIVE_HOUR, 0).limitInMs, null);
  const idle = [[-2 * HOUR, 10, 2 * HOUR], [-HOUR, 30, 2 * HOUR]];
  const result = analyzeLimit({ percentUsed: 30, resetsAtMs: 2 * HOUR }, FIVE_HOUR, 0, idle);
  assert.equal(result.ratePerHour, 0);
  assert.equal(result.projectedPercent, 30);
  assert.equal(result.limitInMs, null);
});

test('analyzeLimit early window: no rate before 15 minutes have elapsed', () => {
  const result = analyzeLimit({ percentUsed: 2, resetsAtMs: FIVE_HOUR.windowMs - 600_000 }, FIVE_HOUR, 0);
  assert.equal(result.remainingMs, FIVE_HOUR.windowMs - 600_000);
  assert.equal(result.ratePerHour, null);
  assert.equal(result.projectedPercent, null);
  assert.equal(result.limitInMs, null);
});

test('analyzeLimit skewed reset: a reset further away than the window gives no rate', () => {
  const result = analyzeLimit({ percentUsed: 5, resetsAtMs: FIVE_HOUR.windowMs + 1 }, FIVE_HOUR, 0);
  assert.equal(result.ratePerHour, null);
  assert.equal(result.projectedPercent, null);
});

test('analyzeLimit skewed reset: a reset in the past means nothing remains and the projection is the usage', () => {
  const result = analyzeLimit({ percentUsed: 64, resetsAtMs: 1_000 }, FIVE_HOUR, 5_000);
  assert.equal(result.remainingMs, 0);
  assert.equal(result.projectedPercent, 64);
  assert.equal(result.limitInMs, null);
});

test('analyzeLimit without a reset time keeps the usage but no countdown or rate', () => {
  assert.deepEqual(analyzeLimit({ percentUsed: 30, resetsAtMs: null }, SEVEN_DAY, 0), {
    percentUsed: 30, remainingMs: null, ratePerHour: null, projectedPercent: null, limitInMs: null,
  });
});

test('analyzeLimit rejects a missing or non-finite usage', () => {
  assert.equal(analyzeLimit({ percentUsed: NaN, resetsAtMs: 10 }, FIVE_HOUR, 0), null);
  assert.equal(analyzeLimit(null, FIVE_HOUR, 0), null);
});

test('cacheHitRatio is cache reads over all input tokens', () => {
  assert.equal(cacheHitRatio({ inputTokens: 10, cacheCreationTokens: 0, cacheReadTokens: 990 }), 0.99);
  assert.equal(cacheHitRatio({ inputTokens: 0, cacheCreationTokens: 0, cacheReadTokens: 0 }), null);
  assert.equal(cacheHitRatio({ cacheReadTokens: 50 }), 1);
  assert.equal(cacheHitRatio(null), null);
});
