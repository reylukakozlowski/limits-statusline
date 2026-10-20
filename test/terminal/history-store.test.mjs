import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, readdirSync, writeFileSync, utimesSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { recordContext } from '../../src/terminal/history-store.mjs';

const tempDir = (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'ls-hist-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
};

test('recordContext appends changes and survives between calls', (t) => {
  const dir = tempDir(t);
  assert.deepEqual(recordContext(dir, 'session-1', 10), [10]);
  assert.deepEqual(recordContext(dir, 'session-1', 12), [10, 12]);
  assert.deepEqual(recordContext(dir, 'session-2', 50), [50]);
});

test('history skips a repeated value and a non-finite one', (t) => {
  const dir = tempDir(t);
  recordContext(dir, 's', 10);
  assert.deepEqual(recordContext(dir, 's', 10), [10]);
  assert.deepEqual(recordContext(dir, 's', null), [10]);
});

test('history caps at maxPoints, keeping the newest', (t) => {
  const dir = tempDir(t);
  for (let percent = 1; percent <= 5; percent += 1) recordContext(dir, 's', percent, { maxPoints: 3 });
  assert.deepEqual(recordContext(dir, 's', 6, { maxPoints: 3 }), [4, 5, 6]);
});

test('history rejects unsafe session id', (t) => {
  const dir = tempDir(t);
  for (const id of ['../../x', 'a/b', '', 'x'.repeat(129), undefined]) {
    assert.deepEqual(recordContext(dir, id, 10), [], String(id));
  }
  assert.deepEqual(readdirSync(dir), []);
});

test('history survives a corrupt file and an unwritable folder', (t) => {
  const dir = tempDir(t);
  writeFileSync(join(dir, 's.json'), 'not json');
  assert.deepEqual(recordContext(dir, 's', 7), [7]);
  writeFileSync(join(dir, 'blocker'), '');
  assert.deepEqual(recordContext(join(dir, 'blocker'), 's', 7), []);
});

test('a new session prunes history files older than seven days', (t) => {
  const dir = tempDir(t);
  const old = join(dir, 'old.json');
  writeFileSync(old, '[1]');
  const eightDaysAgo = (Date.now() - 8 * 86_400_000) / 1000;
  utimesSync(old, eightDaysAgo, eightDaysAgo);
  recordContext(dir, 'fresh', 5);
  assert.equal(existsSync(old), false);
  assert.equal(existsSync(join(dir, 'fresh.json')), true);
});
