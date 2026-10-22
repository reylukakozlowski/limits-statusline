// The plugin's code reads environment variables by name, each one it uses, and never takes or hands
// on the whole environment: what it reads is then visible at the line that reads it.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const SHIPPED_CODE = /^(src|scripts|hooks)\/.+\.(mjs|js|ts)$/;

const shippedCode = () => spawnSync('git', ['ls-files'], { cwd: ROOT, encoding: 'utf8' }).stdout
  .split('\n').filter((file) => SHIPPED_CODE.test(file));

/** Each `process.env` in the source that is not followed by `.NAME`: the whole environment. */
const wholeEnvironmentReads = (source) => [...source.matchAll(/process\.env(?![.\w])/g)].length;

test('wholeEnvironmentReads tells a variable read by name from the whole environment', () => {
  assert.equal(wholeEnvironmentReads('const x = process.env.NO_COLOR;'), 0);
  assert.equal(wholeEnvironmentReads('run({ env: process.env })'), 1);
  assert.equal(wholeEnvironmentReads('const { HOME } = process.env;'), 1);
  assert.equal(wholeEnvironmentReads('spawn(cmd, { env: { ...process.env, A: 1 } })'), 1);
  assert.equal(wholeEnvironmentReads('process.envelope'), 0);
});

test('the plugin\'s code reads environment variables only by name', () => {
  const files = shippedCode();
  assert.ok(files.length > 10, 'the shipped code is listed');
  const offenders = files.filter((file) => wholeEnvironmentReads(readFileSync(join(ROOT, file), 'utf8')) > 0);
  assert.deepEqual(offenders, []);
});
