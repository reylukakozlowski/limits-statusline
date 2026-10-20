// npm run release -- <patch|minor|major|X.Y.Z> [--push] [--dry-run]
// Prepares a release from develop: checks, tests, version bump in every manifest, changelog stamp
// and the commit `LS-N_chore(release): vX.Y.Z` on a new branch release/vX.Y.Z. develop is
// protected (changes only through pull requests), so the release reaches it through one: --push
// pushes the branch and opens its pull request with gh. Once the owner merges it with Rebase and
// merge, which gives the commit a new SHA, the Release workflow runs `node scripts/tag-release.mjs`
// (runTagRelease below): it tags the merged commit and the workflow publishes the GitHub release.
// --dry-run runs the same checks and tests and writes nothing.
// Exit codes: 0 done (or dry run), 1 usage error, 2 refused or failed.

import fs from 'node:fs';
import { join } from 'node:path';
import { parseArgs } from 'node:util';
import {
  extractReleaseNotes, findReleaseCommit, nextCommitIndex, nextVersion, stampChangelog, withVersion, COMMIT_PREFIX,
} from './release-lib.mjs';

const BASE_BRANCH = 'develop';
const MANIFESTS = Object.freeze(['package.json', '.claude-plugin/plugin.json', '.claude-plugin/marketplace.json']);
const CHANGELOG = 'CHANGELOG.md';

class Refusal extends Error {}

/**
 * @typedef {(command: string, args: string[], options?: { inherit?: boolean }) => { status: number, stdout: string }} Exec
 * @typedef {{ write(text: string): void }} Stream
 */

/**
 * @param {{ argv: string[], cwd: string, today: string, exec: Exec, stdout: Stream, stderr: Stream }} io
 * @returns {number}
 */
export function runRelease({ argv, cwd, exec, today, stdout, stderr }) {
  let options;
  try {
    options = parseOptions(argv);
  } catch (error) {
    stderr.write(`release: ${error.message}\nUsage: npm run release -- <patch|minor|major|X.Y.Z> [--push] [--dry-run]\n`);
    return 1;
  }
  return refusalsToExitCode(stderr, () => {
    release({ ...options, cwd, exec, today, say: (text) => stdout.write(`${text}\n`) });
  });
}

/**
 * node scripts/tag-release.mjs, run by the Release workflow after a push to develop. Tags the
 * commit that released the version in package.json, unless that tag exists, and pushes the tag.
 * Prints the tag and nothing else on stdout, for the publish job; reports on stderr.
 * @param {{ cwd: string, exec: Exec, stdout: Stream, stderr: Stream }} io
 * @returns {number} 0 tagged or already tagged, 2 refused or failed
 */
export function runTagRelease({ cwd, exec, stdout, stderr }) {
  return refusalsToExitCode(stderr, () => {
    const tag = tagRelease({ cwd, exec, say: (text) => stderr.write(`${text}\n`) });
    stdout.write(`${tag}\n`);
  });
}

function refusalsToExitCode(stderr, action) {
  try {
    action();
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
  if (positionals.length !== 1) throw new Error('give exactly one of patch, minor, major or X.Y.Z');
  return { kind: positionals[0], shouldPush: values.push, isDryRun: values['dry-run'] };
}

function release({ kind, shouldPush, isDryRun, cwd, exec, today, say }) {
  const git = gitRunner(exec);
  const plan = planRelease({ kind, shouldPush, cwd, exec, git, today });

  if (exec('npm', ['test'], { inherit: true }).status !== 0) throw new Refusal('tests failed; nothing was changed.');
  const notes = extractReleaseNotes(plan.changelog, plan.version);

  if (isDryRun) {
    say(`release (dry run): ${plan.current} → ${plan.version}, commit "${plan.subject}" on ${plan.branch}${shouldPush ? `, pull request into ${BASE_BRANCH}` : ''}.`);
    say(notes);
    return;
  }

  git('switch', '--create', plan.branch);
  writeRelease(plan, cwd);
  git('add', ...MANIFESTS, CHANGELOG);
  git('commit', '-m', plan.subject);
  if (!shouldPush) {
    say(`release: "${plan.subject}" committed on ${plan.branch}. Push it and open its pull request with: `
      + `git push origin ${plan.branch} && gh pr create --base ${BASE_BRANCH} --head ${plan.branch} --fill`);
    return;
  }
  openPullRequest(plan, notes, exec);
  say(`release: ${plan.branch} pushed and its pull request opened. Merge it with Rebase and merge; `
    + `the Release workflow then tags ${plan.tag} and publishes the GitHub release.`);
}

/** Reads the repository and works the release out, refusing before anything is written. */
function planRelease({ kind, shouldPush, cwd, exec, git, today }) {
  const branch = git('rev-parse', '--abbrev-ref', 'HEAD').trim();
  if (branch !== BASE_BRANCH) throw new Refusal(`releases are cut from ${BASE_BRANCH}, not ${branch}.`);
  if (git('status', '--porcelain').trim() !== '') throw new Refusal('the working tree has uncommitted changes.');

  const current = JSON.parse(readText(cwd, 'package.json')).version;
  const version = toRefusal(() => nextVersion(current, kind));
  const tag = `v${version}`;
  if (hasTag(exec, tag)) throw new Refusal(`tag ${tag} already exists.`);
  const releaseBranch = `release/${tag}`;
  // Exit 0: origin has the branch; 2: it has not (any other status lets the push itself decide).
  if (shouldPush && exec('git', ['ls-remote', '--exit-code', '--heads', 'origin', releaseBranch], {}).status === 0) {
    throw new Refusal(`origin already has ${releaseBranch}: its pull request is waiting for the merge, `
      + 'or close it and delete the branch before releasing again.');
  }
  const changelog = toRefusal(() => stampChangelog(readText(cwd, CHANGELOG), version, today));
  const index = nextCommitIndex(git('log', '--format=%s').split('\n'));
  return { current, version, tag, branch: releaseBranch, changelog, subject: `${COMMIT_PREFIX}-${index}_chore(release): ${tag}` };
}

function writeRelease({ version, changelog }, cwd) {
  for (const path of MANIFESTS) {
    fs.writeFileSync(join(cwd, path), `${JSON.stringify(withVersion(JSON.parse(readText(cwd, path)), version), null, 2)}\n`);
  }
  fs.writeFileSync(join(cwd, CHANGELOG), changelog);
}

function openPullRequest({ branch, subject, tag }, notes, exec) {
  if (exec('git', ['push', '--set-upstream', 'origin', branch], { inherit: true }).status !== 0) {
    throw new Refusal(`origin refused ${branch}; the release commit exists only in this clone, on ${branch}.`);
  }
  const body = `${notes}\n\n---\n\nMerge with **Rebase and merge**: the Release workflow then tags the merged commit `
    + `${tag} and publishes the GitHub release.\n`;
  const opened = exec('gh', ['pr', 'create', '--base', BASE_BRANCH, '--head', branch, '--title', subject, '--body', body], { inherit: true });
  if (opened.status !== 0) {
    throw new Refusal(`${branch} is on origin, but gh could not open its pull request (on GitHub the repository has to `
      + 'allow it: Settings → Actions → General → "Allow GitHub Actions to create and approve pull requests"). '
      + `Open it by hand: gh pr create --base ${BASE_BRANCH} --head ${branch} --fill`);
  }
}

function tagRelease({ cwd, exec, say }) {
  const git = gitRunner(exec);
  const tag = `v${JSON.parse(readText(cwd, 'package.json')).version}`;
  if (hasTag(exec, tag)) {
    say(`release: ${tag} is already tagged.`);
    return tag;
  }
  const commit = findReleaseCommit(git('log', '--first-parent', '--format=%H%x09%s', 'HEAD').split('\n'), tag);
  if (!commit) {
    throw new Refusal(`package.json is at ${tag}, but no "chore(release): ${tag}" commit on this branch released it; nothing was tagged.`);
  }
  git('tag', '-a', tag, '-m', tag, commit);
  if (exec('git', ['push', 'origin', `refs/tags/${tag}`], {}).status !== 0) {
    throw new Refusal(`origin refused ${tag}; the tag exists only in this clone.`);
  }
  say(`release: tagged ${commit.slice(0, 7)} as ${tag} and pushed the tag.`);
  return tag;
}

const hasTag = (exec, tag) => exec('git', ['rev-parse', '--quiet', '--verify', `refs/tags/${tag}`], {}).status === 0;

const gitRunner = (exec) => (...args) => {
  const result = exec('git', args, {});
  if (result.status !== 0) throw new Refusal(`git ${args.join(' ')} failed (exit ${result.status}).`);
  return result.stdout;
};

const readText = (cwd, path) => fs.readFileSync(join(cwd, path), 'utf8');

function toRefusal(compute) {
  try {
    return compute();
  } catch (error) {
    throw new Refusal(error.message);
  }
}
