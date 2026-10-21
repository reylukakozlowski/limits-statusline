// Contract of .github/workflows/release.yml and of master's rulesets (.github/rulesets/master-*.json):
// who may release, that the approval comes before anything runs and every run then makes the dry
// run and the checks before it tags, that a release is a tag and makes no commit, branch or pull
// request, that only the promote job holds the deploy key and moves master, only forward and only
// to the tagged commit, and that a dry run publishes nothing.
// The workflow is read as text (the repository has no YAML parser), and the checks pin the lines
// a careless edit would break. The scripts of the steps that touch GitHub also run for real in
// bash, against stand-ins for git and gh.

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
const AUTHOR_STEP = "Tag as the repository's author";
const TAG_STEP = "Test and tag develop's head";
const PROMOTE_STEP = 'Fast-forward master to the release commit';
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

test('the workflow is called Release and starts only by hand; its one input is the dry run, the version is plugin.json\'s', () => {
  assert.match(WORKFLOW, /^name: Release$/m);
  const triggers = WORKFLOW.slice(WORKFLOW.indexOf('\non:\n'), WORKFLOW.indexOf('\npermissions:'));
  assert.deepEqual(triggers.match(/^ {2}[\w-]+:/gm), ['  workflow_dispatch:']);
  assert.deepEqual(triggers.match(/^ {6}[\w-]+:$/gm), ['      dry_run:']);
  assert.doesNotMatch(WORKFLOW, /inputs\.(bump|version)\b/);
});

test('each run is named by what it does, so a dry run never looks like a release', () => {
  const runName = /^run-name: (.+)$/m.exec(WORKFLOW);
  assert.ok(runName, 'run-name');
  for (const word of ["'Dry run'", "'Release'", 'inputs.dry_run']) assert.ok(runName[1].includes(word), word);
});

test('four jobs in a chain: CI behind the release approval, then tag, promote behind production, publish', () => {
  assert.deepEqual(JOBS.match(/^ {2}[\w-]+(?=:$)/gm).map((name) => name.trim()), ['ci', 'tag', 'promote', 'publish']);
  assert.match(job('ci'), /^ {4}environment: release$/m);
  assert.match(job('promote'), /^ {4}environment: production$/m);
  assert.equal(WORKFLOW.match(/^\s+environment:/gm).length, 2, 'tag and publish run in no environment');
  assert.match(job('tag'), /^ {4}needs: \[ci\]$/m);
  assert.match(job('promote'), /^ {4}needs: \[tag\]$/m);
  assert.match(job('publish'), /^ {4}needs: \[tag, promote\]$/m);
  // The graph on the run's page says which part is CI and which CD.
  const names = ['ci', 'tag', 'promote', 'publish'].map((name) => /^ {4}name: '(.+)'$/m.exec(job(name))?.[1]);
  assert.deepEqual(names, ['CI: tests and checks', 'CD: tag', 'CD: master', 'CD: GitHub release']);
});

test('the approval comes before anything runs: every job that waits for no other is behind the release environment', () => {
  const first = JOBS.match(/^ {2}[\w-]+(?=:$)/gm).map((name) => name.trim()).filter((name) => !/^ {4}needs:/m.test(job(name)));
  assert.deepEqual(first, ['ci']);
  assert.match(job('ci'), /^ {4}environment: release$/m);
});

test('only the repository owner, on develop, gets any job: GitHub skips anyone else before an approval', () => {
  for (const name of ['ci', 'tag', 'promote', 'publish']) {
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
  const dryRun = step('ci', DRY_RUN_STEP);
  assert.match(dryRun, /^ {8}run: node scripts\/release\.mjs --dry-run$/m);
  const preflight = step('ci', PREFLIGHT_STEP);
  assert.match(preflight, /^ {10}GH_TOKEN: \$\{\{ github\.token \}\}$/m);
  assert.match(preflight, /^ {8}run: node scripts\/release-preflight\.mjs$/m);
  // Every check runs and a failed one fails CI, so the tag job never starts.
  assert.doesNotMatch(job('ci'), /^ {8}(if|continue-on-error):/m);
});

test('CI reads and writes nothing else: a read-only token, no credentials kept, no secret', () => {
  const ci = job('ci');
  assert.match(ci, /^ {4}permissions:\n {6}contents: read\n {6}actions: read # .+\n {4}\S/m);
  assert.match(ci, /^ {10}persist-credentials: false$/m);
  assert.doesNotMatch(ci, /secrets\.|git push|git tag|gh release/);
});

test('a dry run is CI alone: it tags nothing, never enters production and publishes nothing', () => {
  assert.doesNotMatch(guard('ci'), /dry_run/);
  for (const name of ['tag', 'promote', 'publish']) assert.ok(guard(name).endsWith('&& !inputs.dry_run'), name);
  assert.deepEqual(stepNames('tag'), [AUTHOR_STEP, TAG_STEP]);
  assert.deepEqual(stepNames('promote'), [PROMOTE_STEP]);
  assert.deepEqual(stepNames('publish'), [NOTES_STEP, CREATE_STEP, KEEP_STEP]);
});

test('the tag step runs the release script and hands on only the tag it prints', () => {
  const tag = step('tag', TAG_STEP);
  assert.match(tag, /^ {8}id: tag$/m);
  // An assignment, not `echo "tag=$(...)"`: under bash -e a failing script then fails the step.
  assert.equal(script(tag).trimEnd(), 'tag="$(node scripts/release.mjs --push)"\necho "tag=$tag" >> "$GITHUB_OUTPUT"');
  assert.match(job('tag'), /^ {4}outputs:\n {6}tag: \$\{\{ steps\.tag\.outputs\.tag \}\}\n/m);
  for (const [jobName, stepName] of [['promote', PROMOTE_STEP], ['publish', NOTES_STEP], ['publish', CREATE_STEP], ['publish', KEEP_STEP]]) {
    assert.match(step(jobName, stepName), /^ {10}TAG: \$\{\{ needs\.tag\.outputs\.tag \}\}$/m, stepName);
  }
});

test('a release is only a tag: the workflow makes no commit, no branch and no pull request', () => {
  assert.doesNotMatch(WORKFLOW, /gh pr |git commit|git switch|git checkout|git branch|release\/v|pull-requests:/);
  assert.doesNotMatch(WORKFLOW, /--force|force=true|\+refs|git push [^\n]*--delete/);
});

test('each job gets only the token permissions it uses, and one release runs at a time', () => {
  assert.match(WORKFLOW, /^permissions: \{\}$/m);
  assert.match(job('tag'), /^ {4}permissions:\n {6}contents: write\n {4}\S/m);
  assert.match(job('promote'), /^ {4}permissions:\n {6}contents: read\n {4}\S/m);
  assert.match(job('publish'), /^ {4}permissions:\n {6}contents: write\n {4}\S/m);
  assert.match(WORKFLOW, /^concurrency:\n {2}group: release\n {2}cancel-in-progress: false$/m);
});

test('the tag job pushes with its own GITHUB_TOKEN and tags as the repository\'s author', () => {
  const tag = job('tag');
  assert.match(tag, /fetch-depth: 0/);
  assert.doesNotMatch(tag, /^ {10}(token|ssh-key):/m);
  assert.match(tag, /git config user\.email '27358836\+Reywedian@users\.noreply\.github\.com'/);
});

test('only the promote job holds the deploy key, checked out from develop with every branch and tag', () => {
  // The workflow names one secret, once: the deploy key, in the promote job's checkout.
  assert.deepEqual(WORKFLOW.match(/secrets\.\w+/g), ['secrets.PRODUCTION_DEPLOY_KEY']);
  const checkout = job('promote').slice(0, job('promote').indexOf(`      - name: ${PROMOTE_STEP}\n`));
  assert.match(checkout, /^ {6}- uses: actions\/checkout@/m);
  assert.match(checkout, /^ {10}ref: develop$/m);
  assert.match(checkout, /^ {10}fetch-depth: 0 /m);
  assert.match(checkout, /^ {10}ssh-key: \$\{\{ secrets\.PRODUCTION_DEPLOY_KEY \}\}$/m);
  assert.match(job('publish'), /^ {10}persist-credentials: false$/m);
});

test('no other workflow names the production environment or its key', () => {
  for (const file of readdirSync(WORKFLOWS).filter((name) => name !== 'release.yml')) {
    assert.doesNotMatch(readFileSync(new URL(file, WORKFLOWS), 'utf8'), /production|PRODUCTION_DEPLOY_KEY/i, file);
  }
});

test('every action is pinned to a full commit SHA', () => {
  const uses = WORKFLOW.match(/^ +(?:- )?uses: .+$/gm).map((line) => line.replace(/^ +(?:- )?/, ''));
  assert.equal(uses.length, 6);
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

// git for the promote step: the tag is commit 7a9; MASTER says whether origin/master exists, and
// ANCESTRY lists the `A>B` pairs for which `merge-base --is-ancestor A B` succeeds.
const PROMOTE_GIT = [
  '#!/usr/bin/env bash',
  'echo "git $*" >> "$STUB_LOG"',
  'case "$1" in',
  '  rev-parse) if [ "$2" = --quiet ]; then [ -n "$MASTER" ]; exit; fi; echo 7a9 ;;',
  '  fetch|push) ;;',
  '  merge-base) case " $ANCESTRY " in *" $3>$4 "*) exit 0 ;; *) exit 1 ;; esac ;;',
  '  *) exit 64 ;;',
  'esac',
];

const promote = (t, env) => runStep(t, 'promote', PROMOTE_STEP, { git: PROMOTE_GIT }, { TAG: 'v1.0.3', MASTER: 'yes', ...env });
const pushes = (run) => run.calls.filter((call) => call.startsWith('git push'));

test('promote step: master behind the tag moves forward to exactly the tagged commit, without force', { skip: NO_BASH }, (t) => {
  const run = promote(t, { ANCESTRY: '7a9>origin/develop origin/master>7a9' });
  assert.equal(run.status, 0, run.output);
  assert.ok(run.calls.includes('git fetch --quiet origin refs/tags/v1.0.3:refs/tags/v1.0.3'));
  assert.ok(run.calls.includes('git rev-parse v1.0.3^{commit}'));
  assert.deepEqual(pushes(run), ['git push origin 7a9:refs/heads/master']);
  assert.match(run.output, /master is at v1\.0\.3 \(7a9\)/);
});

test('promote step: the first release creates master', { skip: NO_BASH }, (t) => {
  const run = promote(t, { MASTER: '', ANCESTRY: '7a9>origin/develop' });
  assert.equal(run.status, 0, run.output);
  assert.deepEqual(pushes(run), ['git push origin 7a9:refs/heads/master']);
});

test('promote step: a tag that is not on develop never reaches master', { skip: NO_BASH }, (t) => {
  const run = promote(t, { ANCESTRY: 'origin/master>7a9' });
  assert.equal(run.status, 1);
  assert.deepEqual(pushes(run), []);
  assert.match(run.output, /::error::v1\.0\.3 is not on develop/);
});

test('promote step: a master that already holds the tag stays where it is', { skip: NO_BASH }, (t) => {
  const run = promote(t, { ANCESTRY: '7a9>origin/develop 7a9>origin/master' });
  assert.equal(run.status, 0, run.output);
  assert.deepEqual(pushes(run), []);
  assert.match(run.output, /master already holds v1\.0\.3/);
});

test('promote step: a master with commits the tag lacks is never overwritten', { skip: NO_BASH }, (t) => {
  const run = promote(t, { ANCESTRY: '7a9>origin/develop' });
  assert.equal(run.status, 1);
  assert.deepEqual(pushes(run), []);
  assert.match(run.output, /::error::master has commits that v1\.0\.3 lacks/);
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
