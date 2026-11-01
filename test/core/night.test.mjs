import { test } from 'node:test';
import assert from 'node:assert/strict';
import { NIGHT, nightBeforeReset } from '../../src/core/night.mjs';

const HOUR = 3_600_000;
const at = (iso) => Date.parse(iso);
const WARSAW = 'Europe/Warsaw';
// Tuesday 2026-11-03 in Warsaw (CET, UTC+1): 02:00 is 01:00 UTC and 07:00 is 06:00 UTC.
const TUESDAY_02 = at('2026-11-03T01:00:00Z');
const TUESDAY_07 = at('2026-11-03T06:00:00Z');
const SUNDAY_19 = at('2026-11-01T18:00:00Z');
const clock = (nowMs, timeZone = WARSAW) => ({ nowMs, timeZone });
const lengthOf = (pause) => pause.endMs - pause.startMs;

test('the night runs 02:00–07:00 on the user\'s clock', () => {
  assert.equal(NIGHT.startTimeOfDayMs, 2 * HOUR);
  assert.equal(NIGHT.endTimeOfDayMs, 7 * HOUR);
  assert.ok(Object.isFrozen(NIGHT));
});

test('a reset at 07:00 ends the week at 02:00: the last five hours are left out', () => {
  assert.deepEqual(nightBeforeReset(TUESDAY_07, clock(SUNDAY_19)), { startMs: TUESDAY_02, endMs: TUESDAY_07 });
});

test('a later reset leaves out the whole night that comes before it', () => {
  for (const reset of [TUESDAY_07 + HOUR, TUESDAY_07 + 5 * HOUR, TUESDAY_07 + 16 * HOUR]) { // 08:00, 12:00, 23:00
    assert.deepEqual(nightBeforeReset(reset, clock(SUNDAY_19)), { startMs: TUESDAY_02, endMs: TUESDAY_07 });
  }
});

test('a reset within the night leaves out the part of it before the reset', () => {
  const pause = nightBeforeReset(TUESDAY_02 + 3 * HOUR, clock(SUNDAY_19)); // 05:00
  assert.deepEqual(pause, { startMs: TUESDAY_02, endMs: TUESDAY_02 + 3 * HOUR });
});

test('a reset at or before 02:00 leaves out the night of the day before', () => {
  const mondayNight = { startMs: TUESDAY_02 - 24 * HOUR, endMs: TUESDAY_07 - 24 * HOUR };
  assert.deepEqual(nightBeforeReset(TUESDAY_02, clock(SUNDAY_19)), mondayNight);
  assert.deepEqual(nightBeforeReset(TUESDAY_02 - HOUR, clock(SUNDAY_19)), mondayNight); // 01:00
});

test('once that night has begun, nothing is left out: whoever works through it is awake', () => {
  assert.equal(nightBeforeReset(TUESDAY_07, clock(TUESDAY_02)), null);
  assert.equal(nightBeforeReset(TUESDAY_07, clock(TUESDAY_02 + HOUR)), null); // 03:00
  assert.equal(nightBeforeReset(TUESDAY_07 + 5 * HOUR, clock(TUESDAY_07 + HOUR)), null); // 08:00, reset 12:00
  assert.ok(nightBeforeReset(TUESDAY_07, clock(TUESDAY_02 - 1)));
});

test('the night follows the clock on the night of a daylight-saving change', () => {
  // Warsaw, 2027-03-28: the clock jumps from 02:00 to 03:00, so the night ends at 07:00 CEST
  // (05:00 UTC) four hours after it began, whether the week resets then or later that day.
  const saturday = clock(at('2027-03-27T18:00:00Z'));
  const spring = { startMs: at('2027-03-28T01:00:00Z'), endMs: at('2027-03-28T05:00:00Z') };
  assert.deepEqual(nightBeforeReset(at('2027-03-28T05:00:00Z'), saturday), spring);
  assert.deepEqual(nightBeforeReset(at('2027-03-28T10:00:00Z'), saturday), spring);
  assert.equal(lengthOf(spring), 4 * HOUR);
  // Warsaw, 2026-10-25: the clock goes back from 03:00 to 02:00; the night starts at the second
  // 02:00 (01:00 UTC) and ends at 07:00 CET (06:00 UTC).
  const autumn = nightBeforeReset(at('2026-10-25T10:00:00Z'), clock(at('2026-10-24T18:00:00Z')));
  assert.deepEqual(autumn, { startMs: at('2026-10-25T01:00:00Z'), endMs: at('2026-10-25T06:00:00Z') });
});

test('the night is the user\'s: the same reset in another zone leaves out other hours', () => {
  const pause = nightBeforeReset(TUESDAY_07, clock(SUNDAY_19, 'UTC'));
  assert.deepEqual(pause, { startMs: at('2026-11-03T02:00:00Z'), endMs: TUESDAY_07 }); // 02:00–06:00 UTC
});

test('nightBeforeReset gives null without a usable reset, clock or time zone', () => {
  assert.equal(nightBeforeReset(TUESDAY_07, clock(SUNDAY_19, null)), null);
  assert.equal(nightBeforeReset(TUESDAY_07, clock(SUNDAY_19, 'Not/AZone')), null);
  assert.equal(nightBeforeReset(null, clock(SUNDAY_19)), null);
  assert.equal(nightBeforeReset(NaN, clock(SUNDAY_19)), null);
  assert.equal(nightBeforeReset(TUESDAY_07, clock(NaN)), null);
  assert.equal(nightBeforeReset(TUESDAY_07, clock(TUESDAY_07 + HOUR)), null); // a reset in the past
});
