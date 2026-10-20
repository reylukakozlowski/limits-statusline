// The release commands against real git: a clone on develop and a bare origin it pushes to.
// `npm test` and `gh` are stubbed; the unit tests cover what happens when they fail.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runRelease, runTagRelease } from '../../scripts/lib/release-cli.mjs';

const CHANGELOG = '# Changelog\n\n## [Unreleased]\n\n### Fixed\n\n- A bug.\n\n## [0.1.0] - 2026-10-20\n\n### Added\n\n- First.\n';

const run = (cwd, command, args) => {
  const result = spawnSync(command, args, { cwd, encoding: 'utf8' });
  return { status: result.status ?? 1, stdout: result.stdout ?? '' };
};

const git = (cwd, ...args) => {
  const result = run(cwd, 'git', args);
  assert.equal(result.status, 0, `git ${args.join(' ')}`);
  return result.stdout.trim();
};

// Identity and signing are set per repository, so the machine's global git config never applies.
const configure = (dir) => {
  for (const [key, value] of [['user.name', 'Release Test'], ['user.email', 'release@example.com'], ['commit.gpgsign', 'false'], ['tag.gpgsign', 'false']]) {
    git(dir, 'config', key, value);
  }
};

function repository(t) {
  const root = mkdtempSync(join(tmpdir(), 'ls-release-git-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const origin = join(root, 'origin.git');
  const clone = join(root, 'clone');
  git(root, 'init', '--quiet', '--bare', '--initial-branch=develop', origin);
  git(root, 'init', '--quiet', '--initial-branch=develop', clone);
  configure(clone);
  mkdirSync(join(clone, '.claude-plugin'));
  const json = (path, value) => writeFileSync(join(clone, path), `${JSON.stringify(value, null, 2)}\n`);
  json('package.json', { name: 'limits-statusline', version: '0.1.0' });
  json('.claude-plugin/plugin.json', { name: 'limits-statusline', version: '0.1.0' });
  json('.claude-plugin/marketplace.json', { name: 'sealoop', plugins: [{ name: 'limits-statusline', source: './', version: '0.1.0' }] });
  writeFileSync(join(clone, 'CHANGELOG.md'), CHANGELOG);
  git(clone, 'add', '.');
  git(clone, 'commit', '--quiet', '-m', 'LS-1 feat: first');
  git(clone, 'remote', 'add', 'origin', origin);
  git(clone, 'push', '--quiet', 'origin', 'develop');
  return { root, origin, clone, pullRequests: [] };
}

const capture = () => {
  const out = [];
  const err = [];
  return { stdout: { write: (text) => out.push(text) }, stderr: { write: (text) => err.push(text) }, out, err };
};

const release = (repo, argv) => {
  const streams = capture();
  const exec = (command, args) => {
    if (command === 'npm') return { status: 0, stdout: '' };
    if (command === 'gh') {
      repo.pullRequests.push(args);
      return { status: 0, stdout: '' };
    }
    return run(repo.clone, command, args);
  };
  const code = runRelease({ argv, cwd: repo.clone, exec, today: '2026-10-21', ...streams });
  return { code, text: [...streams.out, ...streams.err].join('') };
};

/** A fresh clone of origin, as the workflow's checkout makes one, running tag-release. */
const tagRelease = (repo, name) => {
  const dir = join(repo.root, name);
  git(repo.root, 'clone', '--quiet', repo.origin, dir);
  configure(dir);
  const streams = capture();
  const code = runTagRelease({ cwd: dir, exec: (command, args) => run(dir, command, args), ...streams });
  return { code, out: streams.out.join(''), text: [...streams.out, ...streams.err].join('') };
};

/** Another commit lands on develop at origin, through some other clone. */
function moveDevelopOn(repo) {
  const other = join(repo.root, 'other');
  git(repo.root, 'clone', '--quiet', repo.origin, other);
  configure(other);
  writeFileSync(join(other, 'NOTES.md'), 'Meanwhile.\n');
  git(other, 'add', 'NOTES.md');
  git(other, 'commit', '--quiet', '-m', 'LS-2 docs: meanwhile');
  git(other, 'push', '--quiet', 'origin', 'develop');
  return git(other, 'rev-parse', 'HEAD');
}

/** What Rebase and merge does on GitHub: the release commit, replayed on develop with a new SHA. */
function rebaseAndMerge(repo, branch) {
  const merger = join(repo.root, 'merger');
  git(repo.root, 'clone', '--quiet', repo.origin, merger);
  configure(merger);
  git(merger, 'cherry-pick', `origin/${branch}`);
  git(merger, 'push', '--quiet', 'origin', 'develop');
  git(merger, 'push', '--quiet', 'origin', '--delete', branch);
  return git(merger, 'rev-parse', 'HEAD');
}

const originJson = (repo, ref, path) => JSON.parse(git(repo.origin, 'show', `${ref}:${path}`));

test('a pushed release reaches origin as one commit on release/vX.Y.Z, with develop and the tags untouched', (t) => {
  const repo = repository(t);
  const developBefore = git(repo.origin, 'rev-parse', 'develop');
  const result = release(repo, ['patch', '--push']);
  assert.equal(result.code, 0, result.text);

  const head = git(repo.clone, 'rev-parse', 'HEAD');
  assert.equal(git(repo.origin, 'rev-parse', 'release/v0.1.1'), head);
  assert.equal(git(repo.origin, 'rev-parse', 'release/v0.1.1^'), developBefore);
  assert.equal(git(repo.origin, 'rev-parse', 'develop'), developBefore);
  assert.equal(git(repo.origin, 'tag', '--list'), '');
  assert.equal(git(repo.origin, 'log', '-1', '--format=%s', 'release/v0.1.1'), 'LS-2 chore(release): v0.1.1');
  assert.equal(originJson(repo, 'release/v0.1.1', 'package.json').version, '0.1.1');
  assert.equal(originJson(repo, 'release/v0.1.1', '.claude-plugin/plugin.json').version, '0.1.1');
  assert.equal(originJson(repo, 'release/v0.1.1', '.claude-plugin/marketplace.json').plugins[0].version, '0.1.1');
  assert.match(git(repo.origin, 'show', 'release/v0.1.1:CHANGELOG.md'), /## \[Unreleased\]\n\n## \[0\.1\.1\] - 2026-10-21\n\n### Fixed\n\n- A bug\./);
  assert.equal(git(repo.clone, 'status', '--porcelain'), '');
  assert.deepEqual(repo.pullRequests.map((args) => args.slice(0, 8)), [
    ['pr', 'create', '--base', 'develop', '--head', 'release/v0.1.1', '--title', 'LS-2 chore(release): v0.1.1'],
  ]);
});

test('once the pull request is rebased and merged, tag-release tags the merged commit at origin', (t) => {
  const repo = repository(t);
  assert.equal(release(repo, ['patch', '--push']).code, 0);
  const releaseCommit = git(repo.origin, 'rev-parse', 'release/v0.1.1');
  moveDevelopOn(repo);
  const merged = rebaseAndMerge(repo, 'release/v0.1.1');
  assert.notEqual(merged, releaseCommit);

  const result = tagRelease(repo, 'ci');
  assert.equal(result.code, 0, result.text);
  assert.equal(result.out, 'v0.1.1\n');
  assert.equal(git(repo.origin, 'cat-file', '-t', 'v0.1.1'), 'tag');
  assert.equal(git(repo.origin, 'rev-parse', 'v0.1.1^{commit}'), merged);

  const again = tagRelease(repo, 'ci-again');
  assert.equal(again.code, 0, again.text);
  assert.equal(again.out, 'v0.1.1\n');
  assert.equal(git(repo.origin, 'rev-parse', 'v0.1.1^{commit}'), merged);
});

test('tag-release refuses when develop carries a version no release commit set', (t) => {
  const repo = repository(t);
  const result = tagRelease(repo, 'ci');
  assert.equal(result.code, 2);
  assert.equal(result.out, '');
  assert.match(result.text, /no "chore\(release\): v0\.1\.0" commit/);
  assert.equal(git(repo.origin, 'tag', '--list'), '');
});

test('a release branch already at origin stops the release before anything is written', (t) => {
  const repo = repository(t);
  git(repo.clone, 'push', '--quiet', 'origin', 'develop:refs/heads/release/v0.1.1');
  const head = git(repo.clone, 'rev-parse', 'HEAD');

  const result = release(repo, ['patch', '--push']);
  assert.equal(result.code, 2);
  assert.match(result.text, /origin already has release\/v0\.1\.1/);
  assert.equal(git(repo.clone, 'rev-parse', '--abbrev-ref', 'HEAD'), 'develop');
  assert.equal(git(repo.clone, 'rev-parse', 'HEAD'), head);
  assert.equal(git(repo.clone, 'status', '--porcelain'), '');
  assert.deepEqual(repo.pullRequests, []);
});

test('an existing tag stops the release before anything is written', (t) => {
  const repo = repository(t);
  git(repo.clone, 'tag', '-a', 'v0.1.1', '-m', 'v0.1.1');
  const head = git(repo.clone, 'rev-parse', 'HEAD');

  const result = release(repo, ['patch', '--push']);
  assert.equal(result.code, 2);
  assert.match(result.text, /tag v0\.1\.1 already exists/);
  assert.equal(git(repo.clone, 'rev-parse', 'HEAD'), head);
  assert.equal(git(repo.clone, 'status', '--porcelain'), '');
  assert.equal(git(repo.origin, 'tag', '--list'), '');
});

test('a dry run leaves the clone, its branches and origin as they were', (t) => {
  const repo = repository(t);
  const head = git(repo.clone, 'rev-parse', 'HEAD');

  const result = release(repo, ['minor', '--dry-run', '--push']);
  assert.equal(result.code, 0, result.text);
  assert.match(result.text, /0\.1\.0 → 0\.2\.0/);
  assert.equal(git(repo.clone, 'rev-parse', 'HEAD'), head);
  assert.equal(git(repo.clone, 'branch', '--list', 'release/*'), '');
  assert.equal(git(repo.clone, 'status', '--porcelain'), '');
  assert.equal(git(repo.origin, 'branch', '--list', 'release/*'), '');
  assert.equal(git(repo.origin, 'rev-parse', 'develop'), head);
  assert.deepEqual(repo.pullRequests, []);
});

test('after a merged release, a second one with nothing new under [Unreleased] is refused', (t) => {
  const repo = repository(t);
  assert.equal(release(repo, ['patch', '--push']).code, 0);
  rebaseAndMerge(repo, 'release/v0.1.1');
  git(repo.clone, 'switch', '--quiet', 'develop');
  git(repo.clone, 'pull', '--quiet', '--ff-only', 'origin', 'develop');

  const result = release(repo, ['patch', '--push']);
  assert.equal(result.code, 2);
  assert.match(result.text, /\[Unreleased\] section of CHANGELOG\.md is empty/);
  assert.equal(git(repo.origin, 'branch', '--list', 'release/*'), '');
});
