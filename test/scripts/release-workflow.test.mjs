// Contract of .github/workflows/release.yml: who may release, that the approval comes before any
// job runs, that a release reaches the protected develop only through a pull request, what each
// job may touch, and that a dry run publishes nothing. The file is read as text (the repository
// has no YAML parser), and the checks pin the lines a careless edit would break. The merge step's
// script also runs for real in bash, against stand-ins for git, gh and sleep.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, join } from 'node:path';

// CRLF from a clone with core.autocrlf would otherwise defeat every line pattern below.
const WORKFLOW = readFileSync(new URL('../../.github/workflows/release.yml', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const JOBS = WORKFLOW.slice(WORKFLOW.indexOf('\njobs:\n'));

/** One job's text: from the line after `  <name>:` to the next job or the end of the file. */
const job = (name) => {
  const header = new RegExp(`^  ${name}:\\n`, 'm').exec(JOBS);
  assert.ok(header, `job ${name}`);
  const body = JOBS.slice(header.index + header[0].length);
  const next = body.search(/^ {2}[\w-]+:$/m);
  return next === -1 ? body : body.slice(0, next);
};

/** One step's text, from its `- name:` line to the next step or the end of the job. */
const step = (jobName, stepName) => {
  const body = job(jobName);
  const start = body.indexOf(`      - name: ${stepName}\n`);
  assert.ok(start !== -1, `step ${stepName}`);
  const rest = body.slice(start + 1);
  const next = rest.search(/^ {6}- /m);
  return next === -1 ? rest : rest.slice(0, next);
};

/** A step's `run: |` script, unindented. */
const script = (stepText) => {
  const block = /^ {8}run: \|\n((?: {10}.*\n|\n)+)/m.exec(stepText);
  assert.ok(block, 'run block');
  return block[1].replace(/^ {10}/gm, '');
};

/** A job's `if: >-` condition on one line. */
const guard = (name) => {
  const block = /^ {4}if: >-\n((?: {6}.+\n)+)/m.exec(job(name));
  assert.ok(block, `${name} job guard`);
  return block[1].replace(/\s+/g, ' ');
};

test('the workflow is called Release and starts by hand, from a version change on develop, or from a pushed version tag', () => {
  assert.match(WORKFLOW, /^name: Release$/m);
  const triggers = WORKFLOW.slice(WORKFLOW.indexOf('\non:\n'), WORKFLOW.indexOf('\npermissions:'));
  assert.deepEqual(triggers.match(/^ {2}[\w-]+:/gm), ['  workflow_dispatch:', '  push:']);
  const push = triggers.slice(triggers.indexOf('\n  push:\n'));
  assert.match(push, /^ {4}branches: \[develop\]$/m);
  assert.match(push, /^ {4}paths: \[package\.json\]$/m);
  assert.match(push, /^ {4}tags: \['v\*\.\*\.\*'\]$/m);
  for (const input of ['bump', 'version', 'dry_run']) assert.match(triggers, new RegExp(`^ {6}${input}:$`, 'm'), input);
});

test('each run is named by what it does, so a dry run never looks like a release', () => {
  const runName = /^run-name: (.+)$/m.exec(WORKFLOW);
  assert.ok(runName, 'run-name');
  for (const word of ["'Dry run'", "'Release'", "'Publish {0}'", "'Tag and publish the merged release'", 'inputs.version || inputs.bump']) {
    assert.ok(runName[1].includes(word), word);
  }
});

test('the approval comes first: the release job starts its run and is the only one behind the release environment', () => {
  assert.deepEqual(JOBS.match(/^ {2}[\w-]+(?=:$)/gm).map((name) => name.trim()), ['release', 'tag', 'publish']);
  assert.doesNotMatch(job('release'), /^ {4}needs:/m);
  assert.match(job('release'), /^ {4}environment: release$/m);
  assert.equal(WORKFLOW.match(/^\s+environment:/gm).length, 1);
});

test('only the repository owner, on develop, gets a release job: GitHub skips anyone else before the approval', () => {
  const condition = guard('release');
  for (const fact of [
    "github.event_name == 'workflow_dispatch'",
    "github.ref == 'refs/heads/develop'",
    'github.actor_id == github.repository_owner_id',
    'github.triggering_actor == github.repository_owner',
  ]) {
    assert.ok(condition.includes(fact), fact);
  }
  assert.doesNotMatch(condition, /\|\|/);
});

test('the release job prepares, merges and tags in that order, the last two only outside a dry run', () => {
  const names = [...job('release').matchAll(/^ {6}- name: (.+)$/gm)].map((match) => match[1]);
  assert.deepEqual(names.slice(-3), [
    'Test, bump, commit, push the release branch and open its pull request',
    'Merge the release pull request',
    'Tag the merged release commit and push the tag',
  ]);
  assert.match(step('release', 'Test, bump, commit, push the release branch and open its pull request'), /node scripts\/release\.mjs "\$KIND" "\$MODE"/);
  for (const name of names.slice(-2)) assert.match(step('release', name), /^ {8}if: \$\{\{ !inputs\.dry_run \}\}$/m, name);
});

test('the release job merges exactly the prepared commit, by rebase, without bypassing any rule', () => {
  const merge = step('release', 'Merge the release pull request');
  assert.match(merge, /^ {10}GH_TOKEN: \$\{\{ github\.token \}\}$/m);
  assert.match(merge, /pr merge "\$branch" --rebase --match-head-commit "\$head"/);
  assert.doesNotMatch(merge, /--admin|--auto|--squash|--merge\b|--delete-branch/);
  assert.doesNotMatch(job('release'), /git (tag|push)/);
});

test('after the merge the release job tags the merged develop and hands the tag on', () => {
  const tag = step('release', 'Tag the merged release commit and push the tag');
  assert.match(tag, /^ {10}git fetch --quiet origin develop\n {10}git switch --quiet --detach FETCH_HEAD\n {10}tag="\$\(node scripts\/tag-release\.mjs\)"\n {10}echo "tag=\$tag" >> "\$GITHUB_OUTPUT"$/m);
  assert.match(tag, /^ {8}id: result$/m);
  assert.match(job('release'), /^ {4}outputs:\n {6}tag: \$\{\{ steps\.result\.outputs\.tag \}\}$/m);
});

test('the tag job runs only for a push to develop, and tags with the tag-release script', () => {
  const condition = guard('tag');
  assert.ok(condition.includes("github.event_name == 'push'"));
  assert.ok(condition.includes("github.ref == 'refs/heads/develop'"));
  assert.doesNotMatch(condition, /\|\|/);
  const tag = job('tag');
  assert.match(tag, /fetch-depth: 0/);
  assert.match(tag, /git config user\.email '27358836\+Reywedian@users\.noreply\.github\.com'/);
  // An assignment, not `echo "tag=$(...)"`: under bash -e a failing script then fails the step.
  assert.match(tag, /^ {10}tag="\$\(node scripts\/tag-release\.mjs\)"\n {10}echo "tag=\$tag" >> "\$GITHUB_OUTPUT"$/m);
  assert.match(tag, /^ {6}tag: \$\{\{ steps\.result\.outputs\.tag \}\}$/m);
});

test('jobs get only the token permissions they use, and one release runs at a time', () => {
  assert.match(WORKFLOW, /^permissions: \{\}$/m);
  assert.match(job('release'), /^ {4}permissions:\n {6}contents: write\n {6}pull-requests: write\n {4}\S/m);
  for (const name of ['tag', 'publish']) assert.match(job(name), /^ {4}permissions:\n {6}contents: write\n {4}\S/m, name);
  assert.match(WORKFLOW, /^concurrency:\n {2}group: release\n {2}cancel-in-progress: false$/m);
});

test('every action is pinned to a full commit SHA', () => {
  const uses = WORKFLOW.match(/uses: .+/g);
  assert.ok(uses.length >= 6);
  for (const line of uses) assert.match(line, /^uses: [\w.-]+\/[\w.-]+@[0-9a-f]{40} # v\d+\.\d+\.\d+$/, line);
});

test('expressions sit only in YAML values, never inside a shell script', () => {
  const lines = WORKFLOW.split('\n').filter((line) => line.includes('${{'));
  assert.ok(lines.length > 0);
  for (const line of lines) assert.match(line, /^\s*(?!run:)[\w-]+: \$\{\{ .+ \}\}$/, line);
});

test('the workflow installs nothing: the repository has no dependencies', () => {
  assert.doesNotMatch(WORKFLOW, /npm (ci|install)/);
});

test('the release job sees the whole history and commits as the repository author', () => {
  const release = job('release');
  assert.match(release, /fetch-depth: 0/);
  assert.match(release, /git config user\.email '27358836\+Reywedian@users\.noreply\.github\.com'/);
});

test('a dry run publishes nothing: publish needs a tag from the release job, the tag job or a push', () => {
  const publish = job('publish');
  assert.match(publish, /^ {4}needs: \[release, tag\]$/m);
  assert.match(publish, /github\.ref_type == 'tag' \|\| needs\.release\.outputs\.tag != '' \|\| needs\.tag\.outputs\.tag != ''/);
  assert.match(publish, /^ {6}TAG: \$\{\{ github\.ref_type == 'tag' && github\.ref_name \|\| needs\.release\.outputs\.tag \|\| needs\.tag\.outputs\.tag \}\}$/m);
});

test('publishing a tag that already has a release is a no-op', () => {
  const publish = job('publish');
  assert.match(publish, /if gh release view "\$TAG"/);
  assert.match(publish, /persist-credentials: false/);
});

// --- The merge step, run in bash ------------------------------------------------------------

const HAS_BASH = (() => {
  const probe = spawnSync('bash', ['--version']);
  return !probe.error && probe.status === 0;
})();
const NO_BASH = !HAS_BASH && 'bash is not installed';

// Stand-ins on PATH: git answers the two questions the step asks (on GIT_BRANCH), gh refuses the
// first GH_REFUSALS merges and reports GH_STATE when asked, sleep only records how long it waits.
const STUBS = {
  git: [
    '#!/usr/bin/env bash',
    'case "$*" in',
    '  "rev-parse --abbrev-ref HEAD") echo "${GIT_BRANCH:-release/v0.1.2}" ;;',
    '  "rev-parse HEAD") echo 0123abcd ;;',
    '  *) echo "unexpected: git $*" >&2; exit 64 ;;',
    'esac',
  ],
  gh: [
    '#!/usr/bin/env bash',
    'echo "gh $*" >> "$STUB_LOG"',
    'if [ "$1 $2" = "pr merge" ]; then',
    '  count=$(( $(cat "$STUB_LOG.merges" 2>/dev/null || echo 0) + 1 ))',
    '  echo "$count" > "$STUB_LOG.merges"',
    '  if [ "$count" -gt "${GH_REFUSALS:-0}" ]; then exit 0; fi',
    '  echo "Pull Request is not mergeable" >&2',
    '  exit 1',
    'fi',
    'if [ "$1 $2" = "pr view" ]; then echo "${GH_STATE:-OPEN}"; exit 0; fi',
    'exit 64',
  ],
  sleep: ['#!/usr/bin/env bash', 'echo "sleep $*" >> "$STUB_LOG"'],
};

function runMergeStep(t, env) {
  const dir = mkdtempSync(join(tmpdir(), 'ls-merge-step-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  for (const [name, lines] of Object.entries(STUBS)) {
    writeFileSync(join(dir, name), `${lines.join('\n')}\n`);
    chmodSync(join(dir, name), 0o755);
  }
  const log = join(dir, 'calls.log');
  writeFileSync(log, '');
  // On Windows the variable is spelled Path; a second PATH key would leave which one wins undefined.
  const pathKey = Object.keys(process.env).find((key) => key.toUpperCase() === 'PATH') ?? 'PATH';
  const result = spawnSync('bash', ['-c', script(step('release', 'Merge the release pull request'))], {
    encoding: 'utf8',
    env: { ...process.env, [pathKey]: `${dir}${delimiter}${process.env[pathKey]}`, STUB_LOG: log, ...env },
  });
  const calls = readFileSync(log, 'utf8').split('\n').filter(Boolean);
  return { status: result.status, output: `${result.stdout}${result.stderr}`, calls };
}

const MERGE_CALL = 'gh pr merge release/v0.1.2 --rebase --match-head-commit 0123abcd';
const VIEW_CALL = 'gh pr view release/v0.1.2 --json state --jq .state';

test('merge step: a pull request GitHub accepts at once is merged without waiting', { skip: NO_BASH }, (t) => {
  const run = runMergeStep(t, { GH_REFUSALS: '0' });
  assert.equal(run.status, 0, run.output);
  assert.deepEqual(run.calls, [MERGE_CALL]);
});

test('merge step: refusals while GitHub works out mergeability are retried after a pause', { skip: NO_BASH }, (t) => {
  const run = runMergeStep(t, { GH_REFUSALS: '2' });
  assert.equal(run.status, 0, run.output);
  assert.deepEqual(run.calls, [MERGE_CALL, VIEW_CALL, 'sleep 5', MERGE_CALL, VIEW_CALL, 'sleep 10', MERGE_CALL]);
});

test('merge step: after four refusals it stops, leaving the pull request open for the owner', { skip: NO_BASH }, (t) => {
  const run = runMergeStep(t, { GH_REFUSALS: '99' });
  assert.equal(run.status, 1);
  assert.equal(run.calls.filter((call) => call === MERGE_CALL).length, 4);
  assert.deepEqual(run.calls.filter((call) => call.startsWith('sleep')), ['sleep 5', 'sleep 10', 'sleep 20']);
  assert.match(run.output, /::error::The pull request of release\/v0\.1\.2 is still open: merge it with Rebase and merge/);
});

test('merge step: off a release branch it merges nothing and asks gh nothing', { skip: NO_BASH }, (t) => {
  for (const branch of ['develop', 'feature/x', 'HEAD', 'release-v0.1.2']) {
    const run = runMergeStep(t, { GIT_BRANCH: branch });
    assert.equal(run.status, 1, branch);
    assert.deepEqual(run.calls, [], branch);
    assert.match(run.output, /::error::Not on a release branch/, branch);
  }
});

test('merge step: a merge gh reported as failed but GitHub shows as merged counts as merged', { skip: NO_BASH }, (t) => {
  const run = runMergeStep(t, { GH_REFUSALS: '99', GH_STATE: 'MERGED' });
  assert.equal(run.status, 0, run.output);
  assert.deepEqual(run.calls, [MERGE_CALL, VIEW_CALL]);
});
