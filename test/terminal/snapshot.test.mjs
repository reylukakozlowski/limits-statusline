import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { limitsFromStatusInput, snapshotFromStatusInput } from '../../src/terminal/snapshot.mjs';
import { MOCKUP, EMPTY, NOW } from '../fixtures/snapshots.mjs';

const fixture = (name) => JSON.parse(readFileSync(new URL(`../fixtures/status-input.${name}.json`, import.meta.url), 'utf8'));
const options = { nowMs: NOW, git: null, contextHistory: [] };

test('the full stdin fixture maps onto the mockup snapshot', () => {
  const snapshot = snapshotFromStatusInput(fixture('full'), {
    nowMs: NOW, git: MOCKUP.git, contextHistory: MOCKUP.contextHistory, timeZone: 'UTC',
  });
  assert.deepEqual(snapshot, MOCKUP);
});

test('the shared limit readings passed in reach the snapshot', () => {
  const limitReadings = { fiveHour: [[NOW, 12, NOW + 15_000_000]], sevenDay: [] };
  assert.equal(snapshotFromStatusInput({}, { ...options, limitReadings }).limitReadings, limitReadings);
});

test('limitsFromStatusInput reads the two plan windows on their own, before a snapshot is built', () => {
  assert.deepEqual(limitsFromStatusInput(fixture('full')), MOCKUP.limits);
  assert.deepEqual(limitsFromStatusInput(null), { sevenDay: null, fiveHour: null });
});

test('prompt_cache: warm with its expiry in ms, cold without one, nothing when neither is sent', () => {
  const cacheOf = (promptCache) => snapshotFromStatusInput({ prompt_cache: promptCache }, options).promptCache;
  assert.deepEqual(cacheOf({ warm: true, expires_at: 1_800_000_060 }), { warm: true, expiresAtMs: 1_800_000_060_000 });
  assert.deepEqual(cacheOf({ warm: false, expires_at: null }), { warm: false, expiresAtMs: null });
  assert.equal(cacheOf({ hit_ratio: 0.5 }), null);
  assert.equal(cacheOf({ warm: 'yes', expires_at: 'soon' }), null);
  assert.equal(cacheOf(null), null);
});

test('changed lines come from cost, a missing count is 0 and a negative or wrongly typed one is ignored', () => {
  const linesOf = (cost) => snapshotFromStatusInput({ cost }, options).linesChanged;
  assert.deepEqual(linesOf({ total_lines_added: 156, total_lines_removed: 23 }), { added: 156, removed: 23 });
  assert.deepEqual(linesOf({ total_lines_added: 4 }), { added: 4, removed: 0 });
  assert.equal(linesOf({ total_lines_added: -1, total_lines_removed: '2' }), null);
  assert.equal(linesOf({}), null);
});

test('older Claude Code input: cache from current_usage, repo name from workspace.repo, no effort or limits', () => {
  const snapshot = snapshotFromStatusInput(fixture('legacy'), options);
  assert.equal(snapshot.cacheHitRatio, 0.99);
  assert.equal(snapshot.project, 'api-server');
  assert.equal(snapshot.modelName, 'Sonnet 4.5');
  assert.equal(snapshot.effort, null);
  assert.deepEqual(snapshot.limits, { sevenDay: null, fiveHour: null });
});

test('an empty object, null or wrongly typed fields give the all-null snapshot', () => {
  assert.deepEqual(snapshotFromStatusInput({}, options), EMPTY);
  assert.deepEqual(snapshotFromStatusInput(null, options), EMPTY);
  const wrong = {
    cost: { total_cost_usd: '20' },
    effort: { level: 7 },
    rate_limits: { five_hour: { used_percentage: 'x' } },
    workspace: { current_dir: 42 },
  };
  assert.deepEqual(snapshotFromStatusInput(wrong, options), EMPTY);
});

test('a window without resets_at keeps its usage and drops the countdown', () => {
  const input = { rate_limits: { seven_day: { used_percentage: 20 } } };
  assert.deepEqual(snapshotFromStatusInput(input, options).limits.sevenDay, { percentUsed: 20, resetsAtMs: null });
});

test('project falls back to the folder name for Windows and POSIX paths', () => {
  const at = (dir) => snapshotFromStatusInput({ workspace: { current_dir: dir } }, options).project;
  assert.equal(at('C:\\Users\\dev\\daily-claude'), 'daily-claude');
  assert.equal(at('/home/dev/api/'), 'api');
});
