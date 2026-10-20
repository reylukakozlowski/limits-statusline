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

const TRACKER = Object.freeze({
  effort: 'xhigh',
  cache: { input: 10, creation: 0, read: 990 },
  history: [...MOCKUP.contextHistory],
  git: MOCKUP.git,
});

test('mods API figures map onto the mockup snapshot', () => {
  const snapshot = snapshotFromSession({
    usage: USAGE, modelRaw: 'claude-opus-5-5[1m]', cwd: 'C:\\Users\\dev\\daily-claude', tracker: TRACKER, nowMs: NOW,
  });
  assert.deepEqual(snapshot, MOCKUP);
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
