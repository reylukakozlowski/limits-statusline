import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  afterClear, initialTracker, withContext, withEffort, withGit, withTurnUsage,
} from '../../src/desktop/tracker.mjs';

test('afterClear starts the conversation figures over and keeps what still holds', () => {
  const git = { isRepo: true, branch: 'develop', isDirty: false };
  const busy = { effort: 'xhigh', cache: { input: 5, creation: 1, read: 90 }, history: [10, 20], git };
  assert.deepEqual(afterClear(busy), { effort: 'xhigh', cache: { input: 0, creation: 0, read: 0 }, history: [], git });
});

test('initialTracker knows nothing yet', () => {
  assert.deepEqual(initialTracker(), {
    effort: null, cache: { input: 0, creation: 0, read: 0 }, history: [], git: null,
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
  const once = withTurnUsage(initialTracker(), { usage });
  const twice = withTurnUsage(once, { usage });
  assert.deepEqual(twice.cache, { input: 20, creation: 4, read: 1976 });
  assert.equal(withTurnUsage(twice, { usage, agentId: 'a1' }), twice);
  assert.equal(withTurnUsage(twice, { reason: 'error' }), twice);
});

test('withContext and withGit update their own fields', () => {
  const tracker = withContext(withContext(initialTracker(), 40), 54);
  assert.deepEqual(tracker.history, [40, 54]);
  assert.equal(withContext(tracker, 54), tracker);
  const git = { isRepo: true, branch: 'develop', isDirty: false };
  assert.deepEqual(withGit(tracker, git).git, git);
});
