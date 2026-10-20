import { test } from 'node:test';
import assert from 'node:assert/strict';
import { claudeConfigDir, folderName, limitHistoryPath } from '../../src/core/paths.mjs';
import { appendPoint } from '../../src/core/history.mjs';

test('claudeConfigDir: CLAUDE_CONFIG_DIR, else .claude in the home folder, else null', () => {
  assert.equal(claudeConfigDir('D:\\claude', 'C:\\Users\\dev'), 'D:\\claude');
  assert.equal(claudeConfigDir('', 'C:\\Users\\dev\\'), 'C:\\Users\\dev/.claude');
  assert.equal(claudeConfigDir('  ', '/home/dev'), '/home/dev/.claude');
  assert.equal(claudeConfigDir(undefined, undefined), null);
  assert.equal(claudeConfigDir(null, ' '), null);
});

test('limitHistoryPath sits in the limits-statusline folder of the config folder', () => {
  assert.equal(limitHistoryPath('/home/dev/.claude'), '/home/dev/.claude/limits-statusline/limit-history.json');
  assert.equal(limitHistoryPath('D:\\claude\\'), 'D:\\claude/limits-statusline/limit-history.json');
});

test('folderName takes the last segment of Windows and POSIX paths', () => {
  assert.equal(folderName('C:\\Users\\dev\\daily-claude'), 'daily-claude');
  assert.equal(folderName('/home/dev/api/'), 'api');
  assert.equal(folderName('C:/'), 'C:');
  assert.equal(folderName(''), null);
  assert.equal(folderName(42), null);
});

test('appendPoint adds a changed finite value and keeps the newest maxPoints', () => {
  assert.deepEqual(appendPoint([1, 2], 3, 40), [1, 2, 3]);
  assert.deepEqual(appendPoint([1, 2, 3], 4, 3), [2, 3, 4]);
});

test('appendPoint returns the same array for a repeat or a non-finite value', () => {
  const points = [5];
  assert.equal(appendPoint(points, 5, 40), points);
  assert.equal(appendPoint(points, NaN, 40), points);
  assert.equal(appendPoint(points, undefined, 40), points);
});
