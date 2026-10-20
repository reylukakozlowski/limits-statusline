import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  formatClock, formatCountdown, formatDuration, formatTokens, formatUsd, formatPercent, formatRate,
} from '../../src/core/format.mjs';

const HOUR = 3_600_000;
// 2027-01-15 08:00 UTC, a Friday.
const NOW = 1_800_000_000_000;

test('formatDuration renders hours and zero-padded minutes like the mockup', () => {
  assert.equal(formatDuration(20_400_000), '5h40m');
  assert.equal(formatDuration(274_200_000), '76h10m');
  assert.equal(formatDuration(14_700_000), '4h05m');
});

test('formatDuration uses minutes below an hour and seconds below a minute', () => {
  assert.equal(formatDuration(3_000_000), '50m');
  assert.equal(formatDuration(42_000), '42s');
  assert.equal(formatDuration(0), '0s');
});

test('formatDuration returns a dash for negative or non-finite input', () => {
  assert.equal(formatDuration(-1), '—');
  assert.equal(formatDuration(NaN), '—');
  assert.equal(formatDuration(null), '—');
  assert.equal(formatDuration(undefined), '—');
});

test('formatTokens uses k below a million and one decimal M above', () => {
  assert.equal(formatTokens(543_000), '543k');
  assert.equal(formatTokens(1_000_000), '1.0M');
  assert.equal(formatTokens(999_600), '1.0M');
  assert.equal(formatTokens(950), '950');
  assert.equal(formatTokens(-5), '—');
  assert.equal(formatTokens('12'), '—');
});

test('formatUsd always shows two decimals', () => {
  assert.equal(formatUsd(20.333), '$20.33');
  assert.equal(formatUsd(0), '$0.00');
  assert.equal(formatUsd(Infinity), '—');
});

test('formatPercent rounds and formatRate keeps one decimal per hour', () => {
  assert.equal(formatPercent(53.6), '54%');
  assert.equal(formatPercent(null), '—');
  assert.equal(formatRate(14.4), '14.4%/h');
  assert.equal(formatRate(0.4247), '0.4%/h');
  assert.equal(formatRate(NaN), '—');
});

test('formatRate shows a per-day rate as 24 hours of the hourly one', () => {
  assert.equal(formatRate(0.4247, 'd'), '10.2%/d');
  assert.equal(formatRate(0, 'd'), '0.0%/d');
  assert.equal(formatRate(1, 'week'), '—');
});

test('formatCountdown rolls whole days out of the hours from a day on', () => {
  assert.equal(formatCountdown(161 * HOUR + 50 * 60_000), '6d17h');
  assert.equal(formatCountdown(274_200_000), '3d04h');
  assert.equal(formatCountdown(24 * HOUR), '1d00h');
  assert.equal(formatCountdown(24 * HOUR - 60_000), '23h59m');
  assert.equal(formatCountdown(13_800_000), '3h50m');
  assert.equal(formatCountdown(42_000), '42s');
  assert.equal(formatCountdown(-1), '—');
  assert.equal(formatCountdown(null), '—');
});

test('formatClock gives the 24-hour time within a day and the weekday beyond', () => {
  const utc = { nowMs: NOW, timeZone: 'UTC' };
  assert.equal(formatClock(NOW + 15_000_000, utc), '12:10');
  assert.equal(formatClock(NOW + 14 * HOUR + 30 * 60_000, utc), '22:30');
  assert.equal(formatClock(NOW + 17 * HOUR, utc), '01:00');
  assert.equal(formatClock(NOW + 274_200_000, utc), 'Mon 12:10');
  assert.equal(formatClock(NOW + 24 * HOUR, utc), 'Sat 08:00');
});

test('formatClock follows the time zone it is given', () => {
  assert.equal(formatClock(NOW + HOUR, { nowMs: NOW, timeZone: 'Europe/Warsaw' }), '10:00');
  assert.equal(formatClock(NOW + HOUR, { nowMs: NOW, timeZone: 'America/New_York' }), '04:00');
});

test('formatClock is a dash without a usable time or zone', () => {
  assert.equal(formatClock(NOW, { nowMs: NOW, timeZone: null }), '—');
  assert.equal(formatClock(NOW, { nowMs: NOW, timeZone: 'Not/AZone' }), '—');
  assert.equal(formatClock(NaN, { nowMs: NOW, timeZone: 'UTC' }), '—');
  assert.equal(formatClock(NOW, { nowMs: undefined, timeZone: 'UTC' }), '—');
});
