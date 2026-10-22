// Contract of .github/workflows/prepare-release.yml: the owner picks patch, minor or major on
// develop, and one job raises plugin.json on a branch of its own and opens a draft pull request,
// with no more rights than that. Read as text, like the Release workflow's contract.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

// CRLF from a clone with core.autocrlf would otherwise defeat every line pattern below.
const read = (path) => readFileSync(new URL(path, import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const WORKFLOW = read('../../.github/workflows/prepare-release.yml');
const RELEASE = read('../../.github/workflows/release.yml');
const JOBS = WORKFLOW.slice(WORKFLOW.indexOf('\njobs:\n'));
const RUN_STEP = 'Raise the version and open the pull request';

test('the workflow starts only by hand, its one input the part to raise: patch, minor or major', () => {
  assert.match(WORKFLOW, /^name: Prepare release$/m);
  const triggers = WORKFLOW.slice(WORKFLOW.indexOf('\non:\n'), WORKFLOW.indexOf('\npermissions:'));
  assert.deepEqual(triggers.match(/^ {2}[\w-]+:/gm), ['  workflow_dispatch:']);
  assert.deepEqual(triggers.match(/^ {6}[\w-]+:$/gm), ['      bump:']);
  assert.match(triggers, /^ {8}type: choice$/m);
  assert.match(triggers, /^ {8}options: \[patch, minor, major\]$/m);
  assert.match(triggers, /^ {8}default: patch$/m);
});

test('one job, run only by the owner on develop, with the rights to push a branch and open a pull request', () => {
  assert.deepEqual(JOBS.match(/^ {2}[\w-]+(?=:$)/gm).map((name) => name.trim()), ['prepare']);
  assert.match(WORKFLOW, /^permissions: \{\}$/m);
  const guard = /^ {4}if: >-\n((?: {6}.+\n)+)/m.exec(JOBS)[1].replace(/\s+/g, ' ').trim();
  for (const condition of [
    "github.event_name == 'workflow_dispatch'", "github.ref == 'refs/heads/develop'",
    'github.actor_id == github.repository_owner_id', 'github.triggering_actor == github.repository_owner',
  ]) {
    assert.ok(guard.includes(condition), condition);
  }
  const rights = /^ {4}permissions:\n((?: {6}.+\n)+)/m.exec(JOBS)[1].trim().split('\n').map((line) => line.trim());
  assert.deepEqual(rights, ['contents: write', 'pull-requests: write']);
  assert.doesNotMatch(WORKFLOW, /environment:|secrets\./);
});

test('the actions are pinned to the same commits as in the Release workflow', () => {
  const pins = (text) => [...text.matchAll(/uses: (actions\/[\w-]+@[0-9a-f]{40})/g)].map((match) => match[1]);
  assert.equal(pins(WORKFLOW).length, 2);
  for (const pin of pins(WORKFLOW)) assert.ok(pins(RELEASE).includes(pin), pin);
});

test('the run hands the part to raise to the script through the environment and pushes with the job\'s token', () => {
  const start = JOBS.indexOf(`      - name: ${RUN_STEP}\n`);
  assert.ok(start !== -1, RUN_STEP);
  const stepText = JOBS.slice(start);
  assert.match(stepText, /^ {10}BUMP: \$\{\{ inputs\.bump \}\}$/m);
  assert.match(stepText, /^ {10}GH_TOKEN: \$\{\{ github\.token \}\}$/m);
  assert.match(stepText, /^ {8}run: node scripts\/prepare-release\.mjs "\$BUMP" --push$/m);
  // No expression inside a script: the input never becomes shell text.
  for (const run of WORKFLOW.matchAll(/^ +run: .*$/gm)) assert.doesNotMatch(run[0], /\$\{\{/);
});

test('the job commits as the repository\'s author, as the Release workflow tags', () => {
  for (const line of ["git config user.name 'Reywedian'", "git config user.email '27358836+Reywedian@users.noreply.github.com'"]) {
    assert.ok(WORKFLOW.includes(line) && RELEASE.includes(line), line);
  }
});
