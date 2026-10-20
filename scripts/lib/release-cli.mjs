// npm run release -- <patch|minor|major|X.Y.Z> [--push] [--dry-run]
// Local release: checks, local tests, version bump in every manifest, changelog stamp,
// commit `LS-N chore(release): vX.Y.Z`, annotated tag. Pushing the tag lets the GitHub
// workflow publish the release; no tests run on GitHub.
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
  const git = (...args) => {
    const result = exec('git', args, {});
    if (result.status !== 0) throw new Refusal(`git ${args.join(' ')} failed (exit ${result.status}).`);
    return result.stdout;
  };

  const branch = git('rev-parse', '--abbrev-ref', 'HEAD').trim();
  if (branch !== RELEASE_BRANCH) throw new Refusal(`releases are cut from ${RELEASE_BRANCH}, not ${branch}.`);
  if (git('status', '--porcelain').trim() !== '') throw new Refusal('the working tree has uncommitted changes.');

  const read = (path) => fs.readFileSync(join(cwd, path), 'utf8');
  const current = JSON.parse(read('package.json')).version;
  const version = toRefusal(() => nextVersion(current, kind));
  const changelog = toRefusal(() => stampChangelog(read(CHANGELOG), version, today));
  const index = nextCommitIndex(git('log', '--format=%s').split('\n'));
  const subject = `${COMMIT_PREFIX}-${index} chore(release): v${version}`;

  if (isDryRun) {
    say(`release (dry run): ${current} → ${version}, commit "${subject}", tag v${version}${shouldPush ? ', push' : ''}.`);
    say(extractReleaseNotes(changelog, version));
    return;
  }

  if (exec('npm', ['test'], { inherit: true }).status !== 0) throw new Refusal('tests failed; nothing was changed.');

  for (const path of MANIFESTS) {
    fs.writeFileSync(join(cwd, path), `${JSON.stringify(withVersion(JSON.parse(read(path)), version), null, 2)}\n`);
  }
  fs.writeFileSync(join(cwd, CHANGELOG), changelog);

  git('add', ...MANIFESTS, CHANGELOG);
  git('commit', '-m', subject);
  git('tag', '-a', `v${version}`, '-m', `v${version}`);
  if (shouldPush) git('push', 'origin', RELEASE_BRANCH, '--follow-tags');
  say(`release: v${version} committed and tagged${shouldPush ? ' and pushed; GitHub publishes the release' : '. Push with: git push origin develop --follow-tags'}.`);
}

function toRefusal(compute) {
  try {
    return compute();
  } catch (error) {
    throw new Refusal(error.message);
  }
}
