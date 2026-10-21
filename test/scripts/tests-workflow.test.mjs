// Contract of .github/workflows/tests.yml: `npm test` on macOS, Linux and Windows for each pull
// request into develop once it is ready for review, before the owner merges it. Read as text, like
// the Release workflow's contract (the repository has no YAML parser).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

// CRLF from a clone with core.autocrlf would otherwise defeat every line pattern below.
const read = (path) => readFileSync(new URL(path, import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const WORKFLOW = read('../../.github/workflows/tests.yml');
const RELEASE = read('../../.github/workflows/release.yml');
const section = (name, next) => WORKFLOW.slice(WORKFLOW.indexOf(`\n${name}:\n`), WORKFLOW.indexOf(`\n${next}:`));

test('the workflow is called Tests and runs only for pull requests into develop', () => {
  assert.match(WORKFLOW, /^name: Tests$/m);
  const triggers = section('on', 'permissions');
  assert.deepEqual(triggers.match(/^ {2}[\w-]+:/gm), ['  pull_request:']);
  assert.match(triggers, /^ {4}branches: \[develop\]$/m);
  assert.match(triggers, /^ {4}types: \[opened, synchronize, reopened, ready_for_review\]$/m);
});

test('a push or a pull request from a fork with write access never starts it: no push, no pull_request_target', () => {
  assert.doesNotMatch(WORKFLOW, /^\s+(push|pull_request_target|workflow_run|schedule):/m);
});

test('a draft runs no job; marking it ready, and every push after that, runs the tests', () => {
  assert.match(WORKFLOW, /^ {4}if: github\.event\.pull_request\.draft == false$/m);
});

test('the tests run on macOS, Linux and Windows, and one failing system never cancels the others', () => {
  assert.match(WORKFLOW, /^ {8}os: \[ubuntu-latest, macos-latest, windows-latest\]$/m);
  assert.match(WORKFLOW, /^ {6}fail-fast: false$/m);
  assert.match(WORKFLOW, /^ {4}runs-on: \$\{\{ matrix\.os \}\}$/m);
  assert.match(WORKFLOW, /^ {4}name: npm test on \$\{\{ matrix\.os \}\}$/m);
});

test('each system runs the project\'s own npm test on the Node.js the Release workflow uses, with nothing installed', () => {
  const nodeVersion = (text) => /^ {10}node-version: (\d+)$/m.exec(text)?.[1];
  assert.ok(nodeVersion(WORKFLOW));
  assert.equal(nodeVersion(WORKFLOW), nodeVersion(RELEASE));
  assert.match(WORKFLOW, /^ {8}run: npm test$/m);
  assert.doesNotMatch(WORKFLOW, /npm (ci|install)/);
});

test('the token can only read, the checkout keeps no credentials, and a newer push cancels the older run', () => {
  assert.match(WORKFLOW, /^permissions:\n {2}contents: read\n\n/m);
  assert.doesNotMatch(WORKFLOW, /secrets\.|:\s*write\b/);
  assert.match(WORKFLOW, /^ {10}persist-credentials: false$/m);
  assert.match(WORKFLOW, /^concurrency:\n {2}group: tests-\$\{\{ github\.event\.pull_request\.number \}\}\n {2}cancel-in-progress: true$/m);
  assert.match(WORKFLOW, /^ {4}timeout-minutes: \d+$/m);
});

test('every action is pinned to the same full commit SHA as in the Release workflow', () => {
  const uses = (text) => text.match(/^ +(?:- )?uses: .+$/gm).map((line) => line.replace(/^ +(?:- )?/, ''));
  const pinned = uses(WORKFLOW);
  assert.equal(pinned.length, 2);
  for (const line of pinned) {
    assert.match(line, /^uses: [\w.-]+\/[\w.-]+@[0-9a-f]{40} # v\d+\.\d+\.\d+$/, line);
    assert.ok(uses(RELEASE).includes(line), `${line} differs from release.yml`);
  }
});

test('expressions sit only in YAML values, never inside a shell script', () => {
  for (const line of WORKFLOW.split('\n').filter((text) => text.includes('${{'))) {
    assert.match(line, /^\s*(?!run:)[\w-]+: .*\$\{\{ .+ \}\}.*$/, line);
  }
});
