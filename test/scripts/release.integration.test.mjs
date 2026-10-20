// The release command against real git: a clone on develop and a bare origin it pushes to.
// Only `npm test` is stubbed; the unit tests cover what happens when it fails.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runRelease } from '../../scripts/lib/release-cli.mjs';

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
  return { root, origin, clone };
}

const release = (repo, argv) => {
  const out = [];
  const stream = { write: (text) => out.push(text) };
  const exec = (command, args) => (command === 'npm' ? { status: 0, stdout: '' } : run(repo.clone, command, args));
  const code = runRelease({ argv, cwd: repo.clone, exec, today: '2026-10-21', stdout: stream, stderr: stream });
  return { code, text: out.join('') };
};

const originJson = (repo, path) => JSON.parse(git(repo.origin, 'show', `develop:${path}`));

test('a pushed release reaches origin as one commit on develop with an annotated tag on it', (t) => {
  const repo = repository(t);
  const result = release(repo, ['patch', '--push']);
  assert.equal(result.code, 0, result.text);

  const head = git(repo.clone, 'rev-parse', 'HEAD');
  assert.equal(git(repo.origin, 'rev-parse', 'develop'), head);
  assert.equal(git(repo.origin, 'cat-file', '-t', 'v0.1.1'), 'tag');
  assert.equal(git(repo.origin, 'rev-parse', 'v0.1.1^{commit}'), head);
  assert.equal(git(repo.origin, 'log', '-1', '--format=%s', 'develop'), 'LS-2 chore(release): v0.1.1');
  assert.equal(originJson(repo, 'package.json').version, '0.1.1');
  assert.equal(originJson(repo, '.claude-plugin/plugin.json').version, '0.1.1');
  assert.equal(originJson(repo, '.claude-plugin/marketplace.json').plugins[0].version, '0.1.1');
  assert.match(git(repo.origin, 'show', 'develop:CHANGELOG.md'), /## \[Unreleased\]\n\n## \[0\.1\.1\] - 2026-10-21\n\n### Fixed\n\n- A bug\./);
  assert.equal(git(repo.clone, 'status', '--porcelain'), '');
});

test('when develop moved on at origin, origin refuses the whole push: neither commit nor tag', (t) => {
  const repo = repository(t);
  const other = join(repo.root, 'other');
  git(repo.root, 'clone', '--quiet', repo.origin, other);
  configure(other);
  writeFileSync(join(other, 'NOTES.md'), 'Meanwhile.\n');
  git(other, 'add', 'NOTES.md');
  git(other, 'commit', '--quiet', '-m', 'LS-2 docs: meanwhile');
  git(other, 'push', '--quiet', 'origin', 'develop');
  const moved = git(other, 'rev-parse', 'HEAD');

  const result = release(repo, ['patch', '--push']);
  assert.equal(result.code, 2);
  assert.match(result.text, /neither develop nor v0\.1\.1/);
  assert.equal(git(repo.origin, 'rev-parse', 'develop'), moved);
  assert.equal(git(repo.origin, 'tag', '--list'), '');
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

test('a dry run leaves the clone, its tags and origin as they were', (t) => {
  const repo = repository(t);
  const head = git(repo.clone, 'rev-parse', 'HEAD');

  const result = release(repo, ['minor', '--dry-run', '--push']);
  assert.equal(result.code, 0, result.text);
  assert.match(result.text, /0\.1\.0 → 0\.2\.0/);
  assert.equal(git(repo.clone, 'rev-parse', 'HEAD'), head);
  assert.equal(git(repo.clone, 'status', '--porcelain'), '');
  assert.equal(git(repo.clone, 'tag', '--list'), '');
  assert.equal(git(repo.origin, 'rev-parse', 'develop'), head);
});

test('a second release with nothing new under [Unreleased] is refused', (t) => {
  const repo = repository(t);
  assert.equal(release(repo, ['patch', '--push']).code, 0);

  const result = release(repo, ['patch', '--push']);
  assert.equal(result.code, 2);
  assert.match(result.text, /\[Unreleased\] section of CHANGELOG\.md is empty/);
  assert.equal(git(repo.origin, 'tag', '--list'), 'v0.1.1');
});
