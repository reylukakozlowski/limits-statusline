// Contract of .github/workflows/release.yml and of master's ruleset (.github/rulesets/master.json):
// who may release, that the approval comes before anything runs, that a release is a tag and
// makes no commit, branch or pull request, that master moves only forward and only to the tagged
// commit, and that a dry run publishes nothing. The workflow is read as text (the repository has
// no YAML parser), and the checks pin the lines a careless edit would break. The scripts of the
// steps that touch GitHub also run for real in bash, against stand-ins for git and gh.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, join } from 'node:path';

// CRLF from a clone with core.autocrlf would otherwise defeat every line pattern below.
const WORKFLOW = readFileSync(new URL('../../.github/workflows/release.yml', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const JOBS = WORKFLOW.slice(WORKFLOW.indexOf('\njobs:\n'));
const RULESET = JSON.parse(readFileSync(new URL('../../.github/rulesets/master.json', import.meta.url), 'utf8'));

const RELEASE_CHECK = 'Release from develop';
const TAG_STEP = "Test and tag develop's head";
const MARK_STEP = 'Mark the tagged commit as a release from develop';
const MERGE_STEP = 'Merge develop into master';
const NOTES_STEP = 'Take the release notes from the tag';
const CREATE_STEP = 'Create the GitHub release unless it exists';
const KEEP_STEP = 'Keep only the latest release, tags stay';

/** One job's text: from the line after `  <name>:` to the next job or the end of the file. */
const job = (name) => {
  const header = new RegExp(`^  ${name}:\\n`, 'm').exec(JOBS);
  assert.ok(header, `job ${name}`);
  const body = JOBS.slice(header.index + header[0].length);
  const next = body.search(/^ {2}[\w-]+:$/m);
  return next === -1 ? body : body.slice(0, next);
};

/** One step's text, from its `- name:` line to the next step, comment or the end of the job. */
const step = (stepName) => {
  const body = job('release');
  const start = body.indexOf(`      - name: ${stepName}\n`);
  assert.ok(start !== -1, `step ${stepName}`);
  const rest = body.slice(start + 1);
  const next = rest.search(/^ {6}(- |# )/m);
  return next === -1 ? rest : rest.slice(0, next);
};

/** A step's `run: |` script, unindented. */
const script = (stepText) => {
  const block = /^ {8}run: \|\n((?: {10}.*\n|\n)+)/m.exec(stepText);
  assert.ok(block, 'run block');
  return block[1].replace(/^ {10}/gm, '');
};

const stepNames = () => [...job('release').matchAll(/^ {6}- name: (.+)$/gm)].map((match) => match[1]);

test('the workflow is called Release and starts only by hand, with a bump, an exact version or a dry run', () => {
  assert.match(WORKFLOW, /^name: Release$/m);
  const triggers = WORKFLOW.slice(WORKFLOW.indexOf('\non:\n'), WORKFLOW.indexOf('\npermissions:'));
  assert.deepEqual(triggers.match(/^ {2}[\w-]+:/gm), ['  workflow_dispatch:']);
  for (const input of ['bump', 'version', 'dry_run']) assert.match(triggers, new RegExp(`^ {6}${input}:$`, 'm'), input);
});

test('each run is named by what it does, so a dry run never looks like a release', () => {
  const runName = /^run-name: (.+)$/m.exec(WORKFLOW);
  assert.ok(runName, 'run-name');
  for (const word of ["'Dry run'", "'Release'", 'inputs.version || inputs.bump']) assert.ok(runName[1].includes(word), word);
});

test('one job, behind the release environment: the approval comes before anything runs', () => {
  assert.deepEqual(JOBS.match(/^ {2}[\w-]+(?=:$)/gm).map((name) => name.trim()), ['release']);
  assert.match(job('release'), /^ {4}environment: release$/m);
  assert.equal(WORKFLOW.match(/^\s+environment:/gm).length, 1);
});

test('only the repository owner, on develop, gets the job: GitHub skips anyone else before the approval', () => {
  const block = /^ {4}if: >-\n((?: {6}.+\n)+)/m.exec(job('release'));
  assert.ok(block, 'job guard');
  const condition = block[1].replace(/\s+/g, ' ');
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

test('the job tags, marks, merges into master and publishes, in that order; a dry run stops after the tests', () => {
  const names = stepNames();
  assert.deepEqual(names.slice(-6), [TAG_STEP, MARK_STEP, MERGE_STEP, NOTES_STEP, CREATE_STEP, KEEP_STEP]);
  assert.doesNotMatch(step(TAG_STEP), /^ {8}if:/m);
  for (const name of names.slice(-5)) assert.match(step(name), /^ {8}if: \$\{\{ !inputs\.dry_run \}\}$/m, name);
});

test('the tag step runs the release script and hands on only the tag it prints', () => {
  const tag = step(TAG_STEP);
  assert.match(tag, /^ {8}id: tag$/m);
  assert.match(tag, /^ {10}KIND: \$\{\{ inputs\.version \|\| inputs\.bump \}\}$/m);
  assert.match(tag, /^ {10}MODE: \$\{\{ inputs\.dry_run && '--dry-run' \|\| '--push' \}\}$/m);
  // An assignment, not `echo "tag=$(...)"`: under bash -e a failing script then fails the step.
  assert.equal(script(tag).trimEnd(), 'tag="$(node scripts/release.mjs "$KIND" "$MODE")"\necho "tag=$tag" >> "$GITHUB_OUTPUT"');
  for (const name of stepNames().slice(-5)) {
    assert.match(step(name), /^ {10}TAG: \$\{\{ steps\.tag\.outputs\.tag \}\}$/m, name);
  }
});

test('a release is only a tag: the workflow makes no commit, no branch and no pull request', () => {
  assert.doesNotMatch(WORKFLOW, /gh pr |git commit|git switch|git checkout|git branch|release\/v|pull-requests:/);
  assert.doesNotMatch(WORKFLOW, /--force|force=true|\+refs|git push [^\n]*--delete/);
});

test('the job gets only the token permissions it uses, and one release runs at a time', () => {
  assert.match(WORKFLOW, /^permissions: \{\}$/m);
  assert.match(job('release'), /^ {4}permissions:\n {6}contents: write\n {6}statuses: write\n {4}\S/m);
  assert.match(WORKFLOW, /^concurrency:\n {2}group: release\n {2}cancel-in-progress: false$/m);
});

test('the checkout sees every commit and tag, and pushes with RELEASE_TOKEN only when the environment has one', () => {
  const release = job('release');
  assert.match(release, /fetch-depth: 0/);
  assert.match(release, /^ {10}token: \$\{\{ secrets\.RELEASE_TOKEN \|\| github\.token \}\}$/m);
  assert.match(release, /git config user\.email '27358836\+Reywedian@users\.noreply\.github\.com'/);
});

test('every action is pinned to a full commit SHA', () => {
  // Anchored: `statuses: write` ends in `uses: write` too.
  const uses = WORKFLOW.match(/^ +(?:- )?uses: .+$/gm).map((line) => line.replace(/^ +(?:- )?/, ''));
  assert.equal(uses.length, 2);
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

test('the release notes are the body of the annotated tag, and the new release is marked Latest', () => {
  assert.match(step(NOTES_STEP), /git tag --list --format='%\(contents:body\)' "\$TAG" > "\$RUNNER_TEMP\/release-notes\.md"/);
  const create = script(step(CREATE_STEP));
  assert.match(create, /gh release create "\$TAG" --title "\$TAG" --notes-file "\$RUNNER_TEMP\/release-notes\.md" --verify-tag --latest/);
  assert.match(create, /if gh release view "\$TAG"/);
});

// --- master's ruleset ---------------------------------------------------------------------------

test('master\'s ruleset: no deletion, no force push, linear history, and every commit needs the release check', () => {
  assert.equal(RULESET.target, 'branch');
  assert.equal(RULESET.enforcement, 'active');
  assert.deepEqual(RULESET.conditions.ref_name, { include: ['refs/heads/master'], exclude: [] });
  assert.deepEqual(RULESET.bypass_actors, [], 'no one bypasses it, the owner included');
  assert.deepEqual(RULESET.rules.map((rule) => rule.type), ['deletion', 'non_fast_forward', 'required_linear_history', 'required_status_checks']);
  const checks = RULESET.rules.find((rule) => rule.type === 'required_status_checks').parameters;
  // Any source: the workflow sets a commit status, which needs no app behind it.
  assert.deepEqual(checks.required_status_checks, [{ context: RELEASE_CHECK }]);
  assert.equal(checks.strict_required_status_checks_policy, false);
  assert.equal(checks.do_not_enforce_on_create, false);
  // A pull request rule would refuse the fast-forward push the workflow makes.
  assert.ok(!RULESET.rules.some((rule) => ['pull_request', 'update'].includes(rule.type)));
});

test('the status the ruleset requires is the one the workflow sets, with the workflow\'s own token', () => {
  assert.ok(script(step(MARK_STEP)).includes(`-f context='${RELEASE_CHECK}'`));
  assert.match(step(MARK_STEP), /^ {10}GH_TOKEN: \$\{\{ github\.token \}\}$/m);
});

// --- Steps run in bash ----------------------------------------------------------------------------

const HAS_BASH = (() => {
  const probe = spawnSync('bash', ['--version']);
  return !probe.error && probe.status === 0;
})();
const NO_BASH = !HAS_BASH && 'bash is not installed';

/** Runs one step's script with stand-in commands first on PATH; every call is logged. */
function runStep(t, stepName, stubs, env) {
  const dir = mkdtempSync(join(tmpdir(), 'ls-release-step-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  for (const [name, lines] of Object.entries(stubs)) {
    writeFileSync(join(dir, name), `${lines.join('\n')}\n`);
    chmodSync(join(dir, name), 0o755);
  }
  const log = join(dir, 'calls.log');
  writeFileSync(log, '');
  // On Windows the variable is spelled Path; a second PATH key would leave which one wins undefined.
  const pathKey = Object.keys(process.env).find((key) => key.toUpperCase() === 'PATH') ?? 'PATH';
  const result = spawnSync('bash', ['-c', script(step(stepName))], {
    encoding: 'utf8',
    env: { ...process.env, [pathKey]: `${dir}${delimiter}${process.env[pathKey]}`, STUB_LOG: log, ...env },
  });
  const calls = readFileSync(log, 'utf8').split('\n').filter(Boolean);
  return { status: result.status, output: `${result.stdout}${result.stderr}`, calls, log };
}

// git for the merge step: the tag is commit 7a9, master is 3c4; ANCESTRY lists the `A>B` pairs
// for which `merge-base --is-ancestor A B` succeeds.
const MERGE_GIT = [
  '#!/usr/bin/env bash',
  'echo "git $*" >> "$STUB_LOG"',
  'case "$1" in',
  '  rev-parse) if [ "$2" = FETCH_HEAD ]; then echo 3c4; else echo 7a9; fi ;;',
  '  fetch|push) ;;',
  '  merge-base) case " $ANCESTRY " in *" $3>$4 "*) exit 0 ;; *) exit 1 ;; esac ;;',
  '  *) exit 64 ;;',
  'esac',
];

const pushes = (run) => run.calls.filter((call) => call.startsWith('git push'));

test('merge step: master behind the tag moves forward to exactly the tagged commit, without force', { skip: NO_BASH }, (t) => {
  const run = runStep(t, MERGE_STEP, { git: MERGE_GIT }, { TAG: 'v1.0.3', ANCESTRY: '3c4>7a9' });
  assert.equal(run.status, 0, run.output);
  assert.ok(run.calls.includes('git rev-parse v1.0.3^{commit}'));
  assert.ok(run.calls.includes('git fetch --quiet origin master'));
  assert.deepEqual(pushes(run), ['git push origin 7a9:refs/heads/master']);
  assert.match(run.output, /master is at v1\.0\.3 \(7a9\)/);
});

test('merge step: a master that already holds the tag stays where it is', { skip: NO_BASH }, (t) => {
  const run = runStep(t, MERGE_STEP, { git: MERGE_GIT }, { TAG: 'v1.0.3', ANCESTRY: '7a9>3c4' });
  assert.equal(run.status, 0, run.output);
  assert.deepEqual(pushes(run), []);
  assert.match(run.output, /master already holds v1\.0\.3/);
});

test('merge step: a master with commits the tag lacks is never overwritten', { skip: NO_BASH }, (t) => {
  const run = runStep(t, MERGE_STEP, { git: MERGE_GIT }, { TAG: 'v1.0.3', ANCESTRY: '' });
  assert.equal(run.status, 1);
  assert.deepEqual(pushes(run), []);
  assert.match(run.output, /::error::master has commits that v1\.0\.3 lacks/);
});

// gh for the mark step: refuses the first GH_REFUSALS calls the way GitHub did in run 39580647887
// (an HTTP error with an empty body, which gh reports as a JSON error), then accepts; the
// arguments of the last call are kept, sleep only records how long it waits.
const MARK_STUBS = {
  git: ['#!/usr/bin/env bash', 'echo "git $*" >> "$STUB_LOG"', 'echo 7a9'],
  gh: [
    '#!/usr/bin/env bash',
    'echo "gh call" >> "$STUB_LOG"',
    'printf "%s\\n" "$@" > "$STUB_LOG.gh"',
    'count=$(( $(cat "$STUB_LOG.count" 2>/dev/null || echo 0) + 1 ))',
    'echo "$count" > "$STUB_LOG.count"',
    'if [ "$count" -le "${GH_REFUSALS:-0}" ]; then',
    '  echo "HTTP/2.0 502 Bad Gateway"',
    '  echo "unexpected end of JSON input" >&2',
    '  exit 1',
    'fi',
    'echo "HTTP/2.0 201 Created"',
  ],
  sleep: ['#!/usr/bin/env bash', 'echo "sleep $*" >> "$STUB_LOG"'],
};

const markStep = (t, refusals) => {
  const runnerTemp = mkdtempSync(join(tmpdir(), 'ls-runner-temp-'));
  t.after(() => rmSync(runnerTemp, { recursive: true, force: true }));
  return runStep(t, MARK_STEP, MARK_STUBS, {
    TAG: 'v1.0.3', GITHUB_REPOSITORY: 'owner/repo', GH_REFUSALS: String(refusals), RUNNER_TEMP: runnerTemp,
  });
};

test('mark step: the status goes on the tagged commit, successful, at the first answer', { skip: NO_BASH }, (t) => {
  const run = markStep(t, 0);
  assert.equal(run.status, 0, run.output);
  assert.deepEqual(run.calls, ['git rev-parse v1.0.3^{commit}', 'gh call']);
  const args = readFileSync(`${run.log}.gh`, 'utf8').split('\n');
  assert.deepEqual(args.slice(0, 5), ['api', '--include', '--method', 'POST', 'repos/owner/repo/statuses/7a9']);
  for (const field of ['state=success', `context=${RELEASE_CHECK}`, 'description=The Release workflow tagged this head of develop as v1.0.3']) {
    assert.ok(args.includes(field), field);
  }
});

test('mark step: a refusal is retried after a pause, and GitHub\'s answer is shown', { skip: NO_BASH }, (t) => {
  const run = markStep(t, 2);
  assert.equal(run.status, 0, run.output);
  assert.deepEqual(run.calls.slice(1), ['gh call', 'sleep 5', 'gh call', 'sleep 10', 'gh call']);
  assert.equal(run.output.match(/HTTP\/2\.0 502 Bad Gateway/g)?.length, 2);
  assert.match(run.output, /unexpected end of JSON input/);
});

test('mark step: after four refusals it stops before master, and says how to finish', { skip: NO_BASH }, (t) => {
  const run = markStep(t, 99);
  assert.equal(run.status, 1);
  assert.equal(run.calls.filter((call) => call === 'gh call').length, 4);
  assert.deepEqual(run.calls.filter((call) => call.startsWith('sleep')), ['sleep 5', 'sleep 10', 'sleep 20']);
  assert.match(run.output, /::error::GitHub refused the status "Release from develop" four times; run the workflow again to finish v1\.0\.3\./);
});

// --- One release per repository, tags kept ----------------------------------------------------

test('the old releases go only after the new one exists, and no tag is ever deleted', () => {
  const names = stepNames();
  assert.ok(names.indexOf(KEEP_STEP) > names.indexOf(CREATE_STEP));
  assert.match(script(step(KEEP_STEP)), /gh release delete "\$old" --yes/);
  assert.doesNotMatch(WORKFLOW, /--cleanup-tag|git\/refs\/tags/);
});

// Stand-in gh for the keep step: GH_LATEST is the release GitHub marks as latest, GH_RELEASES the
// tags of all releases; deletions are recorded.
const KEEP_GH = [
  '#!/usr/bin/env bash',
  'echo "gh $*" >> "$STUB_LOG"',
  'case "$1 $2" in',
  '  "release view") echo "$GH_LATEST" ;;',
  '  "release list") printf "%s\\n" $GH_RELEASES ;;',
  '  "release delete") ;;',
  '  *) exit 64 ;;',
  'esac',
];

const deletions = (run) => run.calls.filter((call) => call.startsWith('gh release delete '));

test('keep step: the new release is the latest, so every older release goes and the tags stay', { skip: NO_BASH }, (t) => {
  const run = runStep(t, KEEP_STEP, { gh: KEEP_GH }, { TAG: 'v0.1.5', GH_LATEST: 'v0.1.5', GH_RELEASES: 'v0.1.5 v0.1.4 v0.1.3' });
  assert.equal(run.status, 0, run.output);
  assert.deepEqual(deletions(run), ['gh release delete v0.1.4 --yes', 'gh release delete v0.1.3 --yes']);
});

test('keep step: when the new release is not the latest, nothing is deleted', { skip: NO_BASH }, (t) => {
  const run = runStep(t, KEEP_STEP, { gh: KEEP_GH }, { TAG: 'v0.1.3', GH_LATEST: 'v0.1.5', GH_RELEASES: 'v0.1.5 v0.1.3' });
  assert.equal(run.status, 0, run.output);
  assert.deepEqual(deletions(run), []);
  assert.match(run.output, /not v0\.1\.3/);
});

test('keep step: a lone release deletes nothing', { skip: NO_BASH }, (t) => {
  const run = runStep(t, KEEP_STEP, { gh: KEEP_GH }, { TAG: 'v0.1.5', GH_LATEST: 'v0.1.5', GH_RELEASES: 'v0.1.5' });
  assert.equal(run.status, 0, run.output);
  assert.deepEqual(deletions(run), []);
});
