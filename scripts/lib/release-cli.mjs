// npm run release -- <patch|minor|major> [--dry-run]
// A release is a merge of develop into master and its tag. Run from a develop commit that origin's
// develop holds (the Release workflow checks out the run's own commit, develop when the owner
// started it), it builds the release commit: develop's files as they are at that commit, with
// .claude-plugin/plugin.json given the release's version, and two parents, master's head (the
// previous release) and the develop commit. So master moves forward by one commit and holds
// develop's history: right after a release, master is no commit behind develop. develop carries no
// version: the version is the release's, counted from the highest vX.Y.Z tag by the part the owner
// picked. The release notes are the owner's note, when there is one, then the subjects of the
// develop commits master lacks, oldest first; they are the commit's message after "Release vX.Y.Z"
// and, once the tests passed on the release commit itself, the annotated tag vX.Y.Z's. Both stay in
// this clone and nothing is pushed: the Release workflow's promote job checks that the commit is
// exactly this one and pushes it with the deploy key, the one key that may move master.
// Refused before anything is written: a develop commit master already holds (nothing new since the
// last release) and one that lacks the develop commit of the release on master (develop only moves
// forward).
// --dry-run runs the same checks and the tests on the develop commit and writes nothing.
// stdout holds the tag and nothing else, for the workflow; every report goes to stderr.
// Exit codes: 0 done (or dry run), 1 usage error, 2 refused or failed.

import { parseArgs } from 'node:util';
import { BUMPS, latestVersion, nextVersion, releaseNotes, withManifestVersion } from './release-lib.mjs';

const VERSION_TAGS = 'v*.*.*';
const MANIFEST_PATH = '.claude-plugin/plugin.json';
const DEVELOP = 'refs/remotes/origin/develop';
const MASTER = 'refs/remotes/origin/master';
const USAGE = 'Usage: npm run release -- <patch|minor|major> [--dry-run]';

/**
 * @typedef {(command: string, args: string[], options?: { inherit?: boolean }) => { status: number, stdout: string }} Exec
 * @typedef {{ write(text: string): void }} Stream
 */

/** A run that stops with a reason for the person: exit code 2, nothing more written. */
class Refusal extends Error {}

/** The non-empty lines of a command's output, trimmed. */
const lines = (text) => text.split('\n').map((line) => line.trim()).filter(Boolean);

const short = (sha) => sha.slice(0, 7);

/** git through `exec`, its output on success, a Refusal naming the command on failure. @param {Exec} exec */
const gitRunner = (exec) => (...args) => {
  const result = exec('git', args, {});
  if (result.status !== 0) throw new Refusal(`git ${args.join(' ')} failed (exit ${result.status}).`);
  return result.stdout;
};

/** The value `compute` gives, its error turned into a Refusal. */
function toRefusal(compute) {
  try {
    return compute();
  } catch (error) {
    throw new Refusal(error.message);
  }
}

/**
 * @param {{ argv: string[], note?: string, exec: Exec, readManifest: () => string,
 *   writeManifest: (text: string) => void, stdout: Stream, stderr: Stream }} io the manifest is
 *   .claude-plugin/plugin.json in the clone; `note` is the owner's release note (the Release form)
 * @returns {number}
 */
export function runRelease({ argv, note = '', exec, readManifest, writeManifest, stdout, stderr }) {
  let options;
  try {
    options = parseOptions(argv);
  } catch (error) {
    stderr.write(`release: ${error.message}\n${USAGE}\n`);
    return 1;
  }
  try {
    const tag = release({ ...options, note, exec, readManifest, writeManifest, say: (text) => stderr.write(`${text}\n`) });
    if (tag) stdout.write(`${tag}\n`);
    return 0;
  } catch (error) {
    if (!(error instanceof Refusal)) throw error;
    stderr.write(`release: ${error.message}\n`);
    return 2;
  }
}

function parseOptions(argv) {
  const { values, positionals } = parseArgs({
    args: argv,
    options: { 'dry-run': { type: 'boolean', default: false } },
    allowPositionals: true,
    strict: true,
  });
  if (positionals.length !== 1 || !BUMPS.includes(positionals[0])) throw new Error(`give the part to raise: ${BUMPS.join(', ')}`);
  return { bump: positionals[0], isDryRun: values['dry-run'] };
}

/** @returns {string | null} the release's tag, or null after a dry run */
function release({ bump, isDryRun, note, exec, readManifest, writeManifest, say }) {
  const git = gitRunner(exec);
  const plan = planRelease({ bump, note, exec, git });
  const runTests = () => exec('npm', ['test'], { inherit: true }).status === 0;

  if (isDryRun) {
    if (!runTests()) throw new Refusal('tests failed; nothing was tagged.');
    say(`release (dry run): ${plan.current} → ${plan.version}, ${plan.master ? 'a merge of' : 'the first release on'} develop at `
      + `${short(plan.head)} ${plan.master ? 'into master' : '(it creates master)'}, with plugin.json at ${plan.version}, tag ${plan.tag}.`);
    say(plan.notes);
    return null;
  }

  const commit = commitRelease({ plan, git, readManifest, writeManifest });
  // The tests run on the release commit, the files master gets, and only a passing one is tagged.
  git('checkout', '--quiet', '--detach', commit);
  let passed;
  try {
    passed = runTests();
  } finally {
    git('checkout', '--quiet', plan.branch === 'HEAD' ? plan.head : plan.branch);
  }
  if (!passed) throw new Refusal(`tests failed on the release commit ${short(commit)}; nothing was tagged.`);
  // verbatim: git tag's default cleanup would drop a line of the note that starts with '#'.
  git('tag', '-a', '--cleanup=verbatim', plan.tag, commit, '-m', plan.tag, '-m', plan.notes);
  say(`release: ${plan.tag} is ${short(commit)}, a merge of develop at ${short(plan.head)} with plugin.json at ${plan.version}.`);
  say(`release: the Release workflow checks ${plan.tag} and pushes it and master with the deploy key; only that key may move master.`);
  return plan.tag;
}

/**
 * The release commit: the tree of the develop commit with the manifest's version set; its parents
 * are master's head and that develop commit, a merge of develop into master (the first release,
 * with no master yet, has the develop commit alone). The working tree and the index are put back
 * as they were, whatever happens.
 */
function commitRelease({ plan, git, readManifest, writeManifest }) {
  const manifest = readManifest();
  let tree;
  try {
    writeManifest(toRefusal(() => withManifestVersion(manifest, plan.version)));
    git('add', MANIFEST_PATH);
    tree = git('write-tree').trim();
  } finally {
    writeManifest(manifest);
    git('add', MANIFEST_PATH);
  }
  const parents = [...(plan.master ? ['-p', plan.master] : []), '-p', plan.head];
  return git('commit-tree', tree, ...parents, '-m', `Release ${plan.tag}`, '-m', plan.notes).trim();
}

/** Reads the repository and works the release out, refusing before anything is written. */
function planRelease({ bump, note, exec, git }) {
  // 'HEAD' when detached, as in the Release workflow, which checks out the run's commit.
  const branch = git('rev-parse', '--abbrev-ref', 'HEAD').trim();
  if (exec('git', ['merge-base', '--is-ancestor', 'HEAD', DEVELOP], {}).status !== 0) {
    throw new Refusal(`${branch} is not on origin/develop: a release is made from a develop commit origin holds.`);
  }
  if (git('status', '--porcelain').trim() !== '') throw new Refusal('the working tree has uncommitted changes.');

  const head = git('rev-parse', 'HEAD').trim();
  const masterHead = exec('git', ['rev-parse', '--quiet', '--verify', MASTER], {});
  const master = masterHead.status === 0 ? masterHead.stdout.trim() : null;
  if (master) checkAgainstMaster({ head, master, exec, git });

  const previous = latestVersion(lines(git('tag', '--list', VERSION_TAGS)));
  const current = previous ?? '0.0.0';
  const version = toRefusal(() => nextVersion(previous, bump));
  const tag = `v${version}`;
  if (exec('git', ['rev-parse', '--quiet', '--verify', `refs/tags/${tag}`], {}).status === 0) {
    throw new Refusal(`tag ${tag} already exists.`);
  }
  // What users lack: develop's commits that no release brought to master yet. The subjects as git
  // gives them, one per line: releaseNotes trims them as the Release workflow's promote job does.
  const subjects = git('log', '--reverse', '--no-merges', '--format=%s', master ? `${master}..HEAD` : 'HEAD').split('\n');
  const notes = toRefusal(() => releaseNotes(subjects, note));
  return { current, version, tag, notes, head, master, branch };
}

/**
 * master holds every develop commit a release brought, as a release's second parent: a develop
 * commit master holds is released already, and a develop that lacks the develop commit of the
 * release on master's head went back. A one-parent release on master's head (v1.0.11 to v1.0.14
 * were made that way) names no develop commit to compare.
 */
function checkAgainstMaster({ head, master, exec, git }) {
  if (exec('git', ['merge-base', '--is-ancestor', 'HEAD', master], {}).status === 0) {
    throw new Refusal(`develop at ${short(head)} is in master already: nothing new since the last release.`);
  }
  const [, , released] = git('rev-list', '--parents', '-n', '1', master).trim().split(/\s+/);
  if (released && exec('git', ['merge-base', '--is-ancestor', released, 'HEAD'], {}).status !== 0) {
    throw new Refusal(`develop at ${short(head)} lacks ${short(released)}, the develop commit of the release on master: `
      + 'develop only moves forward.');
  }
}
