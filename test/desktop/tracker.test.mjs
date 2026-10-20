import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  afterClear, initialTracker, withContext, withEffort, withGit, withTurnUsage,
} from '../../src/desktop/tracker.mjs';

test('afterClear starts the conversation figures over and keeps what still holds', () => {
  const git = { isRepo: true, branch: 'develop', isDirty: false };
  const busy = {
    effort: 'xhigh', cache: { input: 5, creation: 1, read: 90 }, lastTurn: { atMs: 5, isCached: true }, history: [10, 20], git,
  };
  assert.deepEqual(afterClear(busy), {
    effort: 'xhigh', cache: { input: 0, creation: 0, read: 0 }, lastTurn: null, history: [], git,
  });
});

test('initialTracker knows nothing yet', () => {
  assert.deepEqual(initialTracker(), {
    effort: null, cache: { input: 0, creation: 0, read: 0 }, lastTurn: null, history: [], git: null,
  });
});

test('withEffort records the main loop effort and ignores subagent steps', () => {
  const tracker = withEffort(initialTracker(), { turnId: 't', index: 0, model: 'm', effort: 'xhigh', messageCount: 3 });
  assert.equal(tracker.effort, 'xhigh');
  assert.equal(withEffort(tracker, { effort: 'low', agentId: 'a1' }), tracker);
  assert.equal(withEffort(tracker, { effort: 8000 }).effort, '8000');
  assert.equal(withEffort(tracker, {}).effort, null);
});

test('withTurnUsage sums cache counts of main-loop turns only', () => {
  const usage = { input_tokens: 10, output_tokens: 5, cache_creation_input_tokens: 2, cache_read_input_tokens: 988, model: 'm' };
  const once = withTurnUsage(initialTracker(), { usage }, 1_000);
  const twice = withTurnUsage(once, { usage }, 2_000);
  assert.deepEqual(twice.cache, { input: 20, creation: 4, read: 1976 });
  assert.equal(withTurnUsage(twice, { usage, agentId: 'a1' }, 3_000), twice);
  assert.equal(withTurnUsage(twice, { reason: 'error' }, 3_000), twice);
});

test('withTurnUsage notes when the last main-loop turn ended and whether it touched the cache', () => {
  const cached = { input_tokens: 10, output_tokens: 5, cache_creation_input_tokens: 0, cache_read_input_tokens: 900, model: 'm' };
  const uncached = { ...cached, cache_read_input_tokens: 0 };
  assert.deepEqual(withTurnUsage(initialTracker(), { usage: cached }, 1_000).lastTurn, { atMs: 1_000, isCached: true });
  assert.deepEqual(withTurnUsage(initialTracker(), { usage: uncached }, 2_000).lastTurn, { atMs: 2_000, isCached: false });
  const known = withTurnUsage(initialTracker(), { usage: cached }, 1_000);
  assert.deepEqual(withTurnUsage(known, { usage: cached }, NaN).lastTurn, { atMs: 1_000, isCached: true });
});

test('withContext and withGit update their own fields', () => {
  const tracker = withContext(withContext(initialTracker(), 40), 54);
  assert.deepEqual(tracker.history, [40, 54]);
  assert.equal(withContext(tracker, 54), tracker);
  const git = { isRepo: true, branch: 'develop', isDirty: false };
  assert.deepEqual(withGit(tracker, git).git, git);
});
