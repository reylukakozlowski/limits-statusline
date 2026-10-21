import { test } from 'node:test';
import assert from 'node:assert/strict';
import { configFolderFor, withMeasuredLimits } from '../../src/desktop/limit-history.mjs';
import { EMPTY_LIMIT_HISTORY } from '../../src/core/limit-history.mjs';
import { claudeConfigDir, limitHistoryPath } from '../../src/core/paths.mjs';

const NOW = 1_800_000_000_000;
const RESET = NOW + 15_000_000;

const fiveHour = (percentUsed, resetsAtMs) => ({ kind: 'five_hour', percentUsed, resetsAt: new Date(resetsAtMs).toISOString() });

test('the config folder is CLAUDE_CONFIG_DIR, else .claude in USERPROFILE, else in HOME', () => {
  assert.equal(configFolderFor(undefined, 'C:/Users/dev', undefined), 'C:/Users/dev/.claude');
  assert.equal(configFolderFor('D:/claude', 'C:/Users/dev', undefined), 'D:/claude');
  assert.equal(configFolderFor(undefined, undefined, '/home/dev/'), '/home/dev/.claude');
  assert.equal(configFolderFor(undefined, 'C:/Users/dev', '/home/dev'), 'C:/Users/dev/.claude');
});

// The band writes `${folder}/limits-statusline/limit-history.json` (band.mjs): the file the
// terminal status line keeps, however the folder is spelled.
test('the band names the same history file as the terminal, also for a folder ending in a separator', () => {
  for (const [configDirVariable, home] of [['D:\\claude\\', undefined], ['/srv/claude//', undefined], [undefined, '/home/dev/'], ['/', undefined]]) {
    const folder = configFolderFor(configDirVariable, undefined, home);
    assert.equal(`${folder}/limits-statusline/limit-history.json`, limitHistoryPath(claudeConfigDir(configDirVariable, home)));
  }
});

test('no folder when no configuration folder is known', () => {
  assert.equal(configFolderFor(undefined, undefined, undefined), null);
  assert.equal(configFolderFor('', '', ''), null);
  assert.equal(configFolderFor('  ', null, ' '), null);
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
