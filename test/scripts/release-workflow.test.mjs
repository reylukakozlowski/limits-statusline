// Contract of .github/workflows/release.yml and of master's rulesets (.github/rulesets/master-*.json):
// who may release, that one click runs the tests, the dry run and the checks and then the release
// with nothing more asked, that only the release job holds the deploy key and it alone builds the
// release commit, tags it and moves master, that master only moves forward, and that a dry run
// publishes nothing. The release script itself runs against real git in release.integration.test.mjs.
// The workflow is read as text (the repository has no YAML parser), and the checks pin the lines
// a careless edit would break. The scripts of the steps that touch GitHub also run for real in
// bash, against stand-ins for npm and gh.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { chmodSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, join } from 'node:path';

// CRLF from a clone with core.autocrlf would otherwise defeat every line pattern below.
const read = (path) => readFileSync(new URL(path, import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const WORKFLOWS = new URL('../../.github/workflows/', import.meta.url);
const WORKFLOW = read('../../.github/workflows/release.yml');
const JOBS = WORKFLOW.slice(WORKFLOW.indexOf('\njobs:\n'));
const RELEASE_ONLY = JSON.parse(read('../../.github/rulesets/master-release-only.json'));
const HISTORY = JSON.parse(read('../../.github/rulesets/master-history.json'));

const TESTS_STEP = 'Run the tests';
const DRY_RUN_STEP = 'Dry run of the release';
const PREFLIGHT_STEP = 'Check that the release can reach master';
const AUTHOR_STEP = "Commit and tag as the repository's author";
const RELEASE_STEP = 'Test, build the release commit, tag it and move master';
const NOTES_STEP = 'Take the release notes from the tag';
const CREATE_STEP = 'Create the GitHub release unless it exists';
const KEEP_STEP = 'Keep only the latest release, tags stay';
const JOB_NAMES = ['ci', 'release', 'publish'];

/** One job's text: from the line after `  <name>:` to the next job or the end of the file. */
const job = (name) => {
  const header = new RegExp(`^  ${name}:\\n`, 'm').exec(JOBS);
  assert.ok(header, `job ${name}`);
  const body = JOBS.slice(header.index + header[0].length);
  const next = body.search(/^ {2}[\w-]+:$/m);
  return next === -1 ? body : body.slice(0, next);
};

/** One step's text, from its `- name:` line to the next step, comment or the end of the job. */
const step = (jobName, stepName) => {
  const body = job(jobName);
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

const stepNames = (jobName) => [...job(jobName).matchAll(/^ {6}- name: (.+)$/gm)].map((match) => match[1]);

/** A job's `if: >-` condition on one line. */
const guard = (jobName) => {
  const block = /^ {4}if: >-\n((?: {6}.+\n)+)/m.exec(job(jobName));
  assert.ok(block, `guard of ${jobName}`);
  return block[1].replace(/\s+/g, ' ').trim();
};

test('the workflow is called Release and starts only by hand, with the part of the version to raise and a dry run', () => {
  assert.match(WORKFLOW, /^name: Release$/m);
  const triggers = WORKFLOW.slice(WORKFLOW.indexOf('\non:\n'), WORKFLOW.indexOf('\npermissions:'));
  assert.deepEqual(triggers.match(/^ {2}[\w-]+:/gm), ['  workflow_dispatch:']);
  assert.deepEqual(triggers.match(/^ {6}[\w-]+:$/gm), ['      bump:', '      dry_run:']);
  assert.match(triggers, /^ {8}type: choice\n {8}options: \[patch, minor, major\]\n {8}default: patch$/m);
  assert.match(triggers, /^ {8}type: boolean\n {8}default: false$/m);
});

test('each run is named by what it does and the part it raises, so a dry run never looks like a release', () => {
  const runName = /^run-name: (.+)$/m.exec(WORKFLOW);
  assert.ok(runName, 'run-name');
  for (const word of ["'Dry run'", "'Release'", 'inputs.dry_run', 'inputs.bump']) assert.ok(runName[1].includes(word), word);
});

test('three jobs in a chain: CI, the release behind production, then the GitHub release', () => {
  assert.deepEqual(JOBS.match(/^ {2}[\w-]+(?=:$)/gm).map((name) => name.trim()), JOB_NAMES);
  assert.match(job('release'), /^ {4}environment: production$/m);
  assert.equal(WORKFLOW.match(/^\s+environment:/gm).length, 1, 'ci and publish run in no environment');
  assert.match(job('release'), /^ {4}needs: \[ci\]$/m);
  assert.match(job('publish'), /^ {4}needs: \[release\]$/m);
  // The graph on the run's page says which part is CI and which CD.
  const names = JOB_NAMES.map((name) => /^ {4}name: '(.+)'$/m.exec(job(name))?.[1]);
  assert.deepEqual(names, ['CI: tests and checks', 'CD: release commit, tag and master', 'CD: GitHub release']);
});

test('one click is the whole of it: the run waits for no approval, and CI is the one job that waits for no other', () => {
  assert.doesNotMatch(WORKFLOW, /environment: release\b/);
  assert.deepEqual(JOB_NAMES.filter((name) => !/^ {4}needs:/m.test(job(name))), ['ci']);
});

test('only the repository owner, on develop, gets any job: GitHub skips anyone else', () => {
  for (const name of JOB_NAMES) {
    const condition = guard(name);
    for (const fact of [
      "github.event_name == 'workflow_dispatch'",
      "github.ref == 'refs/heads/develop'",
      'github.actor_id == github.repository_owner_id',
      'github.triggering_actor == github.repository_owner',
    ]) {
      assert.ok(condition.includes(fact), `${name}: ${fact}`);
    }
    assert.doesNotMatch(condition, /\|\||always\(\)|failure\(\)|cancelled\(\)/, name);
  }
});

test('CI, in every run, a release too: the tests, the dry run and the check of the way to master', () => {
  assert.deepEqual(stepNames('ci'), [TESTS_STEP, DRY_RUN_STEP, PREFLIGHT_STEP]);
  // The tests in a step of their own, whose counts go to the run's summary page.
  const tests = script(step('ci', TESTS_STEP));
  assert.match(tests, /^npm test 2>&1 \| tee "\$RUNNER_TEMP\/tests\.txt" \|\| status=\$\?$/m);
  assert.match(tests, />> "\$GITHUB_STEP_SUMMARY"$/m);
  assert.match(tests, /^exit "\$status"$/m);
  // The input through the environment, never written into the script.
  const dryRun = step('ci', DRY_RUN_STEP);
  assert.match(dryRun, /^ {10}BUMP: \$\{\{ inputs\.bump \}\}$/m);
  assert.match(dryRun, /^ {8}run: node scripts\/release\.mjs "\$BUMP" --dry-run$/m);
  const preflight = step('ci', PREFLIGHT_STEP);
  assert.match(preflight, /^ {10}GH_TOKEN: \$\{\{ github\.token \}\}$/m);
  assert.match(preflight, /^ {8}run: node scripts\/release-preflight\.mjs$/m);
  // Every check runs and a failed one fails CI, so the release job never starts.
  assert.doesNotMatch(job('ci'), /^ {8}(if|continue-on-error):/m);
});

test('CI reads and writes nothing else: a read-only token, no credentials kept, no secret', () => {
  const ci = job('ci');
  assert.match(ci, /^ {4}permissions:\n {6}contents: read\n {6}actions: read # .+\n {4}\S/m);
  assert.match(ci, /^ {10}persist-credentials: false$/m);
  assert.doesNotMatch(ci, /secrets\.|--push|git push|git tag|gh release/);
});

test('a dry run is CI alone: it makes no commit or tag, never enters production and publishes nothing', () => {
  assert.doesNotMatch(guard('ci'), /dry_run/);
  for (const name of ['release', 'publish']) assert.ok(guard(name).endsWith('&& !inputs.dry_run'), name);
  assert.deepEqual(stepNames('release'), [AUTHOR_STEP, RELEASE_STEP]);
  assert.deepEqual(stepNames('publish'), [NOTES_STEP, CREATE_STEP, KEEP_STEP]);
});

test('the release step runs the release script with the part to raise and hands on only the tag it prints', () => {
  const release = step('release', RELEASE_STEP);
  assert.match(release, /^ {8}id: release$/m);
  assert.match(release, /^ {10}BUMP: \$\{\{ inputs\.bump \}\}$/m);
  // An assignment, not `echo "tag=$(...)"`: under bash -e a failing script then fails the step.
  assert.equal(script(release).trimEnd(), 'tag="$(node scripts/release.mjs "$BUMP" --push)"\necho "tag=$tag" >> "$GITHUB_OUTPUT"');
  assert.match(job('release'), /^ {4}outputs:\n {6}tag: \$\{\{ steps\.release\.outputs\.tag \}\}\n/m);
  for (const stepName of [NOTES_STEP, CREATE_STEP, KEEP_STEP]) {
    assert.match(step('publish', stepName), /^ {10}TAG: \$\{\{ needs\.release\.outputs\.tag \}\}$/m, stepName);
  }
});

// The release commit is made by scripts/release.mjs (git commit-tree), never by a step of its own.
test('the workflow opens no pull request, makes no branch and never forces or deletes a ref', () => {
  assert.doesNotMatch(WORKFLOW, /gh pr |git commit|git switch|git checkout|git branch|release\/v|pull-requests:/);
  assert.doesNotMatch(WORKFLOW, /--force|force=true|\+refs|git push [^\n]*--delete/);
});

test('each job gets only the token permissions it uses, and one release runs at a time', () => {
  assert.match(WORKFLOW, /^permissions: \{\}$/m);
  // The release job pushes with the deploy key; its token only reads.
  assert.match(job('release'), /^ {4}permissions:\n {6}contents: read\n {4}\S/m);
  assert.match(job('publish'), /^ {4}permissions:\n {6}contents: write\n {4}\S/m);
  assert.match(WORKFLOW, /^concurrency:\n {2}group: release\n {2}cancel-in-progress: false$/m);
});

test('only the release job holds the deploy key, at the run\'s commit with every branch and tag, and commits as the repository\'s author', () => {
  // The workflow names one secret, once: the deploy key, in the release job's checkout.
  assert.deepEqual(WORKFLOW.match(/secrets\.\w+/g), ['secrets.PRODUCTION_DEPLOY_KEY']);
  const release = job('release');
  const checkout = release.slice(0, release.indexOf(`      - name: ${AUTHOR_STEP}\n`));
  assert.match(checkout, /^ {6}- uses: actions\/checkout@/m);
  // No ref: develop at the run's commit, the one CI checked, not a develop that moved since.
  assert.doesNotMatch(checkout, /^ {10}ref:/m);
  assert.match(checkout, /^ {10}fetch-depth: 0$/m);
  assert.match(checkout, /^ {10}ssh-key: \$\{\{ secrets\.PRODUCTION_DEPLOY_KEY \}\}$/m);
  assert.match(release, /git config user\.email '27358836\+Reywedian@users\.noreply\.github\.com'/);
  assert.match(job('publish'), /^ {10}persist-credentials: false$/m);
});

test('no other workflow names the production environment or its key', () => {
  for (const file of readdirSync(WORKFLOWS).filter((name) => name !== 'release.yml')) {
    assert.doesNotMatch(readFileSync(new URL(file, WORKFLOWS), 'utf8'), /production|PRODUCTION_DEPLOY_KEY/i, file);
  }
});

test('every action is pinned to a full commit SHA', () => {
  const uses = WORKFLOW.match(/^ +(?:- )?uses: .+$/gm).map((line) => line.replace(/^ +(?:- )?/, ''));
  assert.equal(uses.length, 5);
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
  assert.match(step('publish', NOTES_STEP), /git tag --list --format='%\(contents:body\)' "\$TAG" > "\$RUNNER_TEMP\/release-notes\.md"/);
  const create = script(step('publish', CREATE_STEP));
  assert.match(create, /gh release create "\$TAG" --title "\$TAG" --notes-file "\$RUNNER_TEMP\/release-notes\.md" --verify-tag --latest/);
  assert.match(create, /if gh release view "\$TAG"/);
});

// --- master's rulesets ----------------------------------------------------------------------------

const onMaster = (ruleset) => {
  assert.equal(ruleset.target, 'branch');
  assert.equal(ruleset.enforcement, 'active');
  assert.deepEqual(ruleset.conditions.ref_name, { include: ['refs/heads/master'], exclude: [] });
};

test('master: release only — master is created and moved only through a deploy key', () => {
  onMaster(RELEASE_ONLY);
  assert.equal(RELEASE_ONLY.name, 'master: release only');
  assert.deepEqual(RELEASE_ONLY.rules, [{ type: 'creation' }, { type: 'update', parameters: { update_allows_fetch_and_merge: false } }]);
  // actor_id null: GitHub cannot name one key, so every deploy key bypasses — the repository has one.
  assert.deepEqual(RELEASE_ONLY.bypass_actors, [{ actor_id: null, actor_type: 'DeployKey', bypass_mode: 'always' }]);
});

test('master: history — no deletion, no force push, linear history, and no one bypasses it', () => {
  onMaster(HISTORY);
  assert.equal(HISTORY.name, 'master: history');
  assert.deepEqual(HISTORY.rules.map((rule) => rule.type), ['deletion', 'non_fast_forward', 'required_linear_history']);
  assert.deepEqual(HISTORY.bypass_actors, [], 'the deploy key and the owner included');
});

test('nothing asks master for a status check or a pull request: either would refuse the deploy key\'s push', () => {
  for (const ruleset of [RELEASE_ONLY, HISTORY]) {
    assert.ok(!ruleset.rules.some((rule) => ['required_status_checks', 'pull_request'].includes(rule.type)), ruleset.name);
  }
  assert.doesNotMatch(WORKFLOW, /Release from develop|statuses|RELEASE_TOKEN/);
});

// --- Steps run in bash ----------------------------------------------------------------------------

const HAS_BASH = (() => {
  const probe = spawnSync('bash', ['--version']);
  return !probe.error && probe.status === 0;
})();
const NO_BASH = !HAS_BASH && 'bash is not installed';

/** Runs one step's script with stand-in commands first on PATH; every call is logged. */
function runStep(t, jobName, stepName, stubs, env) {
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
  // Git for Windows' bin\bash.exe, the bash on PATH on GitHub's Windows runners, puts its own
  // /mingw64/bin, which holds the real git, before the PATH it is given; so the script puts the
  // stand-ins first again itself (`cd` and `pwd` turn the folder into the shell's own spelling).
  const standInsFirst = 'PATH="$(cd "$STUB_DIR" && pwd):$PATH"';
  // -e, as GitHub runs a `run:` script on Linux (bash -e {0}).
  const result = spawnSync('bash', ['-e', '-c', `${standInsFirst}\n${script(step(jobName, stepName))}`], {
    encoding: 'utf8',
    env: { ...process.env, [pathKey]: `${dir}${delimiter}${process.env[pathKey]}`, STUB_DIR: dir, STUB_LOG: log, ...env },
  });
  const calls = readFileSync(log, 'utf8').split('\n').filter(Boolean);
  return { status: result.status, output: `${result.stdout}${result.stderr}`, calls };
}

// npm for the tests step: prints NPM_OUTPUT (node --test's own format) and exits with NPM_STATUS.
const TESTS_NPM = ['#!/usr/bin/env bash', 'echo "npm $*" >> "$STUB_LOG"', 'printf "%s" "$NPM_OUTPUT"', 'exit "${NPM_STATUS:-0}"'];
const totals = ({ tests, pass, fail, skipped }) =>
  `ℹ tests ${tests}\nℹ suites 0\nℹ pass ${pass}\nℹ fail ${fail}\nℹ cancelled 0\nℹ skipped ${skipped}\nℹ todo 0\nℹ duration_ms 2674.88\n`;

/** Runs the tests step against the stand-in npm; returns the run and the summary it wrote. */
function testsStep(t, output, status) {
  const runnerTemp = mkdtempSync(join(tmpdir(), 'ls-runner-temp-'));
  t.after(() => rmSync(runnerTemp, { recursive: true, force: true }));
  const summary = join(runnerTemp, 'summary.md');
  writeFileSync(summary, '');
  const run = runStep(t, 'ci', TESTS_STEP, { npm: TESTS_NPM }, {
    NPM_OUTPUT: output, NPM_STATUS: String(status), RUNNER_TEMP: runnerTemp, GITHUB_STEP_SUMMARY: summary,
  });
  return { ...run, summary: readFileSync(summary, 'utf8') };
}

test('tests step: the counts go to the run\'s summary page and the full output stays in the log', { skip: NO_BASH }, (t) => {
  const output = `✔ formatDuration renders hours (4.7ms)\n${totals({ tests: 312, pass: 311, fail: 0, skipped: 1 })}`;
  const run = testsStep(t, output, 0);
  assert.equal(run.status, 0, run.output);
  assert.deepEqual(run.calls, ['npm test']);
  assert.ok(run.output.includes('✔ formatDuration renders hours'), 'the log keeps every test');
  assert.match(run.summary, /^### ✅ Tests passed$/m);
  assert.match(run.summary, /^`npm test`: 311 passed, 0 failed, 1 skipped, 312 in all\.$/m);
});

test('tests step: failed tests are named once on the summary page, and the step fails before the dry run', { skip: NO_BASH }, (t) => {
  const failing = '✖ breaks on purpose (0.8ms)';
  const output = `✔ passes (1.0ms)\n${failing}\n${totals({ tests: 2, pass: 1, fail: 1, skipped: 0 })}`
    + `✖ failing tests:\n\ntest at a.test.mjs:4:1\n${failing}\n  AssertionError [ERR_ASSERTION]: 1 !== 2\n`;
  const run = testsStep(t, output, 1);
  assert.equal(run.status, 1);
  assert.match(run.summary, /^### ❌ Tests failed$/m);
  assert.match(run.summary, /^`npm test`: 1 passed, 1 failed, 0 skipped, 2 in all\.$/m);
  assert.deepEqual(run.summary.match(/^- .+$/gm), ['- breaks on purpose']);
});

test('tests step: a run that printed no totals says so instead of empty counts', { skip: NO_BASH }, (t) => {
  const run = testsStep(t, 'npm ERR! missing script: test\n', 1);
  assert.equal(run.status, 1);
  assert.match(run.summary, /^### ❌ Tests failed$/m);
  assert.match(run.summary, /printed no totals/);
  assert.doesNotMatch(run.summary, / passed, /);
});

// --- One release per repository, tags kept ----------------------------------------------------

test('the old releases go only after the new one exists, and no tag is ever deleted', () => {
  const names = stepNames('publish');
  assert.ok(names.indexOf(KEEP_STEP) > names.indexOf(CREATE_STEP));
  assert.match(script(step('publish', KEEP_STEP)), /gh release delete "\$old" --yes/);
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

const keep = (t, env) => runStep(t, 'publish', KEEP_STEP, { gh: KEEP_GH }, env);
const deletions = (run) => run.calls.filter((call) => call.startsWith('gh release delete '));

test('keep step: the new release is the latest, so every older release goes and the tags stay', { skip: NO_BASH }, (t) => {
  const run = keep(t, { TAG: 'v0.1.5', GH_LATEST: 'v0.1.5', GH_RELEASES: 'v0.1.5 v0.1.4 v0.1.3' });
  assert.equal(run.status, 0, run.output);
  assert.deepEqual(deletions(run), ['gh release delete v0.1.4 --yes', 'gh release delete v0.1.3 --yes']);
});

test('keep step: when the new release is not the latest, nothing is deleted', { skip: NO_BASH }, (t) => {
  const run = keep(t, { TAG: 'v0.1.3', GH_LATEST: 'v0.1.5', GH_RELEASES: 'v0.1.5 v0.1.3' });
  assert.equal(run.status, 0, run.output);
  assert.deepEqual(deletions(run), []);
  assert.match(run.output, /not v0\.1\.3/);
});

test('keep step: a lone release deletes nothing', { skip: NO_BASH }, (t) => {
  const run = keep(t, { TAG: 'v0.1.5', GH_LATEST: 'v0.1.5', GH_RELEASES: 'v0.1.5' });
  assert.equal(run.status, 0, run.output);
  assert.deepEqual(deletions(run), []);
});
