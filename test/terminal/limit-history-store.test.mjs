import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { writeAtomic } from '../../src/terminal/atomic-file.mjs';
import { recordLimitHistory, transcriptWrittenAtMs } from '../../src/terminal/limit-history-store.mjs';

const NOW = 1_800_000_000_000;
const RESET = NOW + 15_000_000;
const limits = (percentUsed) => ({ fiveHour: { percentUsed, resetsAtMs: RESET }, sevenDay: null });

const tempDir = (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'ls-limits-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
};

test('recordLimitHistory creates the folder and file and returns the readings to draw from', (t) => {
  const file = join(tempDir(t), 'limits-statusline', 'limit-history.json');
  const { readings, seenAtMs } = recordLimitHistory(file, { sessionId: 'a', limits: limits(12), nowMs: NOW });
  assert.deepEqual(readings, { fiveHour: [[NOW, 12, RESET]], sevenDay: [] });
  assert.deepEqual(seenAtMs, { fiveHour: NOW, sevenDay: null });
  assert.deepEqual(JSON.parse(readFileSync(file, 'utf8')).readings.fiveHour, [[NOW, 12, RESET]]);
});

test('a second session adds to the same file; a repeat leaves the file untouched', (t) => {
  const file = join(tempDir(t), 'limit-history.json');
  recordLimitHistory(file, { sessionId: 'a', limits: limits(12), nowMs: NOW });
  const { readings } = recordLimitHistory(file, { sessionId: 'b', limits: limits(14), nowMs: NOW + 120_000 });
  assert.deepEqual(readings.fiveHour.map(([, percent]) => percent), [12, 14]);
  const before = statSync(file).mtimeMs;
  const content = readFileSync(file, 'utf8');
  recordLimitHistory(file, { sessionId: 'b', limits: limits(14), nowMs: NOW + 240_000 });
  assert.equal(readFileSync(file, 'utf8'), content);
  assert.equal(statSync(file).mtimeMs, before);
  assert.deepEqual(readdirSync(join(file, '..')), ['limit-history.json']); // no temporary file left behind
});

/** A file with `text`, last written `agoMs` before NOW. */
function fileWritten(t, text, agoMs) {
  const file = join(tempDir(t), 'limit-history.json');
  writeFileSync(file, text);
  utimesSync(file, new Date(NOW - agoMs), new Date(NOW - agoMs));
  return file;
}

// A file read while another session writes it is half a file. Replacing it with this session's
// reading alone would lose every other session's readings.
test('a file that cannot be read and was written within the last minute is left as it is', (t) => {
  for (const text of ['{ half a fi', '', JSON.stringify({ version: 2, readings: {}, sessions: {} })]) {
    const file = fileWritten(t, text, 59_000);
    const { readings } = recordLimitHistory(file, { sessionId: 'a', limits: limits(12), nowMs: NOW });
    assert.deepEqual(readings.fiveHour, [[NOW, 12, RESET]], 'this run still draws its own reading');
    assert.equal(readFileSync(file, 'utf8'), text);
    assert.deepEqual(readdirSync(join(file, '..')), ['limit-history.json']);
  }
});

test('a file that has stayed unreadable for a minute is broken, and is replaced', (t) => {
  const file = fileWritten(t, '{ half a fi', 60_000);
  recordLimitHistory(file, { sessionId: 'a', limits: limits(12), nowMs: NOW });
  assert.deepEqual(JSON.parse(readFileSync(file, 'utf8')).readings.fiveHour, [[NOW, 12, RESET]]);
});

test('an unwritable place still returns this run\'s readings and never throws', (t) => {
  const blocker = join(tempDir(t), 'not-a-folder');
  writeFileSync(blocker, 'a file where the folder should be');
  const { readings } = recordLimitHistory(join(blocker, 'limit-history.json'), { sessionId: 'a', limits: limits(12), nowMs: NOW });
  assert.deepEqual(readings.fiveHour, [[NOW, 12, RESET]]);
});

test('an atomic write whose rename fails throws and leaves no temporary file behind', (t) => {
  const dir = tempDir(t);
  const file = join(dir, 'limit-history.json');
  mkdirSync(file); // a folder where the file should be: the rename onto it fails
  assert.throws(() => writeAtomic(file, '{}'));
  assert.deepEqual(readdirSync(dir), ['limit-history.json']);
  writeAtomic(join(dir, 'other.json'), '{"a":1}');
  assert.deepEqual(readdirSync(dir).sort(), ['limit-history.json', 'other.json']);
  assert.equal(readFileSync(join(dir, 'other.json'), 'utf8'), '{"a":1}');
});

// A folder where the file should be cannot be read as a file and is nothing to write over.
test('a path that cannot be read as a file is left alone like any unreadable file', (t) => {
  const dir = tempDir(t);
  const file = join(dir, 'limit-history.json');
  mkdirSync(file);
  const { readings } = recordLimitHistory(file, { sessionId: 'a', limits: limits(12), nowMs: NOW });
  assert.deepEqual(readings.fiveHour, [[NOW, 12, RESET]]);
  assert.deepEqual(readdirSync(dir), ['limit-history.json']);
});

test('transcriptWrittenAtMs is the transcript\'s modification time, or null without one', (t) => {
  const transcript = join(tempDir(t), 'session.jsonl');
  writeFileSync(transcript, '{}\n');
  utimesSync(transcript, (NOW - 60_000) / 1000, (NOW - 60_000) / 1000);
  assert.equal(transcriptWrittenAtMs(transcript), NOW - 60_000);
  assert.equal(transcriptWrittenAtMs(join(tempDir(t), 'missing.jsonl')), null);
  assert.equal(transcriptWrittenAtMs(''), null);
  assert.equal(transcriptWrittenAtMs(42), null);
});

test('without a session id or a usable reading nothing is written', (t) => {
  const dir = tempDir(t);
  const file = join(dir, 'limit-history.json');
  assert.deepEqual(recordLimitHistory(file, { sessionId: undefined, limits: limits(12), nowMs: NOW }).readings, { fiveHour: [], sevenDay: [] });
  assert.deepEqual(recordLimitHistory(file, { sessionId: 'a', limits: { fiveHour: null, sevenDay: null }, nowMs: NOW }).readings, { fiveHour: [], sevenDay: [] });
  assert.deepEqual(readdirSync(dir), []);
});
