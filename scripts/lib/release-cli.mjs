// npm run release -- <patch|minor|major> [--push] [--dry-run]
// A release is a commit on master and its tag. The release commit carries develop's files as they
// are at its head, with .claude-plugin/plugin.json given the release's version, and its parent is
// master's head, the previous release, so master moves forward by one commit and stays linear.
// develop carries no version: the version is the release's, counted from the last vX.Y.Z tag by
// the part the owner picked. The commit's message lists the subjects of develop's commits since
// the previous release and ends with the develop commit it was made from; the annotated tag vX.Y.Z
// on it holds the same notes. --push pushes the tag, then master. A latest release that master
// lacks, or that was made from develop's head, is finished instead of cutting a new one: its tag
// is printed, and --push pushes the tag and master again where origin lacks them.
// --dry-run runs the same checks and the tests and writes nothing.
// stdout holds the tag and nothing else, for the workflow; every report goes to stderr.
// Exit codes: 0 done (or dry run), 1 usage error, 2 refused or failed.

import { parseArgs } from 'node:util';
import { BUMPS, latestVersion, nextVersion, releaseNotes, releaseSource, sourceTrailer, withManifestVersion } from './release-lib.mjs';

const BASE_BRANCH = 'develop';
const VERSION_TAGS = 'v*.*.*';
const MANIFEST_PATH = '.claude-plugin/plugin.json';
const MASTER = 'refs/remotes/origin/master';
const USAGE = 'Usage: npm run release -- <patch|minor|major> [--push] [--dry-run]';

/**
 * @typedef {(command: string, args: string[], options?: { inherit?: boolean }) => { status: number, stdout: string }} Exec
 * @typedef {{ write(text: string): void }} Stream
 */

/** A run that stops with a reason for the person: exit code 2, nothing more written. */
class Refusal extends Error {}

/** The non-empty lines of a command's output, trimmed. */
const lines = (text) => text.split('\n').map((line) => line.trim()).filter(Boolean);

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
 * @param {{ argv: string[], exec: Exec, readManifest: () => string, writeManifest: (text: string) => void,
 *   stdout: Stream, stderr: Stream }} io the manifest is .claude-plugin/plugin.json in the clone
 * @returns {number}
 */
export function runRelease({ argv, exec, readManifest, writeManifest, stdout, stderr }) {
  let options;
  try {
    options = parseOptions(argv);
  } catch (error) {
    stderr.write(`release: ${error.message}\n${USAGE}\n`);
    return 1;
  }
  try {
    const tag = release({ ...options, exec, readManifest, writeManifest, say: (text) => stderr.write(`${text}\n`) });
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
    options: { push: { type: 'boolean', default: false }, 'dry-run': { type: 'boolean', default: false } },
    allowPositionals: true,
    strict: true,
  });
  if (positionals.length !== 1 || !BUMPS.includes(positionals[0])) throw new Error(`give the part to raise: ${BUMPS.join(', ')}`);
  return { bump: positionals[0], shouldPush: values.push, isDryRun: values['dry-run'] };
}

/** @returns {string | null} the release's tag, or null after a dry run */
function release({ bump, shouldPush, isDryRun, exec, readManifest, writeManifest, say }) {
  const git = gitRunner(exec);
  const plan = planRelease({ bump, exec, git });

  if (exec('npm', ['test'], { inherit: true }).status !== 0) throw new Refusal('tests failed; nothing was tagged.');

  if (isDryRun) {
    say(plan.isFinishing
      ? `release (dry run): the run would finish ${plan.tag} instead of cutting a new release: ${plan.reason}.`
      : `release (dry run): ${plan.current} → ${plan.version}, a release commit on master${plan.master ? '' : ' (its first)'} `
        + `with develop's files at ${plan.head.slice(0, 7)} and plugin.json at ${plan.version}, tag ${plan.tag}`
        + `${shouldPush ? ', both pushed to origin' : ''}.`);
    if (plan.notes) say(plan.notes);
    return null;
  }

  let commit = plan.commit;
  if (plan.isFinishing) {
    say(`release: finishing ${plan.tag} instead of cutting a new release: ${plan.reason}.`);
  } else {
    commit = commitRelease({ plan, git, readManifest, writeManifest });
    git('tag', '-a', plan.tag, commit, '-m', plan.tag, '-m', plan.notes);
    say(`release: ${plan.tag} is ${commit.slice(0, 7)}, develop at ${plan.head.slice(0, 7)} with plugin.json at ${plan.version}.`);
  }
  if (!shouldPush) {
    say(`release: the Release workflow pushes ${plan.tag} and moves master to it with the deploy key; only that key may move master.`);
    return plan.tag;
  }
  push(exec, `refs/tags/${plan.tag}`, `origin refused ${plan.tag}; the tag exists only in this clone.`);
  push(exec, `${commit}:refs/heads/master`, `origin refused to move master to ${plan.tag}; the tag is pushed, and the next run of the Release workflow finishes it.`);
  return plan.tag;
}

/**
 * The release commit: the tree of develop's head with the manifest's version set, on master's
 * head. The working tree and the index are put back as they were, whatever happens.
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
  const parent = plan.master ? ['-p', plan.master] : [];
  return git('commit-tree', tree, ...parent, '-m', `Release ${plan.tag}`, '-m', plan.notes, '-m', sourceTrailer(plan.head)).trim();
}

function push(exec, refspec, refusal) {
  if (exec('git', ['push', 'origin', refspec], { inherit: true }).status !== 0) throw new Refusal(refusal);
}

/** Reads the repository and works the release out, refusing before anything is written. */
function planRelease({ bump, exec, git }) {
  const branch = git('rev-parse', '--abbrev-ref', 'HEAD').trim();
  if (branch !== BASE_BRANCH) throw new Refusal(`releases are cut from ${BASE_BRANCH}, not ${branch}.`);
  if (git('status', '--porcelain').trim() !== '') throw new Refusal('the working tree has uncommitted changes.');

  const head = git('rev-parse', 'HEAD').trim();
  const masterHead = exec('git', ['rev-parse', '--quiet', '--verify', MASTER], {});
  const master = masterHead.status === 0 ? masterHead.stdout.trim() : null;
  const previous = latestVersion(lines(git('tag', '--list', VERSION_TAGS)));
  const previousCommit = previous ? git('rev-parse', `v${previous}^{commit}`).trim() : null;
  // Up to v1.0.10 a release tagged develop's own commit; since then the release commit names it.
  const previousSource = previousCommit ? releaseSource(git('log', '-1', '--format=%B', previousCommit)) ?? previousCommit : null;
  const unfinished = unfinishedReason({ exec, previousCommit, previousSource, head, master });
  if (unfinished) return { isFinishing: true, tag: `v${previous}`, commit: previousCommit, reason: unfinished };

  const current = previous ?? '0.0.0';
  const version = toRefusal(() => nextVersion(previous, bump));
  const tag = `v${version}`;
  if (exec('git', ['rev-parse', '--quiet', '--verify', `refs/tags/${tag}`], {}).status === 0) {
    throw new Refusal(`tag ${tag} already exists.`);
  }
  const isSinceSource = previousSource !== null && exec('git', ['merge-base', '--is-ancestor', previousSource, 'HEAD'], {}).status === 0;
  const notes = toRefusal(() => releaseNotes(lines(git('log', '--reverse', '--format=%s', isSinceSource ? `${previousSource}..HEAD` : 'HEAD'))));
  return { isFinishing: false, current, version, tag, notes, head, master };
}

/**
 * Why the latest release is still to finish, or null when a new one is due. A release a failed run
 * left behind is finished before a new one is cut, so master skips no version.
 */
function unfinishedReason({ exec, previousCommit, previousSource, head, master }) {
  if (previousCommit === null) return null;
  if (master !== null && exec('git', ['merge-base', '--is-ancestor', previousCommit, master], {}).status !== 0) return 'master lacks it';
  return previousSource === head ? 'develop has nothing new since it' : null;
}
