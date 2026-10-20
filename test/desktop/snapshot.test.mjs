import { test } from 'node:test';
import assert from 'node:assert/strict';
import { snapshotFromSession } from '../../src/desktop/snapshot.mjs';
import { MOCKUP, EMPTY, NOW } from '../fixtures/snapshots.mjs';

const iso = (ms) => new Date(ms).toISOString();

const USAGE = Object.freeze({
  startedAt: NOW - 20_400_000,
  context: { tokens: 543_000, window: 1_000_000, percent: 54 },
  rateLimits: [
    { kind: 'five_hour', percentUsed: 12, resetsAt: iso(NOW + 15_000_000) },
    { kind: 'seven_day', percentUsed: 39, resetsAt: iso(NOW + 274_200_000) },
    { kind: 'spend_limit', percentUsed: 80, resetsAt: iso(NOW + 1) },
  ],
  cost: { usd: 20.33 },
});

const ONE_HOUR = 3_600_000;

const TRACKER = Object.freeze({
  effort: 'xhigh',
  cache: { input: 10, creation: 0, read: 990 },
  lastTurn: { atMs: NOW - 480_000, isCached: true }, // 8 minutes ago: 52 minutes of a one-hour cache left
  history: [...MOCKUP.contextHistory],
  git: MOCKUP.git,
});

const SOURCES = Object.freeze({
  usage: USAGE, modelRaw: 'claude-opus-5-5[1m]', cwd: 'C:\\Users\\dev\\daily-claude', tracker: TRACKER, nowMs: NOW,
  timeZone: 'UTC', cacheTtlMs: ONE_HOUR,
});

test('mods API figures map onto the mockup snapshot, without the changed lines the API does not have', () => {
  assert.deepEqual(snapshotFromSession(SOURCES), { ...MOCKUP, linesChanged: null });
});

test('the shared limit readings passed in reach the snapshot', () => {
  const limitReadings = { fiveHour: [[NOW, 12, NOW + 15_000_000]], sevenDay: [] };
  assert.equal(snapshotFromSession({ ...SOURCES, limitReadings }).limitReadings, limitReadings);
});

test('the cache state is estimated from the last turn and the lifetime, and unknown without either', () => {
  assert.deepEqual(snapshotFromSession({ ...SOURCES, cacheTtlMs: 300_000 }).promptCache,
    { warm: true, expiresAtMs: NOW - 180_000 });
  const uncached = { ...TRACKER, lastTurn: { atMs: NOW, isCached: false } };
  assert.deepEqual(snapshotFromSession({ ...SOURCES, tracker: uncached }).promptCache, { warm: false, expiresAtMs: null });
  assert.equal(snapshotFromSession({ ...SOURCES, cacheTtlMs: null }).promptCache, null);
  assert.equal(snapshotFromSession({ ...SOURCES, tracker: { ...TRACKER, lastTurn: null } }).promptCache, null);
  // A tracker kept by an older version of the band has no lastTurn at all.
  const { lastTurn: _dropped, ...older } = TRACKER;
  assert.equal(snapshotFromSession({ ...SOURCES, tracker: older }).promptCache, null);
});

test('nothing known yet gives the all-null snapshot', () => {
  const snapshot = snapshotFromSession({ usage: null, modelRaw: null, cwd: null, tracker: null, nowMs: NOW });
  assert.deepEqual(snapshot, EMPTY);
});

test('a window with an unreadable reset time keeps its usage without a countdown', () => {
  const usage = { ...USAGE, rateLimits: [{ kind: 'seven_day', percentUsed: 20, resetsAt: 'soon' }] };
  const snapshot = snapshotFromSession({ usage, modelRaw: null, cwd: null, tracker: null, nowMs: NOW });
  assert.deepEqual(snapshot.limits, { sevenDay: { percentUsed: 20, resetsAtMs: null }, fiveHour: null });
});

test('a window whose reset time has passed is dropped, as Claude Code drops it for the terminal', () => {
  const usage = { ...USAGE, rateLimits: [{ kind: 'five_hour', percentUsed: 97, resetsAt: iso(NOW - 1) }] };
  assert.equal(snapshotFromSession({ usage, modelRaw: null, cwd: null, tracker: null, nowMs: NOW }).limits.fiveHour, null);
});

test('a session started in the future reads as no duration', () => {
  const usage = { ...USAGE, startedAt: NOW + 1000 };
  assert.equal(snapshotFromSession({ usage, modelRaw: null, cwd: null, tracker: null, nowMs: NOW }).durationMs, null);
});
