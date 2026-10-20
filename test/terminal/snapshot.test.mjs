import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { snapshotFromStatusInput } from '../../src/terminal/snapshot.mjs';
import { MOCKUP, EMPTY, NOW } from '../fixtures/snapshots.mjs';

const fixture = (name) => JSON.parse(readFileSync(new URL(`../fixtures/status-input.${name}.json`, import.meta.url), 'utf8'));
const options = { nowMs: NOW, git: null, contextHistory: [] };

test('the full stdin fixture maps onto the mockup snapshot', () => {
  const snapshot = snapshotFromStatusInput(fixture('full'), {
    nowMs: NOW, git: MOCKUP.git, contextHistory: MOCKUP.contextHistory,
  });
  assert.deepEqual(snapshot, MOCKUP);
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
