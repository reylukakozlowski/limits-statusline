// The contract (scripts/lib/status-line-contract.mjs) lists exactly the stdin fields the terminal
// status line reads, so the Compatibility workflow watches every field the plugin depends on and
// none it dropped. The snapshot's readers run on a traced input that records every field they
// touch, present or not; run.mjs, which reads a few fields itself, is read as source.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { STATUS_LINE_CONTRACT } from '../../scripts/lib/status-line-contract.mjs';
import { limitsFromStatusInput, snapshotFromStatusInput, workingDirectory } from '../../src/terminal/snapshot.mjs';

const FULL = JSON.parse(readFileSync(new URL('../fixtures/status-input.full.json', import.meta.url), 'utf8'));
const RUN = readFileSync(new URL('../../src/terminal/run.mjs', import.meta.url), 'utf8');
const EXTRAS = { nowMs: Date.UTC(2027, 0, 10), git: null, contextHistory: [], timeZone: 'UTC' };
const CONTRACT = STATUS_LINE_CONTRACT.map((entry) => entry.path).sort();

const isObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);

/**
 * The fields `read(input)` touches: `input` is `source` behind a proxy that records each property
 * read, and an absent field reads as an empty object that records reads below it, so a reader
 * that goes on to `vim.mode` is seen even without `vim` in the input. The status line's readers
 * (recordOf, textOrNull, numberOrNull) take that empty object for {} or null, as they would an
 * absent field, so their fallbacks still run.
 */
function touchedFields(source, read) {
  const touched = new Set();
  const traced = (value, path) => new Proxy(value, {
    get(target, key, receiver) {
      const child = Reflect.get(target, key, receiver);
      // Symbols and what every object inherits (toString, constructor) are not fields.
      if (typeof key !== 'string' || key in Object.prototype) return child;
      const childPath = path ? `${path}.${key}` : key;
      touched.add(childPath);
      if (child === undefined) return traced({}, childPath);
      return isObject(child) ? traced(child, childPath) : child;
    },
  });
  read(traced(structuredClone(source), ''));
  const paths = [...touched];
  return paths.filter((path) => !paths.some((other) => other.startsWith(`${path}.`))).sort();
}

/**
 * Both inputs are needed: the empty one runs every fallback (`model.id` behind
 * `model.display_name`), the full one every read that waits for a value to be there.
 */
const snapshotFields = () => {
  const read = (input) => {
    snapshotFromStatusInput(input, EXTRAS);
    limitsFromStatusInput(input);
    workingDirectory(input);
  };
  return [...new Set([...touchedFields({}, read), ...touchedFields(FULL, read)])].sort();
};

/** The `input.a?.b` chains of a source file, as dotted paths. */
const directReads = (source) => [...source.matchAll(/\binput((?:\??\.[A-Za-z_]\w*)+)/g)]
  .map((match) => match[1].replace(/\?\./g, '.').slice(1));

test('touchedFields sees present and absent fields, fallbacks included, and nothing left unread', () => {
  // Read the way src/core/values.mjs reads: anything but a string is null.
  const text = (value) => (typeof value === 'string' ? value : null);
  const read = (input) => [text(input.model.name) ?? text(input.model.id), text(input.vim.mode), input.size];
  assert.deepEqual(touchedFields({ model: { id: 'a', vendor: 'b' }, size: 1, colour: 'red' }, read),
    ['model.id', 'model.name', 'size', 'vim.mode']);
  // A fallback behind a present value is not reached: hence the empty input as well.
  assert.deepEqual(touchedFields({ model: { name: 'n', id: 'a' } }, read), ['model.name', 'size', 'vim.mode']);
});

test('directReads takes the fields a file reads straight off its input', () => {
  assert.deepEqual(directReads('f(input.session_id, input.context_window?.used_percentage); g(inputs.x);'),
    ['session_id', 'context_window.used_percentage']);
});

test('the contract lists exactly the fields the status line reads from its input', () => {
  const read = [...new Set([...snapshotFields(), ...directReads(RUN)])].sort();
  assert.deepEqual(CONTRACT, read);
});

// run.mjs is read as source: a field it took apart some other way (`const { pr } = input`) would
// escape directReads, but its snake_case name would not escape this net.
test('every snake_case name in run.mjs is part of a field the contract covers', () => {
  const segments = new Set(CONTRACT.flatMap((path) => path.split('.')));
  const code = RUN.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '').replace(/^import .*$/gm, '');
  const names = new Set(code.match(/\b[a-z][a-z0-9]*(?:_[a-z0-9]+)+\b/g) ?? []);
  assert.ok(names.has('session_id'), 'run.mjs reads session_id');
  assert.deepEqual([...names].filter((name) => !segments.has(name)), []);
});
