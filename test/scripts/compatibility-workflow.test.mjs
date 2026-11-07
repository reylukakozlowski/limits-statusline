// Contract of .github/workflows/compatibility.yml: every second day, and by hand, the plugin runs
// against the newest Claude Code; every check reports even when an earlier one failed, a failure
// fails the run (the only notification there is), the token only reads and no secret is held.
// The workflow is read as text (the repository has no YAML parser), and the checks pin the lines a
// careless edit would break.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { STATUS_LINE_PAGE } from '../../scripts/lib/status-line-docs.mjs';

// CRLF from a clone with core.autocrlf would otherwise defeat every line pattern below.
const read = (path) => readFileSync(new URL(path, import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const WORKFLOW = read('../../.github/workflows/compatibility.yml');
const RELEASE = read('../../.github/workflows/release.yml');
const STEPS = WORKFLOW.slice(WORKFLOW.indexOf('\n    steps:\n'));
const DOCS_COPY = '"$RUNNER_TEMP/statusline.md"';

/** The steps in order, each from its `- ` line to the next step. */
const steps = () => STEPS.split(/\n(?= {6}(?:- |# ))/).filter((text) => /^ {6}- /.test(text));
const named = (name) => {
  const found = steps().find((text) => text.includes(`- name: ${name}\n`));
  assert.ok(found, `step ${name}`);
  return found;
};
const condition = (stepText) => /^ {8}if: (.+)$/m.exec(stepText)?.[1] ?? null;
const run = (stepText) => /^ {8}run: (?!\|)(.+)$/m.exec(stepText)?.[1] ?? null;

test('the workflow is called Compatibility and runs every second day and by hand, nothing else', () => {
  assert.match(WORKFLOW, /^name: Compatibility$/m);
  const triggers = WORKFLOW.slice(WORKFLOW.indexOf('\non:\n'), WORKFLOW.indexOf('\npermissions:'));
  assert.deepEqual(triggers.match(/^ {2}[\w-]+:/gm), ['  schedule:', '  workflow_dispatch:']);
  // Day of month */2 with a fixed hour and minute: at most two days apart, also across months.
  assert.deepEqual(triggers.match(/^ {4}- cron: .+$/gm), ["    - cron: '17 4 */2 * *'"]);
  assert.doesNotMatch(WORKFLOW, /^\s+(push|pull_request|pull_request_target|workflow_run):/m);
});

test('the token only reads the repository, and the run holds no secret and writes no credentials', () => {
  assert.match(WORKFLOW, /\npermissions:\n {2}contents: read\n\n/);
  assert.doesNotMatch(WORKFLOW, /:\s*write\b/);
  assert.doesNotMatch(WORKFLOW, /secrets\./);
  assert.doesNotMatch(WORKFLOW, /\bproduction\b/);
  assert.match(WORKFLOW, /^ {10}persist-credentials: false$/m);
});

test('one run at a time, with a time limit', () => {
  assert.match(WORKFLOW, /\nconcurrency:\n {2}group: compatibility\n {2}cancel-in-progress: false\n/);
  assert.match(WORKFLOW, /^ {4}timeout-minutes: \d+$/m);
  assert.match(WORKFLOW, /^ {4}runs-on: ubuntu-latest$/m);
});

test('the actions are the Release workflow\'s own pinned commits and Node.js release', () => {
  const uses = WORKFLOW.match(/^ {6}- uses: .+$/gm) ?? [];
  assert.equal(uses.length, 2);
  for (const line of uses) {
    assert.match(line, /^ {6}- uses: [\w.-]+\/[\w.-]+@[0-9a-f]{40} # v\d+\.\d+\.\d+$/);
    assert.ok(RELEASE.includes(line.trim()), `${line.trim()} as in release.yml`);
  }
  const node = (text) => /^ {10}node-version: (\d+)$/m.exec(text)?.[1];
  assert.equal(node(WORKFLOW), node(RELEASE));
  // @anthropic-ai/claude-code declares "engines": { "node": ">=22.0.0" } (npm registry, 2.1.319).
  assert.ok(Number(node(WORKFLOW)) >= 22);
});

test('it installs the newest Claude Code and proves the binary runs before any check', () => {
  const install = named('Install the newest Claude Code');
  assert.match(install, /^ {8}id: install$/m);
  assert.equal(condition(install), null, 'the install always runs');
  assert.match(install, /^ {10}npm install --global --no-audit --no-fund @anthropic-ai\/claude-code@latest$/m);
  assert.match(install, /^ {10}version="\$\(claude --version\)"$/m);
});

// The page downloaded is the page the contract check names in its reports (STATUS_LINE_PAGE).
test('the checks are the manifest validation, the band\'s tests and the status line contract', () => {
  assert.equal(run(named('Validate the plugin')), 'claude plugin validate .');
  assert.equal(run(named('Test the desktop band')), 'claude plugin test .');
  assert.equal(run(named('Check the status line contract')), `node scripts/check-status-line-contract.mjs --docs ${DOCS_COPY}`);
  const download = named('Download the status line page');
  assert.match(download, /^ {8}id: docs$/m);
  assert.equal(run(download), `curl --fail --silent --show-error --location --retry 3 --output ${DOCS_COPY} ${STATUS_LINE_PAGE}`);
});

// The default `if` is success(): a step added without !cancelled() would hide every check after
// a failed one, and continue-on-error would turn a failure green, so no failure would notify.
test('every check runs even when an earlier one failed, and needs only what it uses', () => {
  const names = steps().map((text) => /- name: (.+)$/m.exec(text)?.[1] ?? 'uses');
  assert.deepEqual(names, ['uses', 'uses', 'Install the newest Claude Code', 'Download the status line page',
    'Validate the plugin', 'Test the desktop band', 'Check the status line contract']);
  assert.equal(condition(named('Download the status line page')), '${{ !cancelled() }}');
  assert.equal(condition(named('Validate the plugin')), "${{ !cancelled() && steps.install.outcome == 'success' }}");
  assert.equal(condition(named('Test the desktop band')), "${{ !cancelled() && steps.install.outcome == 'success' }}");
  assert.equal(condition(named('Check the status line contract')), "${{ !cancelled() && steps.docs.outcome == 'success' }}");
  assert.doesNotMatch(WORKFLOW, /continue-on-error/);
});

test('expressions stay in YAML values, never inside a shell script', () => {
  const scriptLines = WORKFLOW.split('\n').filter((line) => /^ {8}run: /.test(line) || /^ {10}\S/.test(line));
  assert.deepEqual(scriptLines.filter((line) => line.includes('${{')), []);
});
