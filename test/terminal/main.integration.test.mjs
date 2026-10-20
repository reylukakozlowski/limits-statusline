import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, readdirSync, utimesSync, writeFileSync } from 'node:fs';
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

const tempDir = (t, prefix) => {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
};

test('main keeps context history under --data <dir>/history', (t) => {
  const dir = tempDir(t, 'ls-main-');
  const configDir = tempDir(t, 'ls-config-');
  assert.equal(runMain(FULL, ['--data', dir], { CLAUDE_CONFIG_DIR: configDir }).status, 0);
  assert.deepEqual(readdirSync(join(dir, 'history')), ['3f2c9a1e-77b0-4c1d-9f5e-0a1b2c3d4e5f.json']);
});

test('main records the plan limits in the shared history under CLAUDE_CONFIG_DIR', (t) => {
  const configDir = tempDir(t, 'ls-config-');
  assert.equal(runMain(FULL, ['--data', tempDir(t, 'ls-main-')], { CLAUDE_CONFIG_DIR: configDir }).status, 0);
  const history = JSON.parse(readFileSync(join(configDir, 'limits-statusline', 'limit-history.json'), 'utf8'));
  assert.deepEqual(history.readings.fiveHour.map(([, percent, resetsAt]) => [percent, resetsAt]), [[12, 1_800_015_000_000]]);
  assert.deepEqual(history.readings.sevenDay.map(([, percent]) => percent), [39]);
  assert.deepEqual(Object.keys(history.sessions), ['3f2c9a1e-77b0-4c1d-9f5e-0a1b2c3d4e5f']);
});

test('run keeps the shared history in .claude under the home folder when CLAUDE_CONFIG_DIR is unset', async (t) => {
  const home = tempDir(t, 'ls-home-');
  const argv = ['--data', tempDir(t, 'ls-main-')];
  await run({ stdin: Readable.from([FULL]), stdout: sink().stream, env: { NO_COLOR: '1' }, argv, nowMs: 1_800_000_000_000, home });
  const history = JSON.parse(readFileSync(join(home, '.claude', 'limits-statusline', 'limit-history.json'), 'utf8'));
  assert.deepEqual(history.readings.sevenDay.map(([, percent]) => percent), [39]);
});

test('run without any config folder still draws the limits, from the session alone', async (t) => {
  const out = sink();
  const argv = ['--data', tempDir(t, 'ls-main-')];
  await run({ stdin: Readable.from([FULL]), stdout: out.stream, env: { NO_COLOR: '1', COLUMNS: '120' }, argv, nowMs: 1_800_000_000_000, home: '', timeZone: 'UTC' });
  assert.equal(out.read().split('\n')[4], '5h  ■■□□□□□□□□□□□□□□ 12% →  72%  ↻ 4h10m 12:10      ↗ 14.4%/h');
});

test('main without --data writes no history at all', (t) => {
  const configDir = tempDir(t, 'ls-config-');
  assert.equal(runMain(FULL, [], { CLAUDE_CONFIG_DIR: configDir }).status, 0);
  assert.deepEqual(readdirSync(configDir), []);
});

test('run draws from the shared history: another session\'s newer figure and the recent pace', async (t) => {
  const configDir = tempDir(t, 'ls-config-');
  const nowMs = 1_800_000_000_000;
  const input = JSON.parse(FULL);
  // The idle session's last response came 40 minutes ago; its transcript says so.
  const idleTranscript = join(configDir, 'idle.jsonl');
  writeFileSync(idleTranscript, '{}\n');
  utimesSync(idleTranscript, (nowMs - 2_400_000) / 1000, (nowMs - 2_400_000) / 1000);
  const runAt = async (sessionId, fivePercent, atMs, transcriptPath = input.transcript_path) => {
    const out = sink();
    const stdin = Readable.from([JSON.stringify({
      ...input, session_id: sessionId, transcript_path: transcriptPath,
      rate_limits: { ...input.rate_limits, five_hour: { used_percentage: fivePercent, resets_at: 1_800_015_000 } },
    })]);
    await run({ stdin, stdout: out.stream, env: { NO_COLOR: '1', COLUMNS: '120', CLAUDE_CONFIG_DIR: configDir }, argv: ['--data', tempDir(t, 'ls-main-')], nowMs: atMs });
    return out.read().split('\n')[4];
  };
  await runAt('busy', 2, nowMs - 1_800_000);
  await runAt('busy', 20, nowMs);
  // The idle session, seen for the first time, still reports 2%; the line shows the 20% the busy
  // session saw since, and 18 points in the last half hour: 36%/h.
  assert.match(await runAt('idle', 2, nowMs, idleTranscript), /^5h {2}\S+ 20% → .* ↗ 36\.0%\/h/);
  const history = JSON.parse(readFileSync(join(configDir, 'limits-statusline', 'limit-history.json'), 'utf8'));
  assert.deepEqual(history.readings.fiveHour.map(([atMs, percent]) => [atMs - nowMs, percent]), [[-1_800_000, 2], [0, 20], [-2_400_000, 2]]);
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
