import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const SETUP = fileURLToPath(new URL('../../scripts/setup.mjs', import.meta.url));
const FOREIGN = { type: 'command', command: '~/.claude/statusline.sh' };
const OTHER = { type: 'command', command: 'starship statusline' };
const BOM = '\uFEFF';

// Every test runs against its own config folder, never the real ~/.claude.
const sandbox = (t, settingsText) => {
  const dir = mkdtempSync(join(tmpdir(), 'ls-setup-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const settings = join(dir, 'settings.json');
  if (settingsText !== undefined) writeFileSync(settings, settingsText);
  return { dir, settings, data: join(dir, 'data'), state: join(dir, 'limits-statusline') };
};

const setup = (box, args, env = {}) => spawnSync(process.execPath, [SETUP, ...args], {
  encoding: 'utf8',
  env: { ...process.env, CLAUDE_CONFIG_DIR: box.dir, HOME: box.dir, USERPROFILE: box.dir, ...env },
});
const install = (box, ...more) => setup(box, ['--data', box.data, '--settings', box.settings, ...more]);

const readJson = (path) => JSON.parse(readFileSync(path, 'utf8'));
const writeJson = (path, value) => writeFileSync(path, JSON.stringify(value));

test('setup enables the status line, keeps other settings and backs up the file', (t) => {
  const box = sandbox(t, '{\n  "theme": "dark"\n}\n');
  const result = install(box);
  assert.equal(result.status, 0, result.stderr);
  const settings = readJson(box.settings);
  assert.equal(settings.theme, 'dark');
  assert.match(settings.statusLine.command, /^node ".+\/runtime\/src\/terminal\/main\.mjs" --data ".+\/data"$/);
  assert.ok(!settings.statusLine.command.includes('\\'));
  assert.equal(readFileSync(join(box.state, 'settings.backup.json'), 'utf8'), '{\n  "theme": "dark"\n}\n');
  assert.match(readFileSync(join(box.data, 'runtime', 'FINGERPRINT'), 'utf8'), /^[0-9a-f]{16}$/);
  assert.deepEqual(readJson(join(box.data, 'setup.json')), { settingsPath: box.settings });
  assert.match(result.stdout, /enabled/i);
  assert.match(result.stdout, /--uninstall/);
});

test('setup creates settings.json when there is none', (t) => {
  const box = sandbox(t);
  assert.equal(install(box).status, 0);
  assert.equal(readJson(box.settings).statusLine.type, 'command');
});

test('setup reads a settings.json that starts with a byte-order mark and writes it back without one', (t) => {
  const box = sandbox(t, `${BOM}{"theme":"dark"}`);
  assert.equal(install(box).status, 0);
  const written = readFileSync(box.settings, 'utf8');
  assert.ok(!written.startsWith(BOM));
  assert.equal(JSON.parse(written).theme, 'dark');
});

test('setup refuses an invalid settings.json and leaves it byte-identical', (t) => {
  const box = sandbox(t, '{ "theme": "dark", }');
  const result = install(box);
  assert.equal(result.status, 2);
  assert.match(result.stderr, /not valid JSON/);
  assert.equal(readFileSync(box.settings, 'utf8'), '{ "theme": "dark", }');
  assert.equal(existsSync(join(box.data, 'runtime')), false);
});

test('setup refuses a settings file whose root is not an object', (t) => {
  assert.equal(install(sandbox(t, '[]')).status, 2);
});

test('setup --dry-run reports without writing anything', (t) => {
  const box = sandbox(t, '{}');
  const result = install(box, '--dry-run');
  assert.equal(result.status, 0);
  assert.match(result.stdout, /dry run/i);
  assert.equal(readFileSync(box.settings, 'utf8'), '{}');
  assert.equal(existsSync(box.data), false);
  assert.equal(existsSync(box.state), false);
});

test('setup rejects an unknown option as a usage error', (t) => {
  const box = sandbox(t, '{}');
  const result = install(box, '--bogus');
  assert.equal(result.status, 1);
  assert.match(result.stderr, /Usage/);
});

test('setup --uninstall restores the status line that was there before', (t) => {
  const box = sandbox(t, JSON.stringify({ statusLine: FOREIGN }));
  assert.equal(install(box).status, 0);
  assert.equal(readJson(join(box.state, 'previous-statusline.json')).command, FOREIGN.command);
  const result = install(box, '--uninstall');
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(readJson(box.settings).statusLine, FOREIGN);
  assert.equal(existsSync(join(box.state, 'previous-statusline.json')), false);
});

test('a status line set by hand between two setups is the one --uninstall brings back', (t) => {
  const box = sandbox(t, JSON.stringify({ statusLine: FOREIGN }));
  assert.equal(install(box).status, 0);
  writeJson(box.settings, { statusLine: OTHER });
  assert.equal(install(box).status, 0);
  assert.equal(install(box, '--uninstall').status, 0);
  assert.deepEqual(readJson(box.settings).statusLine, OTHER);
});

test('the saved status line survives the plugin removing its data folder', (t) => {
  const box = sandbox(t, JSON.stringify({ statusLine: FOREIGN }));
  assert.equal(install(box).status, 0);
  rmSync(box.data, { recursive: true, force: true }); // what /plugin uninstall does to ${CLAUDE_PLUGIN_DATA}
  assert.equal(install(box, '--uninstall').status, 0);
  assert.deepEqual(readJson(box.settings).statusLine, FOREIGN);
});

test('setup run again after the runtime went missing rebuilds it and says so', (t) => {
  const box = sandbox(t, '{}');
  assert.equal(install(box).status, 0);
  const settingsText = readFileSync(box.settings, 'utf8');
  rmSync(join(box.data, 'runtime'), { recursive: true, force: true });
  const result = install(box);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /already enabled; its runtime was rebuilt in .+runtime/);
  assert.doesNotMatch(result.stdout, /nothing changed/i);
  assert.ok(existsSync(join(box.data, 'runtime', 'src', 'terminal', 'main.mjs')));
  assert.equal(readFileSync(box.settings, 'utf8'), settingsText);
});

test('setup run again with a current runtime reports that nothing changed', (t) => {
  const box = sandbox(t, '{}');
  assert.equal(install(box).status, 0);
  const result = install(box);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /already enabled; nothing changed/);
  assert.doesNotMatch(result.stdout, /rebuilt/i);
});

test('setup refuses an invalid settings.json without rebuilding a missing runtime', (t) => {
  const box = sandbox(t, '{}');
  assert.equal(install(box).status, 0);
  rmSync(join(box.data, 'runtime'), { recursive: true, force: true });
  writeFileSync(box.settings, '{ "statusLine": ');
  const result = install(box);
  assert.equal(result.status, 2);
  assert.match(result.stderr, /not valid JSON/);
  assert.equal(result.stdout, '');
  assert.equal(readFileSync(box.settings, 'utf8'), '{ "statusLine": ');
  assert.equal(existsSync(join(box.data, 'runtime')), false);
});

test('setup --uninstall leaves a foreign status line alone', (t) => {
  const box = sandbox(t, JSON.stringify({ statusLine: FOREIGN }));
  const result = install(box, '--uninstall');
  assert.equal(result.status, 0);
  assert.match(result.stdout, /nothing changed/i);
  assert.deepEqual(readJson(box.settings).statusLine, FOREIGN);
});

test('without --settings and with an empty --data, setup uses CLAUDE_CONFIG_DIR', (t) => {
  const box = sandbox(t, '{}');
  const result = setup(box, ['--data', '']);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(readJson(box.settings).statusLine.type, 'command');
  assert.ok(existsSync(join(box.dir, 'plugins', 'data', 'limits-statusline-sealoop', 'runtime', 'FINGERPRINT')));
});

test('an unsubstituted ${CLAUDE_PLUGIN_DATA} also falls back to the default data folder', (t) => {
  const box = sandbox(t, '{}');
  assert.equal(setup(box, ['--data', '${CLAUDE_PLUGIN_DATA}']).status, 0);
  assert.ok(existsSync(join(box.dir, 'plugins', 'data', 'limits-statusline-sealoop', 'setup.json')));
});

test('a symlinked settings.json is updated through the link', (t) => {
  const box = sandbox(t);
  const real = join(box.dir, 'dotfiles', 'settings.json');
  mkdirSync(join(box.dir, 'dotfiles'));
  writeFileSync(real, '{"theme":"dark"}');
  try {
    symlinkSync(real, box.settings, 'file');
  } catch {
    t.skip('creating symbolic links needs Developer Mode or admin rights on Windows');
    return;
  }
  assert.equal(install(box).status, 0);
  assert.equal(readJson(real).statusLine.type, 'command');
});
