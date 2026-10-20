import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadLimitReadings, recordMeasuredLimits } from '../../src/desktop/limit-history.mjs';
import { serializeLimitHistory } from '../../src/core/limit-history.mjs';
import { fakeEngine, fiveHour } from './fake-engine.mjs';

const NOW = 1_800_000_000_000;
const RESET = NOW + 15_000_000;
const FILE = 'C:/Users/dev/.claude/limits-statusline/limit-history.json';

test('recordMeasuredLimits writes the measured figures to the shared file under the config folder', async () => {
  const { $, files } = fakeEngine();
  await recordMeasuredLimits($, [fiveHour(12, RESET), { kind: 'spend_limit', percentUsed: 80 }], NOW);
  const history = JSON.parse(files[FILE]);
  assert.deepEqual(history.readings.fiveHour, [[NOW, 12, RESET]]);
  assert.deepEqual(history.readings.sevenDay, []);
  assert.deepEqual(Object.keys(history.sessions), ['session-1']);
});

test('CLAUDE_CONFIG_DIR wins over the home folder, and HOME serves where USERPROFILE is unset', async () => {
  const configured = fakeEngine({ env: { CLAUDE_CONFIG_DIR: 'D:/claude', USERPROFILE: 'C:/Users/dev' } });
  await recordMeasuredLimits(configured.$, [fiveHour(12, RESET)], NOW);
  assert.deepEqual(configured.written, ['D:/claude/limits-statusline/limit-history.json']);
  const posix = fakeEngine({ env: { HOME: '/home/dev/' } });
  await recordMeasuredLimits(posix.$, [fiveHour(12, RESET)], NOW);
  assert.deepEqual(posix.written, ['/home/dev/.claude/limits-statusline/limit-history.json']);
});

test('recordMeasuredLimits leaves the file alone when nothing changed or nothing can be found', async () => {
  const { $, written } = fakeEngine();
  await recordMeasuredLimits($, [fiveHour(12, RESET)], NOW);
  await recordMeasuredLimits($, [fiveHour(12, RESET)], NOW + 60_000);
  assert.equal(written.length, 1);
  const homeless = fakeEngine({ env: {} });
  await recordMeasuredLimits(homeless.$, [fiveHour(12, RESET)], NOW);
  assert.deepEqual(homeless.written, []);
  const stale = fakeEngine();
  await recordMeasuredLimits(stale.$, [fiveHour(12, NOW - 1)], NOW); // a window whose reset has passed
  assert.deepEqual(stale.written, []);
});

test('recordMeasuredLimits never throws when the engine refuses', async () => {
  const { $ } = fakeEngine();
  $.fs.write = async () => { throw new Error('EBUSY'); };
  await recordMeasuredLimits($, [fiveHour(12, RESET)], NOW);
  $.session.id = async () => { throw new Error('no session'); };
  await recordMeasuredLimits($, [fiveHour(13, RESET)], NOW);
  $.env.get = async () => { throw new Error('denied'); };
  await recordMeasuredLimits($, [fiveHour(14, RESET)], NOW);
});

test('loadLimitReadings reads the shared readings, and none when the file is missing or broken', async () => {
  const readings = { fiveHour: [[NOW, 12, RESET]], sevenDay: [] };
  const { $ } = fakeEngine({ files: { [FILE]: serializeLimitHistory({ readings, sessions: {} }) } });
  assert.deepEqual(await loadLimitReadings($), readings);
  const empty = { fiveHour: [], sevenDay: [] };
  assert.deepEqual(await loadLimitReadings(fakeEngine().$), empty);
  assert.deepEqual(await loadLimitReadings(fakeEngine({ files: { [FILE]: '{ half' } }).$), empty);
  assert.deepEqual(await loadLimitReadings(fakeEngine({ env: {} }).$), empty);
  const failing = fakeEngine({ files: { [FILE]: '{}' } });
  failing.$.fs.read = async () => { throw new Error('EACCES'); };
  assert.deepEqual(await loadLimitReadings(failing.$), empty);
});
