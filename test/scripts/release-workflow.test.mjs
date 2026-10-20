// Contract of .github/workflows/release.yml: who may release, that the approval comes before any
// job runs, that a release reaches the protected develop only through a pull request, what each
// job may touch, and that a dry run publishes nothing. The file is read as text (the repository
// has no YAML parser), and the checks pin the lines a careless edit would break.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

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

test('the release reaches develop through a pull request: the release job pushes no tag and hands none over', () => {
  const release = job('release');
  assert.match(release, /node scripts\/release\.mjs "\$KIND" "\$MODE"/);
  assert.match(release, /^ {10}GH_TOKEN: \$\{\{ github\.token \}\}$/m);
  assert.doesNotMatch(release, /^ {4}outputs:/m);
  assert.doesNotMatch(release, /git (tag|push)/);
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

test('a dry run publishes nothing: publish needs a tag from the tag job or a pushed tag', () => {
  const publish = job('publish');
  assert.match(publish, /^ {4}needs: tag$/m);
  assert.match(publish, /github\.ref_type == 'tag' \|\| needs\.tag\.outputs\.tag != ''/);
  assert.match(publish, /^ {6}TAG: \$\{\{ github\.ref_type == 'tag' && github\.ref_name \|\| needs\.tag\.outputs\.tag \}\}$/m);
});

test('publishing a tag that already has a release is a no-op', () => {
  const publish = job('publish');
  assert.match(publish, /if gh release view "\$TAG"/);
  assert.match(publish, /persist-credentials: false/);
});
