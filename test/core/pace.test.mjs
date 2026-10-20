import { test } from 'node:test';
import assert from 'node:assert/strict';
import { RESET_DROP_PERCENT, currentPercent, recentRate } from '../../src/core/pace.mjs';

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const NOW = 1_800_000_000_000;
const near = (actual, expected, tolerance = 1e-9) =>
  assert.ok(Math.abs(actual - expected) <= tolerance, `${actual} is not within ${tolerance} of ${expected}`);

// A 5-hour window that opened two hours ago, with a 30-minute look-back.
const FIVE = Object.freeze({ windowMs: 5 * HOUR, paceLookbackMs: 30 * MINUTE });
const FIVE_RESET = NOW + 3 * HOUR;
const five = (percentUsed) => ({ percentUsed, resetsAtMs: FIVE_RESET });
const at = (minutesAgo, percent, resetsAtMs = FIVE_RESET) => [NOW - minutesAgo * MINUTE, percent, resetsAtMs];

test('without readings the pace is the average since the window opened', () => {
  // 12% after 50 minutes: the mockup's 14.4%/h, whatever the look-back.
  const reading = { percentUsed: 12, resetsAtMs: NOW + 250 * MINUTE };
  near(recentRate([], reading, FIVE, NOW), 14.4);
});

test('with readings the pace covers only the look-back', () => {
  const points = [at(60, 10), at(30, 20), at(0, 30)];
  near(recentRate(points, five(30), FIVE, NOW), 20); // 10 points in half an hour, not 15%/h since the start
});

test('a reference between two readings is read off the straight line joining them', () => {
  const points = [at(40, 10), at(20, 20), at(0, 26)];
  near(recentRate(points, five(26), FIVE, NOW), (26 - 15) / 0.5);
});

test('after a pause the pace falls, because the look-back still ends now', () => {
  const points = [at(90, 10), at(40, 30)];
  near(recentRate(points, five(30), FIVE, NOW), 0);
});

test('the 7-day pace looks back a whole day, across the weekly reset', () => {
  const week = { windowMs: 7 * 24 * HOUR, paceLookbackMs: 24 * HOUR };
  const previousReset = NOW - 2 * HOUR;
  const reset = previousReset + week.windowMs;
  const points = [
    [NOW - 20 * HOUR, 80, previousReset], [NOW - 10 * HOUR, 90, previousReset],
    [NOW - HOUR, 1, reset], [NOW, 3, reset],
  ];
  // 10 points before the reset and 3 after, over the 20 hours the readings cover.
  near(recentRate(points, { percentUsed: 3, resetsAtMs: reset }, week, NOW), 13 / 20);
});

test('a large drop within one window is a manual reset: usage counts again from the low figure', () => {
  const points = [at(50, 40), at(20, 1), at(0, 5)];
  // Cumulative 40 → 41 → 45; 30 minutes ago the line from 40 to 41 stands at 40 2/3.
  near(recentRate(points, five(5), FIVE, NOW), (45 - (40 + 2 / 3)) / 0.5);
});

test('a fall of exactly RESET_DROP_PERCENT is a reset, a smaller one a late figure', () => {
  const fallTo = (low) => recentRate([at(40, 40), at(20, low), at(0, low + 1)], five(low + 1), FIVE, NOW);
  // A reset adds the low figure and the rise after it; a late figure only the rise above 40.
  near(fallTo(40 - RESET_DROP_PERCENT), ((40 - RESET_DROP_PERCENT) + 1 - (40 - RESET_DROP_PERCENT) / 2) / 0.5);
  near(fallTo(40 - RESET_DROP_PERCENT + 0.1), 0);
  assert.equal(RESET_DROP_PERCENT, 5);
});

test('after a pause the pace reads its start off the last reading before the look-back', () => {
  // 80% an hour after the window opened, then nothing until 81% ten minutes ago.
  const points = [at(60, 80), at(10, 81)];
  near(recentRate(points, five(81), FIVE, NOW), (81 - (80 + 30 / 50)) / 0.5); // 0.8%/h, not 19%/h
});

test('a reading as old as the window\'s opening (reset times rounded apart) keeps the 0% opening out', () => {
  const points = [at(121, 3, FIVE_RESET + 2 * MINUTE), at(0, 30)];
  // Without that, the opening's 0% after the 3% would read as a fall and the series would skew.
  near(recentRate(points, five(30), FIVE, NOW), (30 - (3 + 27 * (91 / 121))) / 0.5);
});

test('a 5-hour window that just opened has a pace at once when work went on across the reset', () => {
  const opened = { percentUsed: 1, resetsAtMs: NOW + 5 * HOUR - 3 * MINUTE };
  const previous = opened.resetsAtMs - 5 * HOUR;
  const points = [at(40, 80, previous), at(10, 90, previous), at(0, 1, opened.resetsAtMs)];
  // 10 points before the reset and 1 after it, read over the last 30 minutes.
  const rate = recentRate(points, opened, FIVE, NOW);
  near(rate, ((90 + 1) - (80 + 10 / 3)) / 0.5);
});

test('a small drop within one window is an older figure arriving late and is ignored', () => {
  const opened = { percentUsed: 31, resetsAtMs: NOW + 5 * HOUR - 30 * MINUTE };
  const reset = opened.resetsAtMs;
  const points = [at(20, 30, reset), at(10, 29.5, reset), at(0, 31, reset)];
  // From the window's start (0) to 30 at 20 minutes ago, then only the rise to 31.
  near(recentRate(points, opened, FIVE, NOW), 31 / 0.5);
});

test('a reading from an earlier window after a later one (another account, a stale writer) is ignored', () => {
  const points = [at(40, 10), at(20, 70, FIVE_RESET - 5 * HOUR), at(0, 20)];
  // The line runs from 10 at 40 minutes ago straight to 20 now: 12.5 at 30 minutes ago.
  near(recentRate(points, five(20), FIVE, NOW), (20 - 12.5) / 0.5);
});

test('readings stamped after now are left out', () => {
  const points = [at(60, 10), at(30, 20), at(0, 30), [NOW + 10 * MINUTE, 90, FIVE_RESET]];
  near(recentRate(points, five(30), FIVE, NOW), 20);
});

test('no pace while the readings cover less than 15 minutes, nor without a reset time', () => {
  const opened = { percentUsed: 2, resetsAtMs: NOW + 5 * HOUR - 10 * MINUTE };
  assert.equal(recentRate([], opened, FIVE, NOW), null);
  assert.equal(recentRate([], { percentUsed: 5, resetsAtMs: NOW + 5 * HOUR + 1 }, FIVE, NOW), null);
  assert.equal(recentRate([at(0, 10)], { percentUsed: 10, resetsAtMs: null }, FIVE, NOW), null);
  assert.equal(recentRate([], null, FIVE, NOW), null);
});

test('currentPercent takes the newest reading of the same window, else the session figure', () => {
  assert.equal(currentPercent([at(30, 20), at(5, 45), at(10, 44)], five(40), NOW), 45);
  assert.equal(currentPercent([at(5, 45, FIVE_RESET - 5 * HOUR)], five(40), NOW), 40);
  assert.equal(currentPercent([], five(40), NOW), 40);
  assert.equal(currentPercent([at(5, 1)], five(40), NOW), 1); // a manual reset another session already saw
  assert.equal(currentPercent([at(5, 45), [NOW + MINUTE, 90, FIVE_RESET]], five(40), NOW), 45);
});
