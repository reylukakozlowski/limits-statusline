import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  formatDuration, formatTokens, formatUsd, formatPercent, formatRate,
} from '../../src/core/format.mjs';

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
