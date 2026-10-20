// Contract of .github/workflows/release.yml: who may release, what each job may touch, and that a
// dry run publishes nothing. The file is read as text (the repository has no YAML parser), and the
// checks pin the lines a careless edit would break.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

// CRLF from a clone with core.autocrlf would otherwise defeat every line pattern below.
const WORKFLOW = readFileSync(new URL('../../.github/workflows/release.yml', import.meta.url), 'utf8').replace(/\r\n/g, '\n');

/** One job's text: from the line after `  <name>:` to the next job or the end of the file. */
const job = (name) => {
  const header = new RegExp(`^  ${name}:\\n`, 'm').exec(WORKFLOW);
  assert.ok(header, `job ${name}`);
  const body = WORKFLOW.slice(header.index + header[0].length);
  const next = body.search(/^ {2}[\w-]+:$/m);
  return next === -1 ? body : body.slice(0, next);
};

test('the workflow is called Release and starts only by hand or from a pushed version tag', () => {
  assert.match(WORKFLOW, /^name: Release$/m);
  const triggers = WORKFLOW.slice(WORKFLOW.indexOf('\non:\n'), WORKFLOW.indexOf('\npermissions:'));
  assert.deepEqual(triggers.match(/^ {2}[\w-]+:/gm), ['  workflow_dispatch:', '  push:']);
  assert.match(triggers, /^ {2}push:\n {4}tags: \['v\*\.\*\.\*'\]$/m);
  for (const input of ['bump', 'version', 'dry_run']) assert.match(triggers, new RegExp(`^ {6}${input}:$`, 'm'), input);
});

test('the workflow installs nothing: the repository has no dependencies', () => {
  assert.doesNotMatch(WORKFLOW, /npm (ci|install)/);
});

test('only the repository owner can start a release, and only from develop', () => {
  const authorize = job('authorize');
  for (const fact of ['github.ref', 'github.actor_id', 'github.repository_owner_id', 'github.triggering_actor', 'github.repository_owner']) {
    assert.ok(authorize.includes(`\${{ ${fact} }}`), fact);
  }
  assert.match(authorize, /"\$REF" != "refs\/heads\/develop"/);
  assert.match(authorize, /"\$ACTOR_ID" != "\$OWNER_ID" \] \|\| \[ "\$TRIGGERING_ACTOR" != "\$OWNER"/);
  assert.match(job('release'), /^ {4}needs: authorize$/m);
});

test('the release job waits for the approval of the release environment, and no other job does', () => {
  assert.match(job('release'), /^ {4}environment: release$/m);
  assert.equal(WORKFLOW.match(/^\s+environment:/gm).length, 1);
});

test('jobs get no token permissions unless they write, and one release runs at a time', () => {
  assert.match(WORKFLOW, /^permissions: \{\}$/m);
  assert.doesNotMatch(job('authorize'), /permissions:/);
  for (const name of ['release', 'publish']) assert.match(job(name), /^ {4}permissions:\n {6}contents: write$/m, name);
  assert.match(WORKFLOW, /^concurrency:\n {2}group: release\n {2}cancel-in-progress: false$/m);
});

test('every action is pinned to a full commit SHA', () => {
  const uses = WORKFLOW.match(/uses: .+/g);
  assert.ok(uses.length >= 3);
  for (const line of uses) assert.match(line, /^uses: [\w.-]+\/[\w.-]+@[0-9a-f]{40} # v\d+\.\d+\.\d+$/, line);
});

test('expressions sit only in YAML values, never inside a shell script', () => {
  const lines = WORKFLOW.split('\n').filter((line) => line.includes('${{'));
  assert.ok(lines.length > 0);
  for (const line of lines) assert.match(line, /^\s+(?!run:)[\w-]+: \$\{\{ .+ \}\}$/, line);
});

test('the release job sees the whole history and commits as the repository author', () => {
  const release = job('release');
  assert.match(release, /fetch-depth: 0/);
  assert.match(release, /git config user\.email '27358836\+Reywedian@users\.noreply\.github\.com'/);
  assert.match(release, /node scripts\/release\.mjs "\$KIND" "\$MODE"/);
});

test('a dry run publishes nothing: publish needs a tag from the release job or a pushed tag', () => {
  const publish = job('publish');
  assert.match(publish, /^ {4}needs: release$/m);
  assert.match(publish, /github\.event_name == 'push' \|\| needs\.release\.outputs\.tag != ''/);
  assert.match(job('release'), /^ {8}if: \$\{\{ !inputs\.dry_run \}\}$/m);
});

test('publishing a tag that already has a release is a no-op', () => {
  const publish = job('publish');
  assert.match(publish, /if gh release view "\$TAG"/);
  assert.match(publish, /persist-credentials: false/);
});
