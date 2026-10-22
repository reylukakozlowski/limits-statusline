import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs, { mkdtempSync, rmSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import {
  SETUP_MARKER, runtimeFingerprint, runtimeMainPath, syncFromHook, syncRuntime,
} from '../../scripts/lib/runtime-sync.mjs';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const FULL = readFileSync(new URL('../fixtures/status-input.full.json', import.meta.url), 'utf8');

const tempDir = (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'ls-sync-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
};

const busy = (code) => Object.assign(new Error(code), { code });

/** A plugin root holding a copy of the runtime sources, free to edit. */
const pluginCopy = (t) => {
  const root = tempDir(t);
  for (const part of [['src', 'core'], ['src', 'terminal']]) {
    fs.cpSync(join(ROOT, ...part), join(root, ...part), { recursive: true });
  }
  return root;
};

test('runtimeFingerprint names the runtime sources: an edit changes it, the rest of the plugin does not', (t) => {
  const root = pluginCopy(t);
  const before = runtimeFingerprint(root);
  assert.match(before, /^[0-9a-f]{16}$/);
  assert.equal(runtimeFingerprint(root), before);
  writeFileSync(join(root, 'README.md'), 'Not part of the runtime.\n');
  assert.equal(runtimeFingerprint(root), before);
  fs.appendFileSync(join(root, 'src', 'core', 'format.mjs'), '\n// edited\n');
  assert.notEqual(runtimeFingerprint(root), before);
});

test('runtimeFingerprint tells a renamed file from the same content under its old name', (t) => {
  const root = pluginCopy(t);
  const before = runtimeFingerprint(root);
  fs.renameSync(join(root, 'src', 'core', 'format.mjs'), join(root, 'src', 'core', 'format2.mjs'));
  assert.notEqual(runtimeFingerprint(root), before);
});

test('syncRuntime copies a self-contained runtime that renders the status line', (t) => {
  const data = tempDir(t);
  assert.deepEqual(syncRuntime({ pluginRoot: ROOT, dataDir: data }), { copied: true });
  assert.equal(readFileSync(join(data, 'runtime', 'FINGERPRINT'), 'utf8'), runtimeFingerprint(ROOT));
  const result = spawnSync(process.execPath, [runtimeMainPath(data)], {
    input: FULL, encoding: 'utf8', env: { ...process.env, NO_COLOR: '1' },
  });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout.trimEnd().split('\n').length, 5);
});

test('syncRuntime skips an up-to-date runtime and replaces an outdated one', (t) => {
  const data = tempDir(t);
  syncRuntime({ pluginRoot: ROOT, dataDir: data, fingerprint: 'aaaa' });
  const stale = join(data, 'runtime', 'src', 'terminal', 'stale.mjs');
  writeFileSync(stale, '');
  assert.deepEqual(syncRuntime({ pluginRoot: ROOT, dataDir: data, fingerprint: 'aaaa' }), { copied: false });
  assert.equal(existsSync(stale), true);
  assert.deepEqual(syncRuntime({ pluginRoot: ROOT, dataDir: data, fingerprint: 'bbbb' }), { copied: true });
  assert.equal(existsSync(stale), false);
  assert.deepEqual(fs.readdirSync(data).sort(), ['runtime']);
});

test('a runtime copied by an older release, which wrote VERSION, is replaced once', (t) => {
  const data = tempDir(t);
  fs.mkdirSync(join(data, 'runtime'));
  writeFileSync(join(data, 'runtime', 'VERSION'), '1.0.2');
  assert.deepEqual(syncRuntime({ pluginRoot: ROOT, dataDir: data }), { copied: true });
  assert.equal(existsSync(join(data, 'runtime', 'VERSION')), false);
  assert.deepEqual(syncRuntime({ pluginRoot: ROOT, dataDir: data }), { copied: false });
});

test('syncRuntime retries a rename that Windows refuses for a moment', (t) => {
  const data = tempDir(t);
  let refusals = 2;
  const rename = (from, to) => {
    if (refusals > 0) { refusals -= 1; throw busy('EPERM'); }
    fs.renameSync(from, to);
  };
  assert.deepEqual(syncRuntime({ pluginRoot: ROOT, dataDir: data, fingerprint: 'cccc', rename }), { copied: true });
  assert.equal(readFileSync(join(data, 'runtime', 'FINGERPRINT'), 'utf8'), 'cccc');
});

test('syncRuntime puts the old runtime back when the new one cannot be moved in', (t) => {
  const data = tempDir(t);
  syncRuntime({ pluginRoot: ROOT, dataDir: data, fingerprint: 'aaaa' });
  const rename = (from, to) => {
    if (from.includes('staging')) throw busy('EBUSY');
    fs.renameSync(from, to);
  };
  assert.throws(() => syncRuntime({ pluginRoot: ROOT, dataDir: data, fingerprint: 'bbbb', rename }), /EBUSY/);
  assert.equal(readFileSync(join(data, 'runtime', 'FINGERPRINT'), 'utf8'), 'aaaa');
  assert.deepEqual(fs.readdirSync(data).sort(), ['runtime']);
});

test('syncFromHook does nothing until setup has run, then repairs a missing runtime', (t) => {
  const data = tempDir(t);
  assert.equal(syncFromHook({ pluginRoot: ROOT, dataDir: data }), null);
  assert.equal(existsSync(join(data, 'runtime')), false);
  writeFileSync(join(data, SETUP_MARKER), '{}');
  assert.deepEqual(syncFromHook({ pluginRoot: ROOT, dataDir: data }), { copied: true });
  assert.ok(existsSync(runtimeMainPath(data)));
});

test('syncFromHook does nothing without the plugin folder or the data folder, and writes nothing', (t) => {
  const data = tempDir(t);
  writeFileSync(join(data, SETUP_MARKER), '{}');
  for (const folders of [{}, { pluginRoot: ROOT }, { dataDir: data }, { pluginRoot: '', dataDir: data }, { pluginRoot: ROOT, dataDir: '' }]) {
    assert.equal(syncFromHook(folders), null, JSON.stringify(folders));
  }
  assert.equal(existsSync(join(data, 'runtime')), false);
});

// The hook hands on the two variables Claude Code sets for it, never the whole environment.
test('the SessionStart script reads only CLAUDE_PLUGIN_ROOT and CLAUDE_PLUGIN_DATA', () => {
  const script = readFileSync(join(ROOT, 'scripts', 'sync-runtime.mjs'), 'utf8');
  assert.deepEqual([...script.matchAll(/process\.env(\.\w+)?/g)].map((match) => match[0]).sort(),
    ['process.env.CLAUDE_PLUGIN_DATA', 'process.env.CLAUDE_PLUGIN_ROOT']);
});
