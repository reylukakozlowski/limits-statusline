import { test } from 'node:test';
import assert from 'node:assert/strict';
import { clockParts, lastTimeOfDayBefore, timeOfDayMs } from '../../src/core/zone-time.mjs';
import { NOW } from '../fixtures/snapshots.mjs';

const HOUR = 3_600_000;
const at = (iso) => Date.parse(iso);

test('clockParts shows the 24-hour clock of the zone, part by part', () => {
  const parts = clockParts(NOW, 'Europe/Warsaw', { weekday: 'short', hour: '2-digit', minute: '2-digit' });
  assert.equal(parts.weekday, 'Fri');
  assert.equal(parts.hour, '09');
  assert.equal(parts.minute, '00');
  assert.equal(clockParts(at('2027-01-15T00:30:00Z'), 'UTC', { hour: '2-digit' }).hour, '00'); // never 24
});

test('clockParts gives null for an unknown time or zone', () => {
  assert.equal(clockParts(NOW, null, { hour: '2-digit' }), null);
  assert.equal(clockParts(NOW, 'Not/AZone', { hour: '2-digit' }), null);
  assert.equal(clockParts(NaN, 'UTC', { hour: '2-digit' }), null);
});

test('timeOfDayMs is the time since local midnight on the clock of the zone', () => {
  assert.equal(timeOfDayMs(NOW, 'UTC'), 8 * HOUR); // 2027-01-15 08:00 UTC
  assert.equal(timeOfDayMs(NOW, 'Europe/Warsaw'), 9 * HOUR);
  assert.equal(timeOfDayMs(NOW, 'America/New_York'), 3 * HOUR);
  assert.equal(timeOfDayMs(NOW + 61_234, 'UTC'), 8 * HOUR + 61_234);
  assert.equal(timeOfDayMs(at('2027-01-15T23:59:59.999Z'), 'UTC'), 24 * HOUR - 1);
  assert.equal(timeOfDayMs(at('2027-01-15T00:00:00Z'), 'UTC'), 0);
});

test('timeOfDayMs gives null for an unknown time or zone', () => {
  assert.equal(timeOfDayMs(NOW, null), null);
  assert.equal(timeOfDayMs(NOW, undefined), null);
  assert.equal(timeOfDayMs(NOW, 'Not/AZone'), null);
  assert.equal(timeOfDayMs(NaN, 'UTC'), null);
  assert.equal(timeOfDayMs(1e20, 'UTC'), null); // beyond the dates Intl can show
});

test('lastTimeOfDayBefore is the last moment, strictly before, when the clock showed that time', () => {
  assert.equal(lastTimeOfDayBefore(NOW, 2 * HOUR, 'UTC'), NOW - 6 * HOUR);
  assert.equal(lastTimeOfDayBefore(NOW, 9 * HOUR, 'UTC'), NOW - 23 * HOUR);
  assert.equal(lastTimeOfDayBefore(NOW, 8 * HOUR, 'UTC'), NOW - 24 * HOUR); // not the moment itself
  assert.equal(lastTimeOfDayBefore(NOW, 2 * HOUR, 'Europe/Warsaw'), at('2027-01-15T01:00:00Z'));
});

test('lastTimeOfDayBefore follows the clock across a daylight-saving change', () => {
  // Warsaw, spring: 02:00 CET jumps to 03:00 CEST at 01:00 UTC; that moment stands for 02:00.
  assert.equal(lastTimeOfDayBefore(at('2027-03-28T05:00:00Z'), 2 * HOUR, 'Europe/Warsaw'), at('2027-03-28T01:00:00Z'));
  // Warsaw, autumn: 03:00 CEST goes back to 02:00 CET at 01:00 UTC; the later 02:00 is the last one.
  assert.equal(lastTimeOfDayBefore(at('2026-10-25T06:00:00Z'), 2 * HOUR, 'Europe/Warsaw'), at('2026-10-25T01:00:00Z'));
  // At the jump itself the skipped 02:00 is not yet before it: the last one is the day before's.
  assert.equal(lastTimeOfDayBefore(at('2027-03-28T01:00:00Z'), 2 * HOUR, 'Europe/Warsaw'), at('2027-03-27T01:00:00Z'));
});

test('lastTimeOfDayBefore gives null for an unknown time or zone', () => {
  assert.equal(lastTimeOfDayBefore(NOW, 2 * HOUR, null), null);
  assert.equal(lastTimeOfDayBefore(NOW, 2 * HOUR, 'Not/AZone'), null);
  assert.equal(lastTimeOfDayBefore(NaN, 2 * HOUR, 'UTC'), null);
});
