// The contract check as the Compatibility workflow runs it: exit codes 0/1/2, the annotations on
// stdout and the run summary, with the file read and the summary written through stand-ins, and
// once through the entry point the workflow calls.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runContractCheck } from '../../scripts/lib/status-line-contract-cli.mjs';
import { STATUS_LINE_PAGE } from '../../scripts/lib/status-line-docs.mjs';
import { edited, PAGE, withExample } from '../fixtures/status-line-page.mjs';

const DOCS = '/runner/temp/statusline.md';
const FIELDS = 26; // the contract's fields (status-line-contract-drift.test.mjs pins the list)
const MILLISECONDS = ['in Unix epoch seconds |', 'in Unix epoch milliseconds |'];

/** Runs the check with `files` (path → text) as the only readable files. */
function run({ argv = ['--docs', DOCS], files = { [DOCS]: PAGE }, summary = true } = {}) {
  const out = [];
  const summaries = [];
  const reads = [];
  const code = runContractCheck({
    argv,
    readText: (path) => {
      reads.push(path);
      if (!(path in files)) throw new Error(`ENOENT: no such file or directory, open '${path}'`);
      return files[path];
    },
    writeSummary: summary ? (markdown) => summaries.push(markdown) : null,
    stdout: { write: (text) => out.push(text) },
  });
  const lines = out.join('').split('\n').filter(Boolean);
  return { code, lines, summary: summaries.join(''), reads };
}
const withPage = (page) => ({ files: { [DOCS]: page } });
const levels = (lines, level) => lines.filter((line) => line.startsWith(`::${level}::`));

test('a page that keeps the contract exits 0 with no annotation and a passing summary', () => {
  const result = run();
  assert.equal(result.code, 0);
  assert.deepEqual(result.lines, [`status line contract: the ${FIELDS} fields the plugin reads are documented with the types and units it expects.`]);
  assert.match(result.summary, /^### ✅ Status line contract\n/);
  assert.deepEqual(result.reads, [DOCS]);
});

test('a broken contract exits 1 with one error per changed field and a failing summary', () => {
  const result = run(withPage(edited(MILLISECONDS)));
  assert.equal(result.code, 1);
  assert.deepEqual(levels(result.lines, 'error'), [
    '::error::status line contract: rate_limits.five_hour.resets_at no longer says "Unix epoch seconds": "When the window resets, in Unix epoch milliseconds"',
    '::error::status line contract: rate_limits.seven_day.resets_at no longer says "Unix epoch seconds": "When the window resets, in Unix epoch milliseconds"',
  ]);
  assert.equal(result.lines.at(-1), `status line contract: 2 of the plugin's ${FIELDS} fields changed in ${STATUS_LINE_PAGE}; the plugin needs a look.`);
  assert.match(result.summary, /^### ❌ Status line contract\n[\s\S]*\n- rate_limits\.five_hour\.resets_at no longer says/);
});

test('each kind of change has its own message', () => {
  const page = edited(
    ['"five_hour": { "used_percentage": 12, "resets_at": 1800015000 }', '"five_hour": { "used_percentage": "12%", "resets_at": 1800015000 }'],
    ['>   "session_id": "abc123",\n', ''],
    ['| `session_id` | The session\'s id |\n', ''],
    ['| `hit_ratio` | Cache reads as a share of all input, from 0 to 1. |\n', ''],
  );
  const result = run(withPage(page));
  assert.equal(result.code, 1);
  assert.deepEqual(levels(result.lines, 'error'), [
    '::error::status line contract: session_id is no longer documented',
    '::error::status line contract: rate_limits.five_hour.used_percentage is documented as string, not number',
    '::error::status line contract: prompt_cache.hit_ratio has no description that says "from 0 to 1"',
  ]);
});

test('newly documented fields only warn: the run still passes and the summary lists them', () => {
  const page = edited(['"effort": { "level": "high" },', '"effort": { "level": "high" },\n>   "plan": { "name": "ultra" },']);
  const result = run(withPage(page));
  assert.equal(result.code, 0);
  assert.deepEqual(levels(result.lines, 'error'), []);
  assert.deepEqual(levels(result.lines, 'warning'), ['::warning::status line contract: newly documented fields the plugin does not read: plan.name.']);
  assert.match(result.summary, /^### ✅ [\s\S]*Newly documented, not read by the plugin:\n\n- `plan\.name`\n$/);
});

test('without --docs, or with an unknown option, nothing is read and the run fails with 2', () => {
  for (const argv of [[], ['--docs'], ['--docs', ''], ['--doc', DOCS], ['--docs', DOCS, '--strict'], [DOCS]]) {
    const result = run({ argv });
    assert.equal(result.code, 2, JSON.stringify(argv));
    assert.deepEqual(result.reads, [], JSON.stringify(argv));
    assert.deepEqual(levels(result.lines, 'error'), ['::error::status line contract: usage: check-status-line-contract.mjs --docs <statusline.md>; nothing was checked.']);
    assert.match(result.summary, /^### ❌ Status line contract\n/);
  }
});

test('a page that cannot be read fails with 2 and names the file and the reason', () => {
  const result = run({ files: {} });
  assert.equal(result.code, 2);
  assert.deepEqual(result.lines, [`::error::status line contract: cannot read ${DOCS} (ENOENT: no such file or directory, open '${DOCS}'); nothing was checked.`]);
});

// A rewritten page must not read as "every field is gone": that would point at the wrong fix.
test('a page whose layout is not recognised fails with 2, not as a broken contract', () => {
  const noTables = PAGE.split('\n').filter((line) => !line.startsWith('|')).join('\n');
  for (const page of [withExample('not json'), noTables, '<!doctype html><h1>Rate limited</h1>']) {
    const result = run(withPage(page));
    assert.equal(result.code, 2);
    assert.deepEqual(result.lines, [`::error::status line contract: the layout of ${STATUS_LINE_PAGE} is not recognised: no "Full JSON schema" example or no field table; nothing was checked.`]);
  }
});

test('outside a workflow run there is no summary to write, and the check still reports', () => {
  assert.equal(run({ summary: false }).code, 0);
  assert.equal(run({ ...withPage(edited(MILLISECONDS)), summary: false }).code, 1);
});

// The entry point the workflow calls: the file it reads, the summary it appends to, its exit code.
test('the entry point reads the page it is given, appends to GITHUB_STEP_SUMMARY and exits with the result', (t) => {
  const script = fileURLToPath(new URL('../../scripts/check-status-line-contract.mjs', import.meta.url));
  const fixture = fileURLToPath(new URL('../fixtures/status-line-docs.md', import.meta.url));
  const dir = mkdtempSync(join(tmpdir(), 'status-line-contract-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const summary = join(dir, 'summary.md');
  const node = (args) => spawnSync(process.execPath, [script, ...args], { encoding: 'utf8', env: { GITHUB_STEP_SUMMARY: summary } });
  const passed = node(['--docs', fixture]);
  assert.equal(passed.status, 0, passed.stderr);
  assert.match(passed.stdout, /^status line contract: the 26 fields the plugin reads are documented/);
  assert.match(readFileSync(summary, 'utf8'), /^### ✅ Status line contract\n/);
  const usage = node([]);
  assert.equal(usage.status, 2);
  assert.match(usage.stdout, /^::error::status line contract: usage:/);
});
