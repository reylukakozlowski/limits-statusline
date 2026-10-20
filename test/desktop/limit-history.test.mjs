import { test } from 'node:test';
import assert from 'node:assert/strict';
import { limitHistoryFileFor, withMeasuredLimits } from '../../src/desktop/limit-history.mjs';
import { EMPTY_LIMIT_HISTORY } from '../../src/core/limit-history.mjs';

const NOW = 1_800_000_000_000;
const RESET = NOW + 15_000_000;

const fiveHour = (percentUsed, resetsAtMs) => ({ kind: 'five_hour', percentUsed, resetsAt: new Date(resetsAtMs).toISOString() });

test('the shared file sits under the config folder: CLAUDE_CONFIG_DIR, else USERPROFILE, else HOME', () => {
  assert.equal(limitHistoryFileFor(undefined, 'C:/Users/dev', undefined), 'C:/Users/dev/.claude/limits-statusline/limit-history.json');
  assert.equal(limitHistoryFileFor('D:/claude', 'C:/Users/dev', undefined), 'D:/claude/limits-statusline/limit-history.json');
  assert.equal(limitHistoryFileFor(undefined, undefined, '/home/dev/'), '/home/dev/.claude/limits-statusline/limit-history.json');
  assert.equal(limitHistoryFileFor(undefined, 'C:/Users/dev', '/home/dev'), 'C:/Users/dev/.claude/limits-statusline/limit-history.json');
});

test('no file when no configuration folder is known', () => {
  assert.equal(limitHistoryFileFor(undefined, undefined, undefined), null);
  assert.equal(limitHistoryFileFor('', '', ''), null);
});

test('a measurement adds the plan figures and the session, and ignores other windows', () => {
  const next = withMeasuredLimits(EMPTY_LIMIT_HISTORY, {
    sessionId: 'session-1', rateLimits: [fiveHour(12, RESET), { kind: 'spend_limit', percentUsed: 80 }], nowMs: NOW,
  });
  assert.deepEqual(next.readings.fiveHour, [[NOW, 12, RESET]]);
  assert.deepEqual(next.readings.sevenDay, []);
  assert.deepEqual(Object.keys(next.sessions), ['session-1']);
});

test('the same figure again, or a window whose reset has passed, leaves the history as it was', () => {
  const once = withMeasuredLimits(EMPTY_LIMIT_HISTORY, { sessionId: 'session-1', rateLimits: [fiveHour(12, RESET)], nowMs: NOW });
  assert.equal(withMeasuredLimits(once, { sessionId: 'session-1', rateLimits: [fiveHour(12, RESET)], nowMs: NOW + 60_000 }), once);
  assert.equal(withMeasuredLimits(EMPTY_LIMIT_HISTORY, { sessionId: 'session-1', rateLimits: [fiveHour(12, NOW - 1)], nowMs: NOW }), EMPTY_LIMIT_HISTORY);
});
