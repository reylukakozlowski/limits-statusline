import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Readable, PassThrough } from 'node:stream';
import { readStdin, parseInput } from '../../src/terminal/stdin.mjs';

test('readStdin collects the whole stream as text', async () => {
  assert.equal(await readStdin(Readable.from(['{"a":', '1}'])), '{"a":1}');
});

test('readStdin gives up after the timeout with what arrived so far', async () => {
  const stream = new PassThrough();
  stream.write('partial');
  assert.equal(await readStdin(stream, { timeoutMs: 20 }), 'partial');
});

test('parseInput accepts a JSON object, BOM included', () => {
  assert.deepEqual(parseInput('\uFEFF{"session_id":"x"}'), { session_id: 'x' });
});

test('parseInput rejects empty, broken and non-object input', () => {
  for (const text of ['', '{', 'null', '[1,2]', '42', '"text"', undefined]) {
    assert.equal(parseInput(text), null, String(text));
  }
});
