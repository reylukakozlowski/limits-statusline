import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs, { mkdtempSync, rmSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import {
  SETUP_MARKER, readPluginVersion, runtimeMainPath, syncFromHookEnv, syncRuntime,
} from '../../scripts/lib/runtime-sync.mjs';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const FULL = readFileSync(new URL('../fixtures/status-input.full.json', import.meta.url), 'utf8');

const tempDir = (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'ls-sync-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
};

const busy = (code) => Object.assign(new Error(code), { code });

test('readPluginVersion reads the manifest version', () => {
  assert.match(readPluginVersion(ROOT), /^\d+\.\d+\.\d+$/);
});

test('syncRuntime copies a self-contained runtime that renders the status line', (t) => {
  const data = tempDir(t);
  assert.deepEqual(syncRuntime({ pluginRoot: ROOT, dataDir: data, version: '9.9.9' }), { copied: true });
  assert.equal(readFileSync(join(data, 'runtime', 'VERSION'), 'utf8'), '9.9.9');
  const result = spawnSync(process.execPath, [runtimeMainPath(data)], {
    input: FULL, encoding: 'utf8', env: { ...process.env, NO_COLOR: '1' },
  });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout.trimEnd().split('\n').length, 5);
});

test('syncRuntime skips an up-to-date runtime and replaces an outdated one', (t) => {
  const data = tempDir(t);
  syncRuntime({ pluginRoot: ROOT, dataDir: data, version: '1.0.0' });
  const stale = join(data, 'runtime', 'src', 'terminal', 'stale.mjs');
  writeFileSync(stale, '');
  assert.deepEqual(syncRuntime({ pluginRoot: ROOT, dataDir: data, version: '1.0.0' }), { copied: false });
  assert.equal(existsSync(stale), true);
  assert.deepEqual(syncRuntime({ pluginRoot: ROOT, dataDir: data, version: '1.0.1' }), { copied: true });
  assert.equal(existsSync(stale), false);
  assert.deepEqual(fs.readdirSync(data).sort(), ['runtime']);
});

test('syncRuntime retries a rename that Windows refuses for a moment', (t) => {
  const data = tempDir(t);
  let refusals = 2;
  const rename = (from, to) => {
    if (refusals > 0) { refusals -= 1; throw busy('EPERM'); }
    fs.renameSync(from, to);
  };
  assert.deepEqual(syncRuntime({ pluginRoot: ROOT, dataDir: data, version: '2.0.0', rename }), { copied: true });
  assert.equal(readFileSync(join(data, 'runtime', 'VERSION'), 'utf8'), '2.0.0');
});

test('syncRuntime puts the old runtime back when the new one cannot be moved in', (t) => {
  const data = tempDir(t);
  syncRuntime({ pluginRoot: ROOT, dataDir: data, version: '1.0.0' });
  const rename = (from, to) => {
    if (from.includes('staging')) throw busy('EBUSY');
    fs.renameSync(from, to);
  };
  assert.throws(() => syncRuntime({ pluginRoot: ROOT, dataDir: data, version: '1.0.1', rename }), /EBUSY/);
  assert.equal(readFileSync(join(data, 'runtime', 'VERSION'), 'utf8'), '1.0.0');
  assert.deepEqual(fs.readdirSync(data).sort(), ['runtime']);
});

test('syncFromHookEnv does nothing until setup has run, then repairs a missing runtime', (t) => {
  const data = tempDir(t);
  assert.equal(syncFromHookEnv({}), null);
  assert.equal(syncFromHookEnv({ CLAUDE_PLUGIN_ROOT: ROOT, CLAUDE_PLUGIN_DATA: data }), null);
  assert.equal(existsSync(join(data, 'runtime')), false);
  writeFileSync(join(data, SETUP_MARKER), '{}');
  assert.deepEqual(syncFromHookEnv({ CLAUDE_PLUGIN_ROOT: ROOT, CLAUDE_PLUGIN_DATA: data }), { copied: true });
  assert.ok(existsSync(runtimeMainPath(data)));
});
