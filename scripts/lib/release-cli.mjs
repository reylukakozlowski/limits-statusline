// npm run release -- [--push] [--dry-run]
// A release is a tag: the annotated tag vX.Y.Z on develop's head, X.Y.Z being the version in
// .claude-plugin/plugin.json, the plugin's one version, which a pull request into develop raised
// as every change reaches develop. Its message lists the subjects of the commits since the
// previous version tag. Nothing is committed and no branch is made. --push pushes the tag; the
// Release workflow then merges develop into master (fast-forward) and publishes the GitHub
// release. A head that already carries a version tag is that release, still to finish: its tag
// is printed (and pushed again with --push) and no new one is made.
// --dry-run runs the same checks and the tests and writes nothing.
// stdout holds the tag and nothing else, for the workflow; every report goes to stderr.
// Exit codes: 0 done (or dry run), 1 usage error, 2 refused or failed.

import { parseArgs } from 'node:util';
import { latestVersion, releaseVersion, releaseNotes } from './release-lib.mjs';

const BASE_BRANCH = 'develop';
const VERSION_TAGS = 'v*.*.*';
const USAGE = 'Usage: npm run release -- [--push] [--dry-run]';

class Refusal extends Error {}

/**
 * @typedef {(command: string, args: string[], options?: { inherit?: boolean }) => { status: number, stdout: string }} Exec
 * @typedef {{ write(text: string): void }} Stream
 */

/**
 * @param {{ argv: string[], exec: Exec, readManifest: () => string, stdout: Stream, stderr: Stream }} io
 *   readManifest gives the text of .claude-plugin/plugin.json
 * @returns {number}
 */
export function runRelease({ argv, exec, readManifest, stdout, stderr }) {
  let options;
  try {
    options = parseOptions(argv);
  } catch (error) {
    stderr.write(`release: ${error.message}\n${USAGE}\n`);
    return 1;
  }
  try {
    const tag = release({ ...options, exec, readManifest, say: (text) => stderr.write(`${text}\n`) });
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
  if (positionals.length > 0) throw new Error('it takes no version: it releases the version in .claude-plugin/plugin.json');
  return { shouldPush: values.push, isDryRun: values['dry-run'] };
}

/** @returns {string | null} the release's tag, or null after a dry run */
function release({ shouldPush, isDryRun, exec, readManifest, say }) {
  const git = gitRunner(exec);
  const plan = planRelease({ exec, readManifest, git });

  if (exec('npm', ['test'], { inherit: true }).status !== 0) throw new Refusal('tests failed; nothing was tagged.');

  if (isDryRun) {
    say(plan.isFinishing
      ? `release (dry run): develop's head is already ${plan.tag}; the run would finish that release.`
      : `release (dry run): ${plan.current} → ${plan.version}, tag ${plan.tag} on develop's head${shouldPush ? ', pushed to origin' : ''}.`);
    if (plan.notes) say(plan.notes);
    return null;
  }

  if (plan.isFinishing) {
    say(`release: develop's head is already ${plan.tag}; no new tag, that release is the one to finish.`);
  } else {
    git('tag', '-a', plan.tag, '-m', plan.tag, '-m', plan.notes);
    say(`release: tagged develop's head ${plan.tag}.`);
  }
  if (!shouldPush) {
    say(`release: push the tag with \`git push origin refs/tags/${plan.tag}\`, then run the Release workflow on `
      + `${BASE_BRANCH}: it merges ${BASE_BRANCH} into master and publishes the GitHub release.`);
    return plan.tag;
  }
  if (exec('git', ['push', 'origin', `refs/tags/${plan.tag}`], { inherit: true }).status !== 0) {
    throw new Refusal(`origin refused ${plan.tag}; the tag exists only in this clone.`);
  }
  return plan.tag;
}

/** Reads the repository and works the release out, refusing before anything is written. */
function planRelease({ exec, readManifest, git }) {
  const branch = git('rev-parse', '--abbrev-ref', 'HEAD').trim();
  if (branch !== BASE_BRANCH) throw new Refusal(`releases are cut from ${BASE_BRANCH}, not ${branch}.`);
  if (git('status', '--porcelain').trim() !== '') throw new Refusal('the working tree has uncommitted changes.');

  const headVersion = latestVersion(lines(git('tag', '--list', VERSION_TAGS, '--points-at', 'HEAD')));
  if (headVersion) return { isFinishing: true, tag: `v${headVersion}` };

  const previous = latestVersion(lines(git('tag', '--list', VERSION_TAGS, '--merged', 'HEAD')));
  const current = previous ?? '0.0.0';
  const version = toRefusal(() => releaseVersion(manifestVersion(readManifest), previous));
  const tag = `v${version}`;
  if (exec('git', ['rev-parse', '--quiet', '--verify', `refs/tags/${tag}`], {}).status === 0) {
    throw new Refusal(`tag ${tag} already exists.`);
  }
  const range = previous ? `v${previous}..HEAD` : 'HEAD';
  const notes = toRefusal(() => releaseNotes(lines(git('log', '--reverse', '--format=%s', range))));
  return { isFinishing: false, current, version, tag, notes };
}

const lines = (text) => text.split('\n').map((line) => line.trim()).filter(Boolean);

/** The manifest's `version`, whatever it holds; releaseVersion judges it. */
function manifestVersion(readManifest) {
  let manifest;
  try {
    manifest = JSON.parse(readManifest());
  } catch (error) {
    throw new Refusal(`.claude-plugin/plugin.json cannot be read: ${error.message}`);
  }
  return manifest?.version;
}

const gitRunner = (exec) => (...args) => {
  const result = exec('git', args, {});
  if (result.status !== 0) throw new Refusal(`git ${args.join(' ')} failed (exit ${result.status}).`);
  return result.stdout;
};

function toRefusal(compute) {
  try {
    return compute();
  } catch (error) {
    throw new Refusal(error.message);
  }
}
