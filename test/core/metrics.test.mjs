import { test } from 'node:test';
import assert from 'node:assert/strict';
import { WINDOW_MS, MIN_ELAPSED_MS, analyzeLimit, cacheHitRatio } from '../../src/core/metrics.mjs';

const near = (actual, expected, tolerance) =>
  assert.ok(Math.abs(actual - expected) <= tolerance, `${actual} is not within ${tolerance} of ${expected}`);

test('window constants are five hours, seven days and a 15-minute warm-up', () => {
  assert.equal(WINDOW_MS.fiveHour, 18_000_000);
  assert.equal(WINDOW_MS.sevenDay, 604_800_000);
  assert.equal(MIN_ELAPSED_MS, 900_000);
});

test('analyzeLimit reproduces the mockup 5h numbers (12% after 50 min)', () => {
  const result = analyzeLimit({ percentUsed: 12, resetsAtMs: 15_000_000 }, WINDOW_MS.fiveHour, 0);
  assert.equal(result.percentUsed, 12);
  assert.equal(result.remainingMs, 15_000_000);
  near(result.ratePerHour, 14.4, 0.05);
  near(result.projectedPercent, 72, 0.05);
});

test('analyzeLimit reproduces the mockup 7d numbers (39% with 76h10m left)', () => {
  const result = analyzeLimit({ percentUsed: 39, resetsAtMs: 274_200_000 }, WINDOW_MS.sevenDay, 0);
  near(result.ratePerHour, 0.4247, 0.001);
  near(result.projectedPercent, 71.35, 0.05);
});

test('analyzeLimit early window: no rate before 15 minutes have elapsed', () => {
  const result = analyzeLimit({ percentUsed: 2, resetsAtMs: WINDOW_MS.fiveHour - 600_000 }, WINDOW_MS.fiveHour, 0);
  assert.equal(result.remainingMs, WINDOW_MS.fiveHour - 600_000);
  assert.equal(result.ratePerHour, null);
  assert.equal(result.projectedPercent, null);
});

test('analyzeLimit skewed reset: a reset further away than the window gives no rate', () => {
  const result = analyzeLimit({ percentUsed: 5, resetsAtMs: WINDOW_MS.fiveHour + 1 }, WINDOW_MS.fiveHour, 0);
  assert.equal(result.ratePerHour, null);
  assert.equal(result.projectedPercent, null);
});

test('analyzeLimit skewed reset: a reset in the past means nothing remains and the projection is the usage', () => {
  const result = analyzeLimit({ percentUsed: 64, resetsAtMs: 1_000 }, WINDOW_MS.fiveHour, 5_000);
  assert.equal(result.remainingMs, 0);
  assert.equal(result.projectedPercent, 64);
});

test('analyzeLimit without a reset time keeps the usage but no countdown or rate', () => {
  assert.deepEqual(analyzeLimit({ percentUsed: 30, resetsAtMs: null }, WINDOW_MS.sevenDay, 0), {
    percentUsed: 30, remainingMs: null, ratePerHour: null, projectedPercent: null,
  });
});

test('analyzeLimit rejects a missing or non-finite usage', () => {
  assert.equal(analyzeLimit({ percentUsed: NaN, resetsAtMs: 10 }, WINDOW_MS.fiveHour, 0), null);
  assert.equal(analyzeLimit(null, WINDOW_MS.fiveHour, 0), null);
});

test('cacheHitRatio is cache reads over all input tokens', () => {
  assert.equal(cacheHitRatio({ inputTokens: 10, cacheCreationTokens: 0, cacheReadTokens: 990 }), 0.99);
  assert.equal(cacheHitRatio({ inputTokens: 0, cacheCreationTokens: 0, cacheReadTokens: 0 }), null);
  assert.equal(cacheHitRatio({ cacheReadTokens: 50 }), 1);
  assert.equal(cacheHitRatio(null), null);
});
