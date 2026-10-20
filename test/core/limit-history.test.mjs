import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  EMPTY_LIMIT_HISTORY, HISTORY_RETENTION_MS, MAX_SESSIONS, parseLimitHistory, recordLimits, serializeLimitHistory,
} from '../../src/core/limit-history.mjs';

const NOW = 1_800_000_000_000;
const MINUTE = 60_000;
const FIVE_RESET = NOW + 4 * 3_600_000;
const SEVEN_RESET = NOW + 3 * 86_400_000;
const limits = (fivePercent, sevenPercent = null) => ({
  fiveHour: fivePercent === null ? null : { percentUsed: fivePercent, resetsAtMs: FIVE_RESET },
  sevenDay: sevenPercent === null ? null : { percentUsed: sevenPercent, resetsAtMs: SEVEN_RESET },
});
const record = (history, sessionId, value, nowMs, seven = null) =>
  recordLimits(history, { sessionId, limits: limits(value, seven), nowMs });

test('recordLimits adds a point per window the session reports', () => {
  const history = record(EMPTY_LIMIT_HISTORY, 'a', 12, NOW, 39);
  assert.deepEqual(history.readings.fiveHour, [[NOW, 12, FIVE_RESET]]);
  assert.deepEqual(history.readings.sevenDay, [[NOW, 39, SEVEN_RESET]]);
  assert.deepEqual(history.sessions.a, { atMs: NOW, fiveHour: [12, FIVE_RESET], sevenDay: [39, SEVEN_RESET] });
});

test('a session repeating the reading it already gave records nothing and returns the same history', () => {
  const once = record(EMPTY_LIMIT_HISTORY, 'a', 12, NOW);
  assert.equal(record(once, 'a', 12, NOW + 10 * MINUTE), once);
});

test('an idle session replaying an old reading never overwrites what another session saw since', () => {
  let history = record(EMPTY_LIMIT_HISTORY, 'idle', 40, NOW);
  history = record(history, 'busy', 45, NOW + 5 * MINUTE);
  history = record(history, 'idle', 40, NOW + 6 * MINUTE);
  assert.deepEqual(history.readings.fiveHour.map(([, percent]) => percent), [40, 45]);
});

const firstSeen = (history, sessionId, value, lastResponseAtMs) =>
  recordLimits(history, { sessionId, limits: limits(value), nowMs: NOW, lastResponseAtMs });

test('a figure a session reports for the first time is stamped with its last response, never later than now', () => {
  const late = firstSeen(EMPTY_LIMIT_HISTORY, 'a', 12, NOW - 40 * MINUTE);
  assert.deepEqual(late.readings.fiveHour, [[NOW - 40 * MINUTE, 12, FIVE_RESET]]);
  assert.equal(late.sessions.a.atMs, NOW); // the session itself was seen now
  assert.equal(firstSeen(EMPTY_LIMIT_HISTORY, 'a', 12, NOW + MINUTE).readings.fiveHour[0][0], NOW);
  assert.equal(firstSeen(EMPTY_LIMIT_HISTORY, 'a', 12, NaN).readings.fiveHour[0][0], NOW);
  assert.equal(firstSeen(EMPTY_LIMIT_HISTORY, 'a', 12, null).readings.fiveHour[0][0], NOW);
});

test('a changed figure of a known session came with a new response and is stamped now', () => {
  const known = firstSeen(EMPTY_LIMIT_HISTORY, 'a', 12, NOW - 40 * MINUTE);
  const changed = recordLimits(known, { sessionId: 'a', limits: limits(14), nowMs: NOW + MINUTE, lastResponseAtMs: NOW - 40 * MINUTE });
  assert.deepEqual(changed.readings.fiveHour.at(-1), [NOW + MINUTE, 14, FIVE_RESET]);
});

test('an old figure seen for the first time lands at its own time, before the newer ones', () => {
  let history = record(EMPTY_LIMIT_HISTORY, 'busy', 20, NOW);
  history = firstSeen(history, 'idle', 2, NOW - 40 * MINUTE);
  assert.deepEqual(history.readings.fiveHour.map(([atMs, percent]) => [atMs, percent]), [[NOW, 20], [NOW - 40 * MINUTE, 2]]);
});

test('readings within one minute of each other keep only the newest', () => {
  let history = record(EMPTY_LIMIT_HISTORY, 'a', 12, NOW);
  history = record(history, 'a', 12.4, NOW + 20_000);
  history = record(history, 'a', 12.9, NOW + 50_000);
  assert.deepEqual(history.readings.fiveHour, [[NOW + 50_000, 12.9, FIVE_RESET]]);
  history = record(history, 'a', 13.5, NOW + 70_000);
  assert.equal(history.readings.fiveHour.length, 2);
});

test('readings older than the retention are pruned when a new one arrives, all but the newest of them', () => {
  let history = record(EMPTY_LIMIT_HISTORY, 'a', 5, NOW);
  history = record(history, 'a', 6, NOW + 2 * MINUTE);
  history = record(history, 'a', 7, NOW + HISTORY_RETENTION_MS.fiveHour + 5 * MINUTE);
  // 6% stays: the pace after a long pause reads its look-back's start off it.
  assert.deepEqual(history.readings.fiveHour.map(([, percent]) => percent), [6, 7]);
  history = record(history, 'a', 8, NOW + 2 * HISTORY_RETENTION_MS.fiveHour + 10 * MINUTE);
  assert.deepEqual(history.readings.fiveHour.map(([, percent]) => percent), [7, 8]);
});

test('the 7-day readings keep five-minute buckets and two days', () => {
  const seven = (history, value, atMs) => recordLimits(history, { sessionId: 'a', limits: limits(null, value), nowMs: atMs });
  let history = seven(EMPTY_LIMIT_HISTORY, 39, NOW);
  history = seven(history, 39.4, NOW + 4 * MINUTE);
  assert.deepEqual(history.readings.sevenDay, [[NOW + 4 * MINUTE, 39.4, SEVEN_RESET]]);
  history = seven(history, 40, NOW + 5 * MINUTE);
  assert.equal(history.readings.sevenDay.length, 2);
  history = seven(history, 41, NOW + HISTORY_RETENTION_MS.sevenDay + 10 * MINUTE);
  assert.deepEqual(history.readings.sevenDay.map(([, percent]) => percent), [40, 41]);
  assert.equal(HISTORY_RETENTION_MS.sevenDay, 48 * 60 * MINUTE);
});

test('reset times within the tolerance name the same window; further apart they do not', () => {
  const at = (value, resetsAtMs, nowMs) => ({ sessionId: 'a', limits: { fiveHour: { percentUsed: value, resetsAtMs }, sevenDay: null }, nowMs });
  const once = recordLimits(EMPTY_LIMIT_HISTORY, at(12, FIVE_RESET, NOW));
  assert.equal(recordLimits(once, at(12, FIVE_RESET + MINUTE, NOW + MINUTE)), once); // the same figure, rounded differently
  const moved = recordLimits(once, at(12, FIVE_RESET + 11 * MINUTE, NOW + MINUTE));
  assert.equal(moved.readings.fiveHour.length, 2); // the same percent in a new window is news
  const sameBucket = recordLimits(once, at(13, FIVE_RESET + 5 * 3_600_000, NOW + 20_000));
  assert.equal(sameBucket.readings.fiveHour.length, 2); // one bucket never merges two windows
});

test('one kind changing while the other stays adds only the changed one', () => {
  const both = record(EMPTY_LIMIT_HISTORY, 'a', 12, NOW, 39);
  const next = record(both, 'a', 13, NOW + 2 * MINUTE, 39);
  assert.equal(next.readings.fiveHour.length, 2);
  assert.equal(next.readings.sevenDay, both.readings.sevenDay);
  assert.deepEqual(next.sessions.a, { atMs: NOW + 2 * MINUTE, fiveHour: [13, FIVE_RESET], sevenDay: [39, SEVEN_RESET] });
});

test('sessions not seen within the longest retention are forgotten', () => {
  let history = record(EMPTY_LIMIT_HISTORY, 'old', 5, NOW);
  history = record(history, 'new', 6, NOW + HISTORY_RETENTION_MS.sevenDay + MINUTE);
  assert.deepEqual(Object.keys(history.sessions), ['new']);
});

test('at most MAX_SESSIONS sessions are kept, the most recently seen ones', () => {
  let history = EMPTY_LIMIT_HISTORY;
  for (let index = 0; index < MAX_SESSIONS + 5; index += 1) history = record(history, `s${index}`, 10 + index, NOW + index * MINUTE);
  assert.equal(Object.keys(history.sessions).length, MAX_SESSIONS);
  assert.ok(history.sessions[`s${MAX_SESSIONS + 4}`]);
  assert.equal(history.sessions.s0, undefined);
});

test('a reading stamped before the newest one (another clock, a late writer) is added, not merged', () => {
  let history = record(EMPTY_LIMIT_HISTORY, 'a', 20, NOW + 10 * MINUTE);
  history = record(history, 'b', 19, NOW);
  assert.deepEqual(history.readings.fiveHour.map(([atMs]) => atMs), [NOW + 10 * MINUTE, NOW]);
});

test('recordLimits skips windows without a usable reading and sessions without an id', () => {
  const noReset = { fiveHour: { percentUsed: 10, resetsAtMs: null }, sevenDay: { percentUsed: NaN, resetsAtMs: SEVEN_RESET } };
  assert.equal(recordLimits(EMPTY_LIMIT_HISTORY, { sessionId: 'a', limits: noReset, nowMs: NOW }), EMPTY_LIMIT_HISTORY);
  assert.equal(record(EMPTY_LIMIT_HISTORY, null, 12, NOW), EMPTY_LIMIT_HISTORY);
  assert.equal(record(EMPTY_LIMIT_HISTORY, '', 12, NOW), EMPTY_LIMIT_HISTORY);
  assert.equal(recordLimits(EMPTY_LIMIT_HISTORY, { sessionId: 'a', limits: null, nowMs: NOW }), EMPTY_LIMIT_HISTORY);
});

test('serialize and parse round-trip a history', () => {
  const history = record(record(EMPTY_LIMIT_HISTORY, 'a', 12, NOW, 39), 'b', 13, NOW + 2 * MINUTE, 39.5);
  assert.deepEqual(parseLimitHistory(serializeLimitHistory(history)), history);
});

test('parseLimitHistory turns anything broken into the empty history and drops bad entries', () => {
  for (const text of ['', 'not json', '[]', 'null', '{"version":99,"readings":{}}', undefined, 42]) {
    assert.deepEqual(parseLimitHistory(text), EMPTY_LIMIT_HISTORY, String(text));
  }
  const mixed = JSON.stringify({
    version: 1,
    readings: { fiveHour: [[NOW, 12, FIVE_RESET], ['x', 1, 2], [NOW, -5, FIVE_RESET], [NOW, 12]], sevenDay: 'nope' },
    sessions: { a: { atMs: NOW, fiveHour: [12, FIVE_RESET], sevenDay: null }, b: 'nope', c: { atMs: 'x' } },
  });
  assert.deepEqual(parseLimitHistory(mixed), {
    readings: { fiveHour: [[NOW, 12, FIVE_RESET]], sevenDay: [] },
    sessions: { a: { atMs: NOW, fiveHour: [12, FIVE_RESET], sevenDay: null } },
  });
});

test('the empty history is frozen, so a caller cannot change it by accident', () => {
  assert.ok(Object.isFrozen(EMPTY_LIMIT_HISTORY));
  assert.ok(Object.isFrozen(EMPTY_LIMIT_HISTORY.readings.fiveHour));
});
