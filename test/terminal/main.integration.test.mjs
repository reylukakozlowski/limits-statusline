import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Readable, Writable } from 'node:stream';
import { run } from '../../src/terminal/run.mjs';

const MAIN = fileURLToPath(new URL('../../src/terminal/main.mjs', import.meta.url));
const FULL = readFileSync(new URL('../fixtures/status-input.full.json', import.meta.url), 'utf8');
const ESC = '\u001b';

const runMain = (input, args = [], env = {}) => spawnSync(process.execPath, [MAIN, ...args], {
  input, encoding: 'utf8', env: { ...process.env, NO_COLOR: '1', COLUMNS: '120', ...env },
});

const sink = () => {
  let text = '';
  const stream = new Writable({ write(chunk, _encoding, done) { text += chunk; done(); } });
  return { stream, read: () => text };
};

test('main prints five lines for real stdin, quickly', () => {
  const started = Date.now();
  const result = runMain(FULL);
  const elapsed = Date.now() - started;
  assert.equal(result.status, 0, result.stderr);
  const lines = result.stdout.trimEnd().split('\n');
  assert.equal(lines.length, 5);
  assert.ok(lines[0].startsWith('daily-claude | no git | ✦ Opus 5.5'), lines[0]);
  assert.ok(elapsed < 1000, `took ${elapsed} ms`);
});

test('main survives garbage on stdin with a fallback line and exit 0', () => {
  const result = runMain('this is not json');
  assert.equal(result.status, 0);
  assert.equal(result.stdout.trim(), 'limits-statusline: no data');
  assert.equal(result.stderr, '');
});

test('main keeps context history under --data <dir>/history', (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'ls-main-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  assert.equal(runMain(FULL, ['--data', dir]).status, 0);
  assert.deepEqual(readdirSync(join(dir, 'history')), ['3f2c9a1e-77b0-4c1d-9f5e-0a1b2c3d4e5f.json']);
});

test('run colours unless NO_COLOR is set, and returns 0', async () => {
  const coloured = sink();
  const code = await run({ stdin: Readable.from([FULL]), stdout: coloured.stream, env: {}, argv: [], nowMs: 1_800_000_000_000 });
  assert.equal(code, 0);
  assert.ok(coloured.read().includes(`${ESC}[`));
  const plain = sink();
  await run({ stdin: Readable.from([FULL]), stdout: plain.stream, env: { NO_COLOR: '1', COLUMNS: '120' }, argv: [], nowMs: 1_800_000_000_000 });
  assert.ok(plain.read().startsWith('daily-claude | no git | ✦ Opus 5.5\n'), plain.read());
  assert.ok(!plain.read().includes(ESC));
});

test('run prints the fallback when something inside throws', async () => {
  const out = sink();
  const code = await run({ stdin: Readable.from([FULL]), stdout: out.stream, env: { NO_COLOR: '1' }, argv: [], nowMs: 0, spawn: () => { throw new Error('boom'); } });
  assert.equal(code, 0);
  assert.equal(out.read(), 'limits-statusline: no data\n');
});
