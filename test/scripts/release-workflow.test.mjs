// Contract of .github/workflows/release.yml: who may release, and from where (develop, by the
// owner; any other run is refused by a job of its own), that the owner approves before any step of
// the release runs, that the job that runs the repository's code holds no credentials, that only
// the promote job holds the deploy key and pushes nothing but the release commit the merge job
// tested, a merge of develop into master, and that the form asks for the part to raise and an
// optional note, nothing else. The release script itself runs against real git in
// release.integration.test.mjs.
// The workflow is read as text (the repository has no YAML parser), and the checks pin the lines
// a careless edit would break. The scripts of the steps also run for real in bash: the promote
// job's checks against real git and the real gh (with a local stand-in for GitHub's API), the
// others with stand-ins for gh.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { delimiter, join } from 'node:path';
import { runRelease } from '../../scripts/lib/release-cli.mjs';
import { withManifestVersion } from '../../scripts/lib/release-lib.mjs';

// CRLF from a clone with core.autocrlf would otherwise defeat every line pattern below.
const read = (path) => readFileSync(new URL(path, import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const WORKFLOWS = new URL('../../.github/workflows/', import.meta.url);
const WORKFLOW = read('../../.github/workflows/release.yml');
const JOBS = WORKFLOW.slice(WORKFLOW.indexOf('\njobs:\n'));

const REFUSE_STEP = 'Say why nothing is released';
const APPROVAL_STEP = "Record the owner's approval";
const NOTE_STEP = 'Check the note';
const AUTHOR_STEP = "Commit and tag as the repository's author";
const RELEASE_STEP = 'Merge develop into master, test it and tag it';
const BUNDLE_STEP = 'Bundle the release commit and its tag';
const APPROVED_STEP = 'Check that the owner approved this run';
const PROMOTE_STEP = 'Check the release commit and push it and its tag';
const NOTES_STEP = 'Take the release notes from the tag';
const CREATE_STEP = 'Create the GitHub release unless it exists';
const KEEP_STEP = 'Keep only the latest release, tags stay';
const JOB_NAMES = ['refuse', 'approval', 'merge', 'promote', 'publish'];
const RELEASE_JOBS = JOB_NAMES.filter((name) => name !== 'refuse');

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

/** A job's `uses:` step with the given action, up to the next step. */
const action = (jobName, name) => {
  const body = job(jobName);
  const start = body.search(new RegExp(`^ {6}- uses: actions/${name}@`, 'm'));
  assert.ok(start !== -1, `${jobName} uses ${name}`);
  const rest = body.slice(start + 1);
  const next = rest.search(/^ {6}(- |# )/m);
  return next === -1 ? rest : rest.slice(0, next);
};

// --- The form and the run --------------------------------------------------------------------

test('the workflow is called Release and starts only by hand, from a form of two fields: the part to raise and a note', () => {
  assert.match(WORKFLOW, /^name: Release$/m);
  const triggers = WORKFLOW.slice(WORKFLOW.indexOf('\non:\n'), WORKFLOW.indexOf('\npermissions:'));
  assert.deepEqual(triggers.match(/^ {2}[\w-]+:/gm), ['  workflow_dispatch:']);
  // The owner's decision, word for word: exactly these two inputs, nothing else.
  assert.equal(triggers.slice(triggers.indexOf('    inputs:\n')).trimEnd(), [
    '    inputs:',
    '      bump:',
    '        description: Version part to raise',
    '        type: choice',
    '        options: [patch, minor, major]',
    '        default: patch',
    '      notes:',
    '        description: Release note, optional - one line, at most 500 characters',
    '        type: string',
    '        required: false',
  ].join('\n'));
});

test('each run is listed as Release and the part it raises', () => {
  assert.match(WORKFLOW, /^run-name: Release \$\{\{ inputs\.bump \}\}$/m);
});

test('five jobs: refuse, then the owner\'s approval, the merge and its tests, master behind production, the GitHub release', () => {
  assert.deepEqual(JOBS.match(/^ {2}[\w-]+(?=:$)/gm).map((name) => name.trim()), JOB_NAMES);
  // The graph on the run's page reads in the order the jobs run.
  const names = JOB_NAMES.map((name) => /^ {4}name: (.+)$/m.exec(job(name))?.[1]);
  assert.deepEqual(names, ['Refuse', 'Approval', 'Merge and test', 'Push to master', 'GitHub release']);
});

test('approval comes first: no job waits for nothing but refuse and approval, and each release job waits for the one before', () => {
  assert.deepEqual(JOB_NAMES.filter((name) => !/^ {4}needs:/m.test(job(name))), ['refuse', 'approval']);
  assert.match(job('merge'), /^ {4}needs: \[approval\]$/m);
  assert.match(job('promote'), /^ {4}needs: \[merge\]$/m);
  assert.match(job('publish'), /^ {4}needs: \[promote\]$/m);
});

const OWNER_ON_DEVELOP = [
  "github.event_name == 'workflow_dispatch'",
  "github.ref == 'refs/heads/develop'",
  'github.actor_id == github.repository_owner_id',
  'github.triggering_actor == github.repository_owner',
];

test('only the repository owner, on develop, gets a release job: GitHub skips them for anyone else', () => {
  for (const name of RELEASE_JOBS) {
    assert.equal(guard(name), OWNER_ON_DEVELOP.join(' && '), name);
  }
  assert.doesNotMatch(WORKFLOW, /'refs\/heads\/master'/, 'a run on master is refused like any other branch');
});

test('refuse runs exactly when the release jobs do not: the same four facts, turned round', () => {
  assert.equal(guard('refuse'), OWNER_ON_DEVELOP.map((fact) => fact.replace(' == ', ' != ')).join(' || '));
  assert.deepEqual(stepNames('refuse'), [REFUSE_STEP]);
  assert.doesNotMatch(job('refuse'), /uses:|secrets\.|environment:/);
});

test('the owner approves in the environment release, before any step of the release runs', () => {
  const approval = job('approval');
  assert.match(approval, /^ {4}environment: release$/m);
  // Its one step only records the approval: nothing is checked out, no token, no secret.
  assert.deepEqual(stepNames('approval'), [APPROVAL_STEP]);
  assert.doesNotMatch(approval, /uses:|secrets\.|token|git /);
  assert.deepEqual([...WORKFLOW.matchAll(/^ {4}environment: (.+)$/gm)].map((match) => match[1]), ['release', 'production']);
  assert.match(job('promote'), /^ {4}environment: production$/m);
});

test('each job gets only the token permissions it uses, and one release runs at a time', () => {
  assert.match(WORKFLOW, /^permissions: \{\}$/m);
  assert.match(job('refuse'), /^ {4}permissions: \{\}$/m);
  assert.match(job('approval'), /^ {4}permissions: \{\}$/m);
  // The promote job pushes with the deploy key, and its token reads the run's approvals; no token
  // but publish's writes.
  assert.match(job('merge'), /^ {4}permissions:\n {6}contents: read\n {4}\S/m);
  assert.match(job('promote'), /^ {4}permissions:\n {6}actions: read # the run's approvals\n {6}contents: read\n {4}\S/m);
  assert.match(job('publish'), /^ {4}permissions:\n {6}contents: write\n {4}\S/m);
  assert.match(WORKFLOW, /^concurrency:\n {2}group: release\n {2}cancel-in-progress: false$/m);
});

// --- merge ----------------------------------------------------------------------------------------

test('the merge job checks the note first, before anything is fetched, counting characters', () => {
  assert.deepEqual(stepNames('merge'), [NOTE_STEP, AUTHOR_STEP, RELEASE_STEP, BUNDLE_STEP]);
  assert.ok(job('merge').indexOf(`- name: ${NOTE_STEP}`) < job('merge').indexOf('- uses: actions/checkout@'));
  const note = step('merge', NOTE_STEP);
  assert.match(note, /^ {10}NOTES: \$\{\{ inputs\.notes \}\}$/m);
  assert.match(note, /^ {10}LC_ALL: C\.UTF-8$/m);
});

test('the merge job runs the repository\'s code at the run\'s commit with no credentials, and commits as the repository\'s author', () => {
  const merge = job('merge');
  const checkout = action('merge', 'checkout');
  // The run's commit, develop when the owner clicked, never develop's tip fetched later.
  assert.match(checkout, /^ {10}ref: \$\{\{ github\.sha \}\}$/m);
  assert.match(checkout, /^ {10}fetch-depth: 0 # .+$/m);
  assert.match(checkout, /^ {10}persist-credentials: false$/m);
  assert.doesNotMatch(merge, /secrets\.|ssh-key|token|environment:|git push/);
  assert.match(merge, /git config user\.name 'Reywedian'/);
  assert.match(merge, /git config user\.email '27358836\+Reywedian@users\.noreply\.github\.com'/);
});

test('the release step runs the release script with the part to raise and the note, and hands on the tag and its commit', () => {
  const release = step('merge', RELEASE_STEP);
  assert.match(release, /^ {8}id: release$/m);
  assert.match(release, /^ {10}BUMP: \$\{\{ inputs\.bump \}\}$/m);
  assert.match(release, /^ {10}NOTES: \$\{\{ inputs\.notes \}\}$/m);
  // Assignments, not `echo "tag=$(...)"`: under bash -e a failing script then fails the step.
  assert.equal(script(release).trimEnd(), [
    'tag="$(node scripts/release.mjs "$BUMP")"',
    'commit="$(git rev-parse "refs/tags/$tag^{commit}")"',
    'echo "tag=$tag" >> "$GITHUB_OUTPUT"',
    'echo "commit=$commit" >> "$GITHUB_OUTPUT"',
  ].join('\n'));
  assert.match(job('merge'), /^ {4}outputs:\n {6}tag: \$\{\{ steps\.release\.outputs\.tag \}\}\n {6}commit: \$\{\{ steps\.release\.outputs\.commit \}\}\n/m);
});

test('the release commit and its tag reach the promote job as a git bundle, kept for a day', () => {
  const bundle = step('merge', BUNDLE_STEP);
  assert.match(bundle, /^ {10}TAG: \$\{\{ steps\.release\.outputs\.tag \}\}$/m);
  assert.match(bundle, /^ {8}run: git bundle create release\.bundle "refs\/tags\/\$TAG"$/m);
  const upload = action('merge', 'upload-artifact');
  for (const line of ['name: release', 'path: release.bundle', 'if-no-files-found: error', 'retention-days: 1']) {
    assert.match(upload, new RegExp(`^ {10}${line.replace('.', '\\.')}$`, 'm'), line);
  }
  const download = action('promote', 'download-artifact');
  assert.match(download, /^ {10}name: release$/m);
  assert.match(download, /^ {10}path: \$\{\{ runner\.temp \}\}$/m);
});

// --- promote and publish ----------------------------------------------------------------------

test('only the promote job holds the deploy key, and it runs none of the repository\'s code: only the check and git', () => {
  // The workflow names one secret, once: the deploy key, in the promote job's checkout.
  assert.deepEqual(WORKFLOW.match(/secrets\.\w+/g), ['secrets.PRODUCTION_DEPLOY_KEY']);
  const checkout = action('promote', 'checkout');
  assert.match(checkout, /^ {10}fetch-depth: 0$/m);
  assert.match(checkout, /^ {10}ssh-key: \$\{\{ secrets\.PRODUCTION_DEPLOY_KEY \}\}$/m);
  assert.doesNotMatch(job('promote'), /setup-node|\bnode |\bnpm |scripts\//);
  assert.deepEqual(stepNames('promote'), [APPROVED_STEP, PROMOTE_STEP]);
  // Only the promote job pushes, after its check.
  for (const name of ['refuse', 'approval', 'merge', 'publish']) assert.doesNotMatch(job(name), /git push/, name);
  assert.match(job('publish'), /^ {10}persist-credentials: false$/m);
});

// SKILL.md §5 of sealoop-workflow (a public repository): the job that pushes master first checks
// the run's approvals, since a deleted environment comes back without its reviewer.
test('the promote job first asks GitHub whether the owner approved this run in the approval job\'s environment, before the deploy key is checked out', () => {
  const promote = job('promote');
  assert.equal(stepNames('promote')[0], APPROVED_STEP);
  assert.ok(promote.indexOf(`- name: ${APPROVED_STEP}`) < promote.indexOf('- uses: actions/checkout@'));
  const check = step('promote', APPROVED_STEP);
  for (const line of [
    'REPOSITORY: ${{ github.repository }}', 'RUN_ID: ${{ github.run_id }}', 'OWNER: ${{ github.repository_owner }}', 'GH_TOKEN: ${{ github.token }}',
  ]) {
    assert.ok(check.includes(`\n          ${line}\n`), line);
  }
  assert.match(script(check), /gh api "repos\/\$REPOSITORY\/actions\/runs\/\$RUN_ID\/approvals"/);
  const environment = /^ {4}environment: (.+)$/m.exec(job('approval'))[1];
  assert.ok(script(check).includes(`.name == "${environment}"`), 'the environment the owner approves in');
});

test('the promote job checks what the merge job tested against the run\'s own commit, and pushes the tag and master at once', () => {
  const promote = step('promote', PROMOTE_STEP);
  assert.match(promote, /^ {8}id: promote$/m);
  assert.match(promote, /^ {10}TAG: \$\{\{ needs\.merge\.outputs\.tag \}\}$/m);
  assert.match(promote, /^ {10}COMMIT: \$\{\{ needs\.merge\.outputs\.commit \}\}$/m);
  assert.match(promote, /^ {10}SHA: \$\{\{ github\.sha \}\}$/m);
  // The owner's note from the form itself, never the merge job's word for it.
  assert.match(promote, /^ {10}NOTES: \$\{\{ inputs\.notes \}\}$/m);
  assert.match(script(promote), /^git push --atomic origin "refs\/tags\/\$TAG" "\$sha:refs\/heads\/master"$/m);
  assert.match(job('promote'), /^ {4}outputs:\n {6}tag: \$\{\{ steps\.promote\.outputs\.tag \}\}\n/m);
});

test('the GitHub release is made from the tag the promote job checked and pushed, never from the merge job\'s word', () => {
  for (const stepName of [NOTES_STEP, CREATE_STEP, KEEP_STEP]) {
    assert.match(step('publish', stepName), /^ {10}TAG: \$\{\{ needs\.promote\.outputs\.tag \}\}$/m, stepName);
  }
  assert.doesNotMatch(job('publish'), /needs\.merge\./);
  assert.deepEqual(stepNames('publish'), [NOTES_STEP, CREATE_STEP, KEEP_STEP]);
});

test('the release notes are the body of the annotated tag, and the new release is marked Latest', () => {
  assert.match(step('publish', NOTES_STEP), /git tag --list --format='%\(contents:body\)' "\$TAG" > "\$RUNNER_TEMP\/release-notes\.md"/);
  const create = script(step('publish', CREATE_STEP));
  assert.match(create, /gh release create "\$TAG" --title "\$TAG" --notes-file "\$RUNNER_TEMP\/release-notes\.md" --verify-tag --latest/);
  assert.match(create, /if gh release view "\$TAG"/);
});

test('the old releases go only after the new one is the latest, and no tag is ever deleted', () => {
  const names = stepNames('publish');
  assert.ok(names.indexOf(KEEP_STEP) > names.indexOf(CREATE_STEP));
  assert.match(script(step('publish', KEEP_STEP)), /gh release delete "\$old" --yes/);
  assert.doesNotMatch(WORKFLOW, /--cleanup-tag|git\/refs\/tags/);
});

// --- The whole file -----------------------------------------------------------------------------

// The release commit is made by scripts/release.mjs (git commit-tree), never by a step of its own.
test('the workflow opens no pull request, makes no branch and never forces or deletes a ref', () => {
  assert.doesNotMatch(WORKFLOW, /gh pr |git commit|git switch|git checkout|git branch|release\/v|pull-requests:/);
  assert.doesNotMatch(WORKFLOW, /--force|force=true|\+refs|git push [^\n]*--delete/);
});

test('no other workflow names the production environment or its key', () => {
  for (const file of readdirSync(WORKFLOWS).filter((name) => name !== 'release.yml')) {
    assert.doesNotMatch(readFileSync(new URL(file, WORKFLOWS), 'utf8'), /production|PRODUCTION_DEPLOY_KEY/i, file);
  }
});

test('every action is pinned to a full commit SHA', () => {
  const uses = WORKFLOW.match(/^ +(?:- )?uses: .+$/gm).map((line) => line.replace(/^ +(?:- )?/, ''));
  // checkout in merge, promote and publish; setup-node in merge; the bundle's upload and download.
  assert.equal(uses.length, 6);
  for (const line of uses) assert.match(line, /^uses: [\w.-]+\/[\w.-]+@[0-9a-f]{40} # v\d+\.\d+\.\d+$/, line);
});

test('expressions sit only in YAML values, never inside a shell script: the inputs reach the scripts through env', () => {
  const lines = WORKFLOW.split('\n').filter((line) => line.includes('${{') && !line.startsWith('run-name: '));
  assert.ok(lines.length > 0);
  for (const line of lines) assert.match(line, /^\s*(?!run:)[\w-]+: \$\{\{ .+ \}\}$/, line);
  // The inputs only in a step's env (and the run's name, a YAML value too).
  for (const line of lines.filter((text) => text.includes('inputs.'))) {
    assert.match(line, /^ {10}[A-Z_]+: \$\{\{ inputs\.(bump|notes) \}\}$/, line);
  }
});

test('the workflow installs nothing: the repository has no dependencies', () => {
  assert.doesNotMatch(WORKFLOW, /npm (ci|install)/);
});

// --- Steps run in bash ----------------------------------------------------------------------------

// GitHub runs a `run:` script with bash on Linux. On Windows the bash on PATH may be missing or
// WSL's; Git for Windows' own bash sits at <git --exec-path>/../../../bin/bash.exe.
const BASH = (() => {
  if (process.platform === 'win32') {
    const execPath = spawnSync('git', ['--exec-path'], { encoding: 'utf8' }).stdout?.trim();
    const gitBash = execPath && join(execPath, '..', '..', '..', 'bin', 'bash.exe');
    if (gitBash && existsSync(gitBash)) return gitBash;
  }
  return 'bash';
})();
const HAS_BASH = (() => {
  const probe = spawnSync(BASH, ['--version']);
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
  const result = spawnSync(BASH, ['-e', '-c', `${standInsFirst}\n${script(step(jobName, stepName))}`], {
    encoding: 'utf8',
    env: { ...process.env, [pathKey]: `${dir}${delimiter}${process.env[pathKey]}`, STUB_DIR: dir, STUB_LOG: log, ...env },
  });
  const calls = readFileSync(log, 'utf8').split('\n').filter(Boolean);
  return { status: result.status, output: `${result.stdout}${result.stderr}`, calls };
}

test('refuse step: it fails and names the run it refused and who may release', { skip: NO_BASH }, (t) => {
  const run = runStep(t, 'refuse', REFUSE_STEP, {}, { EVENT: 'workflow_dispatch', REF: 'refs/heads/master', ACTOR: 'reylukakozlowski', OWNER: 'reylukakozlowski' });
  assert.equal(run.status, 1, run.output);
  assert.match(run.output, /^::error::A release is started by reylukakozlowski from Actions → Release → Run workflow, on develop\. /m);
  assert.match(run.output, /This run \(workflow_dispatch on refs\/heads\/master by reylukakozlowski\) releases nothing\./);
});

/** The note step with the env its YAML sets. */
const noteStep = (t, notes) => runStep(t, 'merge', NOTE_STEP, {}, { NOTES: notes, LC_ALL: 'C.UTF-8' });

test('note step: no note, and a note of exactly 500 characters, pass', { skip: NO_BASH }, (t) => {
  for (const notes of ['', 'a'.repeat(500)]) {
    const run = noteStep(t, notes);
    assert.equal(run.status, 0, run.output);
  }
  assert.match(noteStep(t, '').output, /^The note: none$/m);
});

test('note step: 501 characters are one too many', { skip: NO_BASH }, (t) => {
  const run = noteStep(t, 'a'.repeat(501));
  assert.equal(run.status, 1, run.output);
  assert.match(run.output, /^::error::The note has 501 characters, more than 500\.$/m);
});

// A letter of two bytes in UTF-8 (z with a dot above, as in many owners' language).
const TWO_BYTES = '\u017c';
// Under C.UTF-8 bash counts characters; this bash may lack the locale (macOS has none of that name).
const COUNTS_CHARACTERS = HAS_BASH
  && spawnSync(BASH, ['-c', 'printf %s "${#X}"'], { encoding: 'utf8', env: { ...process.env, LC_ALL: 'C.UTF-8', X: TWO_BYTES.repeat(2) } }).stdout === '2';

test('note step: characters are counted, not bytes: 500 two-byte letters pass, 501 do not', { skip: NO_BASH || (!COUNTS_CHARACTERS && 'this bash has no C.UTF-8 locale') }, (t) => {
  assert.equal(noteStep(t, TWO_BYTES.repeat(500)).status, 0, '1000 bytes, 500 characters');
  assert.equal(noteStep(t, TWO_BYTES.repeat(501)).status, 1);
});

test('note step: a note of more than one line is refused, whichever line break it has', { skip: NO_BASH }, (t) => {
  for (const notes of ['First line\nsecond line', 'First line\r\nsecond line', 'First line\rsecond line', 'trailing break\n']) {
    const run = noteStep(t, notes);
    assert.equal(run.status, 1, JSON.stringify(notes));
    assert.match(run.output, /^::error::The note has more than one line: give it on one line\.$/m);
  }
});

// --- The promote job's approval check, through the real gh ----------------------------------------

// gh sends the requests for its development host github.localhost to http://api.github.localhost/,
// and so through HTTP_PROXY: a server of the test's own answers there in GitHub's place, and the
// real gh, with the jq inside it, runs the step as on the runner, without the network. GitHub's
// runners all have gh, so only a machine without it skips these tests.
const HAS_GH = (() => {
  const probe = spawnSync('gh', ['--version']);
  return !probe.error && probe.status === 0;
})();
const NO_GH = NO_BASH || (!HAS_GH && !process.env.CI && 'gh is not installed');
const OWNER = 'reylukakozlowski';
// The step's env, as its YAML sets it, for run 42 of this repository.
const RUN = { REPOSITORY: `${OWNER}/limits-statusline`, RUN_ID: '42', OWNER, GH_TOKEN: 'test-token' };

/**
 * One entry of GET /repos/{owner}/{repo}/actions/runs/{run_id}/approvals in the shape GitHub gave
 * for this repository's runs (run 39643105646 among them), with fewer of the user's and the
 * environments' fields.
 */
const review = ({ login = OWNER, state = 'approved', environments = ['release'] } = {}) => ({
  user: { login, id: login === OWNER ? 27358836 : 1000, type: 'User', site_admin: false },
  state,
  comment: '',
  environments: environments.map((name, index) => ({
    id: 24794919264 + index, name, url: `https://api.github.com/repos/${RUN.REPOSITORY}/environments/${name}`, can_admins_bypass: true,
  })),
});

/** The approval step in bash with the real gh, whose API answers every request with `status` and `body`. */
async function approvalCheck(t, body, { status = 200 } = {}) {
  const requests = [];
  const server = createServer((request, response) => {
    requests.push(`${request.method} ${request.url} ${request.headers.authorization}`);
    response.writeHead(status, { 'content-type': 'application/json' });
    response.end(JSON.stringify(body));
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => server.close());
  const config = mkdtempSync(join(tmpdir(), 'ls-release-gh-'));
  t.after(() => rmSync(config, { recursive: true, force: true }));
  const proxy = `http://127.0.0.1:${server.address().port}`;
  // Nothing of this machine's gh: its login, host, token and proxies stay out.
  const env = Object.fromEntries(Object.entries(process.env)
    .filter(([key]) => !/^(GH_|GITHUB_(ENTERPRISE_)?TOKEN$|(HTTPS?|NO|ALL)_PROXY$)/i.test(key)));
  const child = spawn(BASH, ['-e', '-c', script(step('promote', APPROVED_STEP))], {
    env: { ...env, GH_HOST: 'github.localhost', GH_CONFIG_DIR: config, GH_NO_UPDATE_NOTIFIER: '1', HTTP_PROXY: proxy, http_proxy: proxy, ...RUN },
  });
  let output = '';
  child.stdout.on('data', (chunk) => { output += chunk; });
  child.stderr.on('data', (chunk) => { output += chunk; });
  const code = await new Promise((resolve, reject) => {
    child.on('error', reject);
    child.on('close', resolve);
  });
  return { status: code, output, requests };
}

const APPROVED = [
  ['the owner\'s approval in release, as every approved run of this repository had', [review()]],
  ['the owner\'s approvals of production and of release, as run 39643105646 had', [review({ environments: ['production'] }), review()]],
  ['one approval of both environments', [review({ environments: ['production', 'release'] })]],
  ['a rejection, then the owner\'s approval of a run started again', [review({ state: 'rejected' }), review()]],
];

for (const [what, body] of APPROVED) {
  test(`approval check: ${what} lets the job go on`, { skip: NO_GH }, async (t) => {
    const run = await approvalCheck(t, body);
    assert.equal(run.status, 0, run.output);
    assert.match(run.output, /^reylukakozlowski approved this run in the environment release\.$/m);
    // This run's approvals, asked for with the job's token.
    assert.deepEqual(run.requests, [`GET http://api.github.localhost/repos/${RUN.REPOSITORY}/actions/runs/42/approvals token test-token`]);
  });
}

const UNAPPROVED = [
  ['no approval at all, as when release was deleted and came back without its reviewer', []],
  ['an approval by someone else', [review({ login: 'someone-else' })]],
  ['the owner\'s approval of production alone', [review({ environments: ['production'] })]],
  ['the owner\'s rejection', [review({ state: 'rejected' })]],
  ['an approval that names no environment', [{ ...review(), environments: [] }, { ...review(), environments: null }]],
];

for (const [what, body] of UNAPPROVED) {
  test(`approval check: ${what} stops the job before the deploy key is checked out`, { skip: NO_GH }, async (t) => {
    const run = await approvalCheck(t, body);
    assert.equal(run.status, 1, run.output);
    assert.match(run.output, /^::error::reylukakozlowski has not approved this run in the environment release \(Review deployments → Approve and deploy\)\. Nothing was pushed\.$/m);
    assert.doesNotMatch(run.output, /^reylukakozlowski approved/m);
  });
}

test('approval check: when GitHub does not list the run\'s approvals, the job stops', { skip: NO_GH }, async (t) => {
  const run = await approvalCheck(t, { message: 'Resource not accessible by integration' }, { status: 403 });
  assert.equal(run.status, 1, run.output);
  assert.match(run.output, /^::error::GitHub did not list this run's approvals\. Nothing was pushed\.$/m);
});

// --- The promote job's check, against real git ---------------------------------------------------

const MANIFEST = '.claude-plugin/plugin.json';
const DEVELOP_MANIFEST = '{\n  "name": "demo",\n  "displayName": "Demo"\n}\n';
const releaseManifest = (version) => `{\n  "name": "demo",\n  "version": "${version}",\n  "displayName": "Demo"\n}\n`;
const RELEASE_MANIFEST = releaseManifest('0.1.1');
// The release notes of develop's one commit after v0.1.0 in promoteRepository.
const NOTES = '- LS-2_feat: second';

const gitIn = (cwd, args, { input, env } = {}) => {
  const result = spawnSync('git', args, { cwd, input, encoding: 'utf8', env: { ...process.env, ...env } });
  assert.equal(result.status, 0, `git ${args.join(' ')}: ${result.stderr}`);
  return result.stdout.trim();
};

/**
 * origin with master at v0.1.0 on develop's first commit and develop one commit further; `builder`
 * is the merge job's clone, on develop, and the bundle goes where the promote job downloads it.
 * `head`, develop's head, is the run's commit.
 */
function promoteRepository(t) {
  const root = mkdtempSync(join(tmpdir(), 'ls-release-promote-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const origin = join(root, 'origin.git');
  const builder = join(root, 'builder');
  const runnerTemp = join(root, 'runner-temp');
  mkdirSync(runnerTemp);
  gitIn(root, ['init', '--quiet', '--bare', '--initial-branch=develop', origin]);
  gitIn(root, ['init', '--quiet', '--initial-branch=develop', builder]);
  // core.autocrlf off: Git for Windows turns it on, and the release checks its commit out to test it.
  for (const [key, value] of [
    ['user.name', 'Release Test'], ['user.email', 'release@example.com'], ['commit.gpgsign', 'false'], ['tag.gpgsign', 'false'],
    ['core.autocrlf', 'false'],
  ]) {
    gitIn(builder, ['config', key, value]);
  }
  mkdirSync(join(builder, '.claude-plugin'));
  writeFileSync(join(builder, MANIFEST), DEVELOP_MANIFEST);
  gitIn(builder, ['add', MANIFEST]);
  gitIn(builder, ['commit', '--quiet', '-m', 'LS-1_feat: first']);
  gitIn(builder, ['tag', '-a', 'v0.1.0', '-m', 'v0.1.0']);
  gitIn(builder, ['remote', 'add', 'origin', origin]);
  gitIn(builder, ['push', '--quiet', 'origin', 'HEAD:refs/heads/master']);
  writeFileSync(join(builder, 'a.txt'), 'second\n');
  gitIn(builder, ['add', 'a.txt']);
  gitIn(builder, ['commit', '--quiet', '-m', 'LS-2_feat: second']);
  gitIn(builder, ['push', '--quiet', '--follow-tags', 'origin', 'develop']);
  gitIn(builder, ['fetch', '--quiet', 'origin']);
  const head = gitIn(builder, ['rev-parse', 'HEAD']);
  const master = gitIn(builder, ['rev-parse', 'origin/master']);
  return { root, origin, builder, runnerTemp, head, master };
}

const bundle = (repo, tag) => gitIn(repo.builder, ['bundle', 'create', join(repo.runnerTemp, 'release.bundle'), `refs/tags/${tag}`]);

/** The merge job: the release commit and its tag from scripts/release.mjs, bundled. */
function buildRelease(repo, { note } = {}) {
  const out = [];
  const code = runRelease({
    argv: ['patch'],
    note,
    exec: (command, args) => (command === 'npm' ? { status: 0, stdout: '' } : (() => {
      const result = spawnSync(command, args, { cwd: repo.builder, encoding: 'utf8' });
      return { status: result.status ?? 1, stdout: result.stdout ?? '' };
    })()),
    readManifest: () => readFileSync(join(repo.builder, MANIFEST), 'utf8'),
    writeManifest: (text) => writeFileSync(join(repo.builder, MANIFEST), text),
    stdout: { write: (text) => out.push(text) },
    stderr: { write: () => {} },
  });
  assert.equal(code, 0);
  const tag = out.join('').trim();
  bundle(repo, tag);
  return tag;
}

/**
 * A commit made by hand in the builder, tagged and bundled. By default it is what the release script
 * makes of develop's head as v0.1.1, a merge into master (a lightweight tag when `annotation` is
 * null); each test changes one thing about it.
 */
function forgeRelease(repo, {
  tag = 'v0.1.1',
  source = repo.head,
  parents = [repo.master, source],
  files = { [MANIFEST]: releaseManifest(tag.slice(1)) },
  message = `Release ${tag}\n\n${NOTES}`,
  annotation = `${tag}\n\n${NOTES}`,
} = {}) {
  const env = { GIT_INDEX_FILE: join(repo.root, 'forge.index') };
  gitIn(repo.builder, ['read-tree', source], { env });
  for (const [path, text] of Object.entries(files)) {
    const blob = gitIn(repo.builder, ['hash-object', '-w', '--stdin'], { input: text });
    gitIn(repo.builder, ['update-index', '--add', '--cacheinfo', `100644,${blob},${path}`], { env });
  }
  const tree = gitIn(repo.builder, ['write-tree'], { env });
  const commit = gitIn(repo.builder, ['commit-tree', tree, ...parents.flatMap((parent) => ['-p', parent]), '-m', message]);
  gitIn(repo.builder, ['tag', ...(annotation === null ? [] : ['-a', '-m', annotation]), tag, commit]);
  bundle(repo, tag);
  return commit;
}

let promoters = 0;

/**
 * The promote job: a fresh clone of origin, as its checkout makes, then the check step in bash.
 * COMMIT, the merge job's word for the commit it tested, is the builder's tag's commit unless given;
 * SHA, the run's commit, is develop's head unless given; NOTES, the note in the form, is none.
 */
function promote(repo, tag, { commit, sha = repo.head, notes = '' } = {}) {
  promoters += 1;
  const promoter = join(repo.root, `promoter-${promoters}`);
  const outputs = join(repo.root, `outputs-${promoters}`);
  writeFileSync(outputs, '');
  const tested = commit ?? spawnSync('git', ['rev-parse', '--quiet', '--verify', `refs/tags/${tag}^{commit}`], { cwd: repo.builder, encoding: 'utf8' }).stdout.trim();
  gitIn(repo.root, ['clone', '--quiet', repo.origin, promoter]);
  const result = spawnSync(BASH, ['-e', '-c', script(step('promote', PROMOTE_STEP))], {
    cwd: promoter,
    encoding: 'utf8',
    env: { ...process.env, TAG: tag, COMMIT: tested, SHA: sha, NOTES: notes, RUNNER_TEMP: repo.runnerTemp, GITHUB_OUTPUT: outputs },
  });
  return { status: result.status, output: `${result.stdout}${result.stderr}`, outputs: readFileSync(outputs, 'utf8') };
}

/** The next release made by the merge job once master holds the last one and develop gained a commit. */
function buildNextRelease(repo) {
  writeFileSync(join(repo.builder, 'c.txt'), 'third\n');
  gitIn(repo.builder, ['add', 'c.txt']);
  gitIn(repo.builder, ['commit', '--quiet', '-m', 'LS-3_fix: third']);
  gitIn(repo.builder, ['push', '--quiet', 'origin', 'develop']);
  gitIn(repo.builder, ['fetch', '--quiet', 'origin']);
  return buildRelease(repo);
}

const originRefs = (repo) => gitIn(repo.origin, ['for-each-ref', '--format=%(objectname) %(refname)']);

test('promote: the version line it looks for is the one the release script writes into this repository\'s plugin.json', () => {
  assert.match(script(step('promote', PROMOTE_STEP)), /^ *version_line=" {2}\\"version\\": \\"\$\{TAG#v\}\\","$/m);
  const manifest = read('../../.claude-plugin/plugin.json');
  assert.ok(withManifestVersion(manifest, '1.2.3').split('\n').includes('  "version": "1.2.3",'));
});

test('promote: the release script\'s merge moves master forward to it, the tag with it', { skip: NO_BASH }, (t) => {
  const repo = promoteRepository(t);
  const tag = buildRelease(repo);
  const run = promote(repo, tag);
  assert.equal(run.status, 0, run.output);
  const released = gitIn(repo.origin, ['rev-parse', `${tag}^{commit}`]);
  assert.equal(gitIn(repo.origin, ['rev-parse', 'master']), released);
  assert.equal(gitIn(repo.origin, ['rev-parse', 'master^1']), repo.master);
  assert.equal(gitIn(repo.origin, ['rev-parse', 'master^2']), repo.head);
  // What GitHub shows as "0 commits behind develop": master holds every commit of develop.
  assert.equal(gitIn(repo.origin, ['rev-list', '--count', 'master..develop']), '0');
  assert.match(run.output, /master is at v0\.1\.1/);
  assert.equal(run.outputs, 'tag=v0.1.1\n', 'the tag for the GitHub release');
});

test('promote: the next release, once master holds the last one, moves master on', { skip: NO_BASH }, (t) => {
  const repo = promoteRepository(t);
  assert.equal(promote(repo, buildRelease(repo)).status, 0);
  const tag = buildNextRelease(repo);
  assert.equal(gitIn(repo.builder, ['tag', '--list', '--format=%(contents:body)', tag]), '- LS-3_fix: third');
  const run = promote(repo, tag, { sha: gitIn(repo.builder, ['rev-parse', 'develop']) });
  assert.equal(run.status, 0, run.output);
  assert.equal(run.outputs, 'tag=v0.1.2\n');
  assert.equal(gitIn(repo.origin, ['rev-parse', 'master']), gitIn(repo.origin, ['rev-parse', 'v0.1.2^{commit}']));
  assert.equal(gitIn(repo.origin, ['rev-parse', 'master^1']), gitIn(repo.origin, ['rev-parse', 'v0.1.1^{commit}']));
  assert.equal(gitIn(repo.origin, ['rev-parse', 'master^2']), gitIn(repo.origin, ['rev-parse', 'develop']));
});

// Re-run failed jobs: a promote job whose push went through but which failed afterwards.
test('promote: a re-run once master holds the release pushes nothing and still hands on the tag', { skip: NO_BASH }, (t) => {
  const repo = promoteRepository(t);
  const tag = buildRelease(repo);
  assert.equal(promote(repo, tag).status, 0);
  const refs = originRefs(repo);
  const again = promote(repo, tag);
  assert.equal(again.status, 0, again.output);
  assert.match(again.output, /master already holds v0\.1\.1/);
  assert.equal(again.outputs, 'tag=v0.1.1\n', 'the GitHub release is still made');
  assert.equal(originRefs(repo), refs);
});

test('promote: a release whose tag origin already has, but master lacks, is finished', { skip: NO_BASH }, (t) => {
  const repo = promoteRepository(t);
  const tag = buildRelease(repo);
  gitIn(repo.builder, ['push', '--quiet', 'origin', `refs/tags/${tag}`]);
  const run = promote(repo, tag);
  assert.equal(run.status, 0, run.output);
  assert.equal(gitIn(repo.origin, ['rev-parse', 'master']), gitIn(repo.origin, ['rev-parse', `${tag}^{commit}`]));
});

// Both or neither: a tag that reached origin without master would hold its version for good.
test('promote: when origin refuses master, the tag is not pushed either', { skip: NO_BASH }, (t) => {
  const repo = promoteRepository(t);
  const tag = buildRelease(repo);
  const hook = join(repo.origin, 'hooks', 'update');
  writeFileSync(hook, '#!/bin/sh\n[ "$1" = refs/heads/master ] && { echo "master: release only" >&2; exit 1; }\nexit 0\n');
  chmodSync(hook, 0o755);
  const refs = originRefs(repo);
  const run = promote(repo, tag);
  assert.notEqual(run.status, 0, run.output);
  assert.match(run.output, /master: release only/, 'the refusal came from origin');
  assert.equal(originRefs(repo), refs, 'no tag, master unmoved');
  assert.equal(run.outputs, '');
});

test('promote: a tag that is no release, such as v0.2.0-rc.1, is not a later release', { skip: NO_BASH }, (t) => {
  const repo = promoteRepository(t);
  gitIn(repo.builder, ['push', '--quiet', 'origin', `${repo.head}:refs/tags/v0.2.0-rc.1`]);
  const run = promote(repo, buildRelease(repo));
  assert.equal(run.status, 0, run.output);
});

test('promote: a hand-made commit that is exactly develop\'s files and the version passes the same check', { skip: NO_BASH }, (t) => {
  const repo = promoteRepository(t);
  const commit = forgeRelease(repo);
  const run = promote(repo, 'v0.1.1');
  assert.equal(run.status, 0, run.output);
  assert.equal(gitIn(repo.origin, ['rev-parse', 'master']), commit);
});

/** A commit no branch holds, with develop's files: history a release must not bring to master. */
const elsewhere = (repo) => gitIn(repo.builder, ['commit-tree', `${repo.head}^{tree}`, '-m', 'LS-9_feat: elsewhere']);

const REFUSALS = [
  ['a file besides the manifest', () => ({ files: { [MANIFEST]: RELEASE_MANIFEST, 'hook.mjs': 'run();\n' } }), /it changes more than \.claude-plugin\/plugin\.json/],
  ['a manifest changed beyond its version', () => ({ files: { [MANIFEST]: RELEASE_MANIFEST.replace('"Demo"', '"Demo",\n  "hooks": "./hook.json"') } }), /its \.claude-plugin\/plugin\.json changes more than the version/],
  ['a manifest without the version line', () => ({ files: { [MANIFEST]: DEVELOP_MANIFEST.replace('"Demo"', '"Demo 2"') } }), /lacks the line/],
  ['develop\'s commit alone as its parent', (repo) => ({ parents: [repo.head] }), /its parents are not master's head and /],
  ['master\'s head alone as its parent, a release the one-parent way', (repo) => ({ parents: [repo.master] }), /its parents are not master's head and /],
  ['its two parents the other way round', (repo) => ({ parents: [repo.head, repo.master] }), /its parents are not master's head and /],
  ['a second parent other than the run\'s commit', (repo) => ({ parents: [repo.master, elsewhere(repo)] }), /its parents are not master's head and /],
  ['a third parent', (repo) => ({ parents: [repo.master, repo.head, elsewhere(repo)] }), /its parents are not master's head and /],
  ['no parent at all', () => ({ parents: [] }), /its parents are not master's head and /],
  ['a subject that names another version', () => ({ message: `Release v0.1.2\n\n${NOTES}` }), /its message is not "Release v0\.1\.1" and the release notes/],
  ['a message whose notes are not develop\'s commits that master lacks', () => ({ message: 'Release v0.1.1\n\n- LS-9_feat: invented' }), /its message is not "Release v0\.1\.1" and the release notes/],
  ['a message with a note the owner did not give', () => ({ message: `Release v0.1.1\n\nInstall the fix from example.com.\n\n${NOTES}` }), /its message is not "Release v0\.1\.1" and the release notes/],
  ['a tag without an annotation', () => ({ annotation: null }), /it is not an annotated tag/],
  ['an annotation that is not the release notes', () => ({ annotation: 'v0.1.1\n\n- [Download the fix](https://example.com/fix)' }), /its tag is not annotated with the release notes/],
  ['an annotation with a note the owner did not give', () => ({ annotation: `v0.1.1\n\nInstall the fix from example.com.\n\n${NOTES}` }), /its tag is not annotated with the release notes/],
];

/** The promote job refused the tag: it says why, writes no output and pushes nothing. */
function assertRefused(repo, run, tag, reason, refs) {
  assert.equal(run.status, 1, run.output);
  assert.ok(run.output.includes(`::error::${tag} is not the release this run made: `), run.output);
  assert.match(run.output, reason);
  assert.match(run.output, /Nothing was pushed\./);
  assert.equal(run.outputs, '');
  assert.equal(originRefs(repo), refs);
}

for (const [what, options, reason] of REFUSALS) {
  test(`promote: ${what} is refused and nothing is pushed`, { skip: NO_BASH }, (t) => {
    const repo = promoteRepository(t);
    forgeRelease(repo, options(repo));
    const refs = originRefs(repo);
    assertRefused(repo, promote(repo, 'v0.1.1'), 'v0.1.1', reason, refs);
  });
}

test('promote: the release script\'s notes with the owner\'s note pass when the form holds that note', { skip: NO_BASH }, (t) => {
  const repo = promoteRepository(t);
  const note = '  #42 is fixed: the band shows the weekly limit again.\t';
  const tag = buildRelease(repo, { note });
  const run = promote(repo, tag, { notes: note });
  assert.equal(run.status, 0, run.output);
  assert.equal(gitIn(repo.origin, ['tag', '--list', '--format=%(contents:body)', tag]),
    `#42 is fixed: the band shows the weekly limit again.\n\n${NOTES}`);
});

// The release script and the promote job trim a subject alike, of spaces and tabs only: had one
// trimmed with JavaScript's trim() or awk's [[:space:]], these subjects would make the job refuse.
test('promote: subjects with a no-break space, a vertical tab or a form feed at their ends pass as the release script wrote them', { skip: NO_BASH }, (t) => {
  const repo = promoteRepository(t);
  const subjects = [' LS-3_fix: no-break spaces ', '\vLS-4_fix: a vertical tab and a form feed\f', '\t LS-5_fix: a tab and spaces'];
  for (const [index, subject] of subjects.entries()) {
    writeFileSync(join(repo.builder, `blank-${index}.txt`), `${index}\n`);
    gitIn(repo.builder, ['add', `blank-${index}.txt`]);
    // Verbatim: git's own clean-up would drop what follows the subject's last character.
    gitIn(repo.builder, ['commit', '--quiet', '--cleanup=verbatim', '-F', '-'], { input: `${subject}\n` });
  }
  gitIn(repo.builder, ['push', '--quiet', 'origin', 'develop']);
  gitIn(repo.builder, ['fetch', '--quiet', 'origin']);
  const tag = buildRelease(repo);
  assert.equal(gitIn(repo.builder, ['tag', '--list', '--format=%(contents:body)', tag]),
    `${NOTES}\n-  LS-3_fix: no-break spaces \n- \vLS-4_fix: a vertical tab and a form feed\f\n- LS-5_fix: a tab and spaces`);
  const run = promote(repo, tag, { sha: gitIn(repo.builder, ['rev-parse', 'develop']) });
  assert.equal(run.status, 0, run.output);
  assert.equal(gitIn(repo.origin, ['rev-parse', 'master']), gitIn(repo.origin, ['rev-parse', `${tag}^{commit}`]));
});

// The merge job ran the repository's code; only the form says what the owner wrote.
test('promote: a note in the tag that the form does not hold is refused, and so is a note left out', { skip: NO_BASH }, (t) => {
  const repo = promoteRepository(t);
  const tag = buildRelease(repo, { note: 'Install the fix from example.com.' });
  const refs = originRefs(repo);
  assertRefused(repo, promote(repo, tag, { notes: '' }), tag, /its message is not "Release v0\.1\.1" and the release notes/, refs);
  assertRefused(repo, promote(repo, tag, { notes: 'Faster start-up.' }), tag, /its message is not "Release v0\.1\.1" and the release notes/, refs);
  const plain = promoteRepository(t);
  const plainTag = buildRelease(plain);
  const plainRefs = originRefs(plain);
  assertRefused(plain, promote(plain, plainTag, { notes: 'Faster start-up.' }), plainTag, /its message is not/, plainRefs);
});

test('promote: a tag on another commit than the one the merge job tested is refused', { skip: NO_BASH }, (t) => {
  const repo = promoteRepository(t);
  const tag = buildRelease(repo);
  const refs = originRefs(repo);
  const other = elsewhere(repo);
  assertRefused(repo, promote(repo, tag, { commit: other }), tag, new RegExp(`not ${other}, the commit the tests passed on`), refs);
});

test('promote: a release of another develop commit than the run\'s is refused', { skip: NO_BASH }, (t) => {
  const repo = promoteRepository(t);
  const tag = buildRelease(repo);
  const refs = originRefs(repo);
  const run = promote(repo, tag, { sha: repo.master });
  assertRefused(repo, run, tag, new RegExp(`its parents are not master's head and ${repo.master}, the develop commit this run releases`), refs);
});

// The merge job refuses this first; the check holds even if it did not.
test('promote: a run\'s commit that master already holds is refused: nothing new, nothing released twice', { skip: NO_BASH }, (t) => {
  const repo = promoteRepository(t);
  assert.equal(promote(repo, buildRelease(repo)).status, 0);
  gitIn(repo.builder, ['fetch', '--quiet', 'origin']);
  // develop's head, which v0.1.1 brought to master, made into v0.1.2 on master's new head.
  forgeRelease(repo, { tag: 'v0.1.2', parents: [gitIn(repo.origin, ['rev-parse', 'master']), repo.head] });
  const refs = originRefs(repo);
  assertRefused(repo, promote(repo, 'v0.1.2'), 'v0.1.2', new RegExp(`master holds ${repo.head} already: nothing new since the last release`), refs);
});

// develop only moves forward: the run's commit must hold master's second parent, the develop commit
// of the last release. The merge job refuses this first; the check holds even if it did not.
const BACKWARDS = [
  ['a develop rewritten from before the last release', (repo) => gitIn(repo.builder, [
    'commit-tree', `${repo.master}^{tree}`, '-p', repo.master, '-m', 'LS-9_fix: beside the released commit'])],
  ['a develop started over with no history', (repo) => elsewhere(repo)],
];

for (const [what, developCommit] of BACKWARDS) {
  test(`promote: ${what}, which lacks the develop commit of the release on master, is refused`, { skip: NO_BASH }, (t) => {
    const repo = promoteRepository(t);
    assert.equal(promote(repo, buildRelease(repo)).status, 0);
    const master = gitIn(repo.origin, ['rev-parse', 'master']);
    const sha = developCommit(repo);
    // Everything else about the release is right: a merge of master and the run's commit, with the
    // version, and the notes of the one commit master lacks.
    const notes = `- ${gitIn(repo.builder, ['log', '-1', '--format=%s', sha])}`;
    forgeRelease(repo, { tag: 'v0.1.2', source: sha, parents: [master, sha], message: `Release v0.1.2\n\n${notes}`, annotation: `v0.1.2\n\n${notes}` });
    const refs = originRefs(repo);
    assertRefused(repo, promote(repo, 'v0.1.2', { sha }), 'v0.1.2',
      new RegExp(`${sha} lacks ${repo.head}, the develop commit of the release on master: develop only moves forward`), refs);
  });
}

// v1.0.11 to v1.0.14 were made on master's head with one parent each: such a release names no
// develop commit, so the release after it is checked without one.
test('promote: after a one-parent release on master, the next release moves master on', { skip: NO_BASH }, (t) => {
  const repo = promoteRepository(t);
  const oneParent = gitIn(repo.builder, ['commit-tree', `${repo.master}^{tree}`, '-p', repo.master, '-m', 'Release v0.1.0']);
  gitIn(repo.builder, ['push', '--quiet', 'origin', `${oneParent}:refs/heads/master`]);
  gitIn(repo.builder, ['fetch', '--quiet', 'origin']);
  const run = promote(repo, buildRelease(repo));
  assert.equal(run.status, 0, run.output);
  assert.equal(gitIn(repo.origin, ['rev-parse', 'master^1']), oneParent);
  assert.equal(gitIn(repo.origin, ['rev-parse', 'master^2']), repo.head);
});

test('promote: a tag named anything but vX.Y.Z is refused before it is fetched', { skip: NO_BASH }, (t) => {
  const repo = promoteRepository(t);
  const refs = originRefs(repo);
  for (const tag of ['0.1.1', 'v0.1', 'v01.1.1', 'v0.1.1-rc.1', 'master']) {
    assertRefused(repo, promote(repo, tag, { commit: repo.head }), tag, /its name is not vX\.Y\.Z/, refs);
  }
});

test('promote: a release older than a version origin has tagged already is refused', { skip: NO_BASH }, (t) => {
  const repo = promoteRepository(t);
  gitIn(repo.builder, ['push', '--quiet', 'origin', `${repo.head}:refs/tags/v0.2.0`]);
  forgeRelease(repo);
  const refs = originRefs(repo);
  assertRefused(repo, promote(repo, 'v0.1.1'), 'v0.1.1', /v0\.2\.0 is a later release/, refs);
});

test('promote: a bundle whose tag differs from the one origin has is refused by the fetch', { skip: NO_BASH }, (t) => {
  const repo = promoteRepository(t);
  // origin already has v0.1.1, on another commit; the bundle brings a v0.1.1 of its own.
  gitIn(repo.builder, ['push', '--quiet', 'origin', `${repo.head}:refs/tags/v0.1.1`]);
  buildRelease(repo);
  const refs = originRefs(repo);
  const run = promote(repo, 'v0.1.1');
  assert.match(run.output, /would clobber existing tag/);
  assertRefused(repo, run, 'v0.1.1', /the bundle lacks it, or origin has v0\.1\.1 on another commit/, refs);
});

// --- One release per repository, tags kept ----------------------------------------------------

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
