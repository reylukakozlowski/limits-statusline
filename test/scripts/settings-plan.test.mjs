import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildStatusLineCommand, isOwnStatusLine, planInstall, planUninstall,
} from '../../scripts/lib/settings-plan.mjs';

const OWN = 'node "C:/Users/x/.claude/plugins/data/limits-statusline-sealoop/runtime/src/terminal/main.mjs" --data "C:/Users/x/.claude/plugins/data/limits-statusline-sealoop"';
const FOREIGN = Object.freeze({ type: 'command', command: '~/.claude/statusline.sh' });

const deepFreeze = (value) => {
  if (value && typeof value === 'object') Object.values(value).forEach(deepFreeze);
  return Object.freeze(value);
};

test('buildStatusLineCommand quotes both paths with forward slashes', () => {
  assert.equal(
    buildStatusLineCommand({ mainPath: 'C:\\Users\\x\\rt\\main.mjs', dataDir: 'C:\\Users\\x\\data dir' }),
    'node "C:/Users/x/rt/main.mjs" --data "C:/Users/x/data dir"',
  );
});

test('buildStatusLineCommand refuses paths a shell would reinterpret', () => {
  for (const bad of ['C:/a"b', 'C:/$HOME/x', 'C:/a`b']) {
    assert.throws(() => buildStatusLineCommand({ mainPath: bad, dataDir: 'C:/d' }), /cannot be quoted/);
  }
});

test('isOwnStatusLine recognises this plugin by its command', () => {
  assert.equal(isOwnStatusLine({ type: 'command', command: OWN }), true);
  assert.equal(isOwnStatusLine(FOREIGN), false);
  assert.equal(isOwnStatusLine(undefined), false);
  assert.equal(isOwnStatusLine({ type: 'command' }), false);
});

test('isOwnStatusLine does not depend on the data folder being named after the plugin', () => {
  assert.equal(isOwnStatusLine({ type: 'command', command: 'node "D:/x/runtime/src/terminal/main.mjs" --data "D:/x"' }), true);
});

test('planInstall into empty settings adds the status line without touching the input', () => {
  const before = deepFreeze({ theme: 'dark' });
  const plan = planInstall(before, { command: OWN });
  assert.deepEqual(plan.settings, {
    theme: 'dark',
    statusLine: { type: 'command', command: OWN, padding: 0, refreshInterval: 60 },
  });
  assert.equal(plan.previous, null);
  assert.equal(plan.changed, true);
});

test('planInstall over a foreign status line keeps it as previous', () => {
  const plan = planInstall(deepFreeze({ statusLine: FOREIGN }), { command: OWN });
  assert.deepEqual(plan.previous, FOREIGN);
  assert.equal(plan.settings.statusLine.command, OWN);
});

test('planInstall again with the same command changes nothing', () => {
  const once = planInstall({}, { command: OWN }).settings;
  const twice = planInstall(deepFreeze(once), { command: OWN });
  assert.equal(twice.changed, false);
  assert.equal(twice.previous, null);
});

test('planUninstall restores the previous status line or removes ours', () => {
  const installed = planInstall({ theme: 'dark', statusLine: FOREIGN }, { command: OWN }).settings;
  assert.deepEqual(planUninstall(deepFreeze(installed), { previous: FOREIGN }),
    { settings: { theme: 'dark', statusLine: FOREIGN }, changed: true });
  assert.deepEqual(planUninstall(deepFreeze(installed), { previous: null }),
    { settings: { theme: 'dark' }, changed: true });
});

test('planUninstall leaves a foreign or missing status line alone', () => {
  assert.equal(planUninstall({ statusLine: FOREIGN }, { previous: null }).changed, false);
  assert.equal(planUninstall({}, { previous: FOREIGN }).changed, false);
});
