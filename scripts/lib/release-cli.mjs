// npm run release -- <patch|minor|major|X.Y.Z> [--push] [--dry-run]
// Cuts a release on develop: checks, tests, version bump in every manifest, changelog stamp,
// commit `LS-N chore(release): vX.Y.Z` and an annotated tag. --push sends the branch and the tag
// in one atomic push, so origin gets both or neither. --dry-run runs the same checks and tests and
// writes nothing. The Release workflow (.github/workflows/release.yml) runs this command on GitHub,
// then publishes the GitHub release.
// Exit codes: 0 released (or dry run), 1 usage error, 2 refused or failed.

import fs from 'node:fs';
import { join } from 'node:path';
import { parseArgs } from 'node:util';
import { extractReleaseNotes, nextCommitIndex, nextVersion, stampChangelog, withVersion, COMMIT_PREFIX } from './release-lib.mjs';

const RELEASE_BRANCH = 'develop';
const MANIFESTS = Object.freeze(['package.json', '.claude-plugin/plugin.json', '.claude-plugin/marketplace.json']);
const CHANGELOG = 'CHANGELOG.md';

class Refusal extends Error {}

/**
 * @param {{
 *   argv: string[], cwd: string, today: string,
 *   exec: (command: string, args: string[], options?: { inherit?: boolean }) => { status: number, stdout: string },
 *   stdout: { write(text: string): void }, stderr: { write(text: string): void },
 * }} io
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
  try {
    release({ ...options, cwd, exec, today, say: (text) => stdout.write(`${text}\n`) });
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
  const plan = planRelease({ kind, cwd, exec, git, today });

  if (exec('npm', ['test'], { inherit: true }).status !== 0) throw new Refusal('tests failed; nothing was changed.');

  if (isDryRun) {
    say(`release (dry run): ${plan.current} → ${plan.version}, commit "${plan.subject}", tag ${plan.tag}${shouldPush ? ', push' : ''}.`);
    say(extractReleaseNotes(plan.changelog, plan.version));
    return;
  }

  writeRelease(plan, cwd);
  git('add', ...MANIFESTS, CHANGELOG);
  git('commit', '-m', plan.subject);
  git('tag', '-a', plan.tag, '-m', plan.tag);
  if (shouldPush) pushAtomically(plan.tag, exec);
  say(`release: ${plan.tag} committed and tagged${shouldPush
    ? ' and pushed; GitHub publishes the release'
    : `. Push with: git push --atomic origin ${RELEASE_BRANCH} refs/tags/${plan.tag}`}.`);
}

/** Reads the repository and works the release out, refusing before anything is written. */
function planRelease({ kind, cwd, exec, git, today }) {
  const branch = git('rev-parse', '--abbrev-ref', 'HEAD').trim();
  if (branch !== RELEASE_BRANCH) throw new Refusal(`releases are cut from ${RELEASE_BRANCH}, not ${branch}.`);
  if (git('status', '--porcelain').trim() !== '') throw new Refusal('the working tree has uncommitted changes.');

  const current = JSON.parse(readText(cwd, 'package.json')).version;
  const version = toRefusal(() => nextVersion(current, kind));
  const tag = `v${version}`;
  if (exec('git', ['rev-parse', '--quiet', '--verify', `refs/tags/${tag}`], {}).status === 0) {
    throw new Refusal(`tag ${tag} already exists.`);
  }
  const changelog = toRefusal(() => stampChangelog(readText(cwd, CHANGELOG), version, today));
  const index = nextCommitIndex(git('log', '--format=%s').split('\n'));
  return { current, version, tag, changelog, subject: `${COMMIT_PREFIX}-${index} chore(release): ${tag}` };
}

function writeRelease({ version, changelog }, cwd) {
  for (const path of MANIFESTS) {
    fs.writeFileSync(join(cwd, path), `${JSON.stringify(withVersion(JSON.parse(readText(cwd, path)), version), null, 2)}\n`);
  }
  fs.writeFileSync(join(cwd, CHANGELOG), changelog);
}

/** Branch and tag in one atomic push: origin takes both, or neither when develop moved on there. */
function pushAtomically(tag, exec) {
  const pushed = exec('git', ['push', '--atomic', 'origin', RELEASE_BRANCH, `refs/tags/${tag}`], { inherit: true });
  if (pushed.status !== 0) {
    throw new Refusal(`origin refused the push, so it got neither ${RELEASE_BRANCH} nor ${tag} (did ${RELEASE_BRANCH} move on there?). `
      + 'The release commit and its tag exist only in this clone.');
  }
}

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
