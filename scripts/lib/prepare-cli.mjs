// node scripts/prepare-release.mjs <patch|minor|major> [--push] [--dry-run]
// Prepares a release: raises the version in .claude-plugin/plugin.json from the last version tag by
// the part the owner picked, on a branch of its own and in one commit, as every change reaches
// develop. --push pushes the branch and opens a draft pull request into develop; the owner marks it
// ready, which runs the tests, and merges it, and the Release workflow then tags that version.
// --dry-run shows the plan and writes nothing.
// stdout holds the branch (with --push the pull request's address) and nothing else; every report
// goes to stderr.
// Exit codes: 0 done, nothing to do or dry run; 1 usage error; 2 refused or failed.

import { parseArgs } from 'node:util';
import { BASE_BRANCH, Refusal, VERSION_TAGS, gitRunner, lines, manifestVersion, toRefusal } from './release-common.mjs';
import { BUMPS, latestVersion, nextChangeNumber, nextVersion, withManifestVersion } from './release-lib.mjs';

const MANIFEST_PATH = '.claude-plugin/plugin.json';
const CHANGE_PREFIX = 'LS';
const BRANCH_FOLDER = 'feature/lko/develop/';
const USAGE = 'Usage: node scripts/prepare-release.mjs <patch|minor|major> [--push] [--dry-run]';

/**
 * @param {{ argv: string[], exec: import('./release-common.mjs').Exec, readManifest: () => string,
 *   writeManifest: (text: string) => void, stdout: { write(text: string): void }, stderr: { write(text: string): void } }} io
 * @returns {number}
 */
export function runPrepare({ argv, exec, readManifest, writeManifest, stdout, stderr }) {
  let options;
  try {
    options = parseOptions(argv);
  } catch (error) {
    stderr.write(`prepare: ${error.message}\n${USAGE}\n`);
    return 1;
  }
  try {
    const printed = prepare({ ...options, exec, readManifest, writeManifest, say: (text) => stderr.write(`${text}\n`) });
    if (printed) stdout.write(`${printed}\n`);
    return 0;
  } catch (error) {
    if (!(error instanceof Refusal)) throw error;
    stderr.write(`prepare: ${error.message}\n`);
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

/** @returns {string | null} what stdout carries: the branch, the pull request's address, or nothing */
function prepare({ bump, shouldPush, isDryRun, exec, readManifest, writeManifest, say }) {
  const git = gitRunner(exec);
  const plan = planPrepare({ bump, readManifest, git });

  if (plan.isPrepared) {
    say(`prepare: plugin.json already says ${plan.version}, the ${bump} after ${plan.current}; run the Release workflow.`);
    return null;
  }
  if (isDryRun) {
    say(`prepare (dry run): ${plan.current} → ${plan.version} on ${plan.branch}, "${plan.title}"`
      + `${shouldPush ? ', pushed with a draft pull request into develop' : ''}.`);
    return null;
  }

  git('switch', '-c', plan.branch);
  writeManifest(withManifestVersion(readManifest(), plan.version));
  git('add', MANIFEST_PATH);
  git('commit', '-q', '-m', plan.title, '-m', plan.body);
  say(`prepare: ${plan.branch} raises plugin.json to ${plan.version}.`);
  if (!shouldPush) {
    say(`prepare: push it with \`git push origin ${plan.branch}\` and open a pull request into ${BASE_BRANCH}.`);
    return plan.branch;
  }
  if (exec('git', ['push', 'origin', plan.branch], { inherit: true }).status !== 0) {
    throw new Refusal(`origin refused ${plan.branch}; the commit exists only in this clone.`);
  }
  const pullRequest = exec('gh', ['pr', 'create', '--draft', '--base', BASE_BRANCH, '--head', plan.branch, '--title', plan.title, '--body', plan.body], {});
  if (pullRequest.status !== 0) throw new Refusal(`gh could not open the pull request for ${plan.branch}; open it by hand.`);
  return pullRequest.stdout.trim();
}

/** Reads the repository and works the preparation out, refusing before anything is written. */
function planPrepare({ bump, readManifest, git }) {
  const branch = git('rev-parse', '--abbrev-ref', 'HEAD').trim();
  if (branch !== BASE_BRANCH) throw new Refusal(`a release is prepared from ${BASE_BRANCH}, not ${branch}.`);
  if (git('status', '--porcelain').trim() !== '') throw new Refusal('the working tree has uncommitted changes.');

  const previous = latestVersion(lines(git('tag', '--list', VERSION_TAGS, '--merged', 'HEAD')));
  const current = previous ?? '0.0.0';
  if (lines(git('log', '--format=%s', previous ? `v${previous}..HEAD` : 'HEAD')).length === 0) {
    throw new Refusal(`there are no commits since v${current} to release.`);
  }
  const version = toRefusal(() => nextVersion(previous, bump));
  const inManifest = manifestVersion(readManifest);
  if (inManifest === version) return { isPrepared: true, current, version };
  if (inManifest !== previous) {
    throw new Refusal(`plugin.json says ${inManifest ?? 'no version'}, not the released ${current}: it was raised by hand, `
      + 'so finish that pull request or put the version back first.');
  }

  // Any branch that prepares this version, whatever its number: one pull request per version.
  const existing = lines(git('ls-remote', '--heads', 'origin', `${BRANCH_FOLDER}*_version-${version}`));
  if (existing.length > 0) {
    throw new Refusal(`${existing[0].split('refs/heads/')[1]} prepares ${version} already; merge or close its pull request.`);
  }
  const names = [...lines(git('log', '--all', '--format=%s')), ...lines(git('for-each-ref', '--format=%(refname:short)', 'refs/heads', 'refs/remotes'))];
  const number = nextChangeNumber(names, CHANGE_PREFIX);
  const versionBranch = `${BRANCH_FOLDER}${CHANGE_PREFIX}-${number}_version-${version}`;
  return {
    isPrepared: false,
    current,
    version,
    branch: versionBranch,
    title: `${CHANGE_PREFIX}-${number}_chore: plugin.json says ${version}, the version the next release tags`,
    body: `The ${bump} part raised after v${current}. Once this is merged, the Release workflow tags v${version}.`,
  };
}
