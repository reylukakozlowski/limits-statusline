// The release command against real git: a clone on develop and a bare origin it pushes to.
// `npm test` is stubbed; the unit tests cover what happens when it fails.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runRelease } from '../../scripts/lib/release-cli.mjs';

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

const commit = (dir, file, subject) => {
  writeFileSync(join(dir, file), `${subject}\n`);
  git(dir, 'add', file);
  git(dir, 'commit', '--quiet', '-m', subject);
};

/** A clone on develop whose first commit is released as v0.1.0, two commits after it, all at origin. */
function repository(t) {
  const root = mkdtempSync(join(tmpdir(), 'ls-release-git-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const origin = join(root, 'origin.git');
  const clone = join(root, 'clone');
  git(root, 'init', '--quiet', '--bare', '--initial-branch=develop', origin);
  git(root, 'init', '--quiet', '--initial-branch=develop', clone);
  configure(clone);
  commit(clone, 'README.md', 'LS-1_feat: first');
  git(clone, 'tag', '-a', 'v0.1.0', '-m', 'v0.1.0');
  commit(clone, 'a.txt', 'LS-2_feat: second');
  commit(clone, 'b.txt', 'LS-3_fix: third');
  git(clone, 'remote', 'add', 'origin', origin);
  git(clone, 'push', '--quiet', '--follow-tags', 'origin', 'develop');
  return { root, origin, clone };
}

const release = (repo, argv) => {
  const out = [];
  const err = [];
  const exec = (command, args) => (command === 'npm' ? { status: 0, stdout: '' } : run(repo.clone, command, args));
  const code = runRelease({ argv, exec, stdout: { write: (text) => out.push(text) }, stderr: { write: (text) => err.push(text) } });
  return { code, out: out.join(''), text: [...out, ...err].join('') };
};

/** Every ref at origin, as `<sha> <ref>` lines. */
const originRefs = (repo) => git(repo.origin, 'for-each-ref', '--format=%(objectname) %(refname)');

test('a pushed release is an annotated tag on develop\'s head at origin, listing the commits since the last tag', (t) => {
  const repo = repository(t);
  const head = git(repo.origin, 'rev-parse', 'develop');
  const result = release(repo, ['patch', '--push']);
  assert.equal(result.code, 0, result.text);
  assert.equal(result.out, 'v0.1.1\n');

  assert.equal(git(repo.origin, 'cat-file', '-t', 'v0.1.1'), 'tag');
  assert.equal(git(repo.origin, 'rev-parse', 'v0.1.1^{commit}'), head);
  // What the workflow puts in the GitHub release.
  assert.equal(git(repo.origin, 'tag', '--list', '--format=%(contents:body)', 'v0.1.1'), '- LS-2_feat: second\n- LS-3_fix: third');
  assert.equal(git(repo.origin, 'tag', '--list', '--format=%(contents:subject)', 'v0.1.1'), 'v0.1.1');
  // Nothing else changed: no commit, no branch.
  assert.equal(git(repo.origin, 'rev-parse', 'develop'), head);
  assert.equal(git(repo.origin, 'for-each-ref', '--format=%(refname)', 'refs/heads'), 'refs/heads/develop');
  assert.equal(git(repo.clone, 'status', '--porcelain'), '');
});

test('running the release again on the same head finishes that release: the same tag, no new one', (t) => {
  const repo = repository(t);
  assert.equal(release(repo, ['patch', '--push']).code, 0);
  const refs = originRefs(repo);

  const again = release(repo, ['minor', '--push']);
  assert.equal(again.code, 0, again.text);
  assert.equal(again.out, 'v0.1.1\n');
  assert.match(again.text, /already v0\.1\.1/);
  assert.equal(originRefs(repo), refs);
});

test('a tag pushed from a computer without --push is finished by a later run with --push', (t) => {
  const repo = repository(t);
  const local = release(repo, ['patch']);
  assert.equal(local.code, 0, local.text);
  assert.match(local.text, /git push origin refs\/tags\/v0\.1\.1/);
  assert.equal(run(repo.origin, 'git', ['rev-parse', '--quiet', '--verify', 'refs/tags/v0.1.1']).status, 1);

  const pushed = release(repo, ['patch', '--push']);
  assert.equal(pushed.code, 0, pushed.text);
  assert.equal(git(repo.origin, 'cat-file', '-t', 'v0.1.1'), 'tag');
});

test('a tag of the next version on a commit outside develop stops the release before anything is written', (t) => {
  const repo = repository(t);
  git(repo.clone, 'switch', '--quiet', '--detach', 'v0.1.0');
  commit(repo.clone, 'side.txt', 'LS-4_fix: elsewhere');
  git(repo.clone, 'tag', '-a', 'v0.1.1', '-m', 'v0.1.1');
  git(repo.clone, 'switch', '--quiet', 'develop');
  const refs = originRefs(repo);

  const result = release(repo, ['patch', '--push']);
  assert.equal(result.code, 2);
  assert.match(result.text, /tag v0\.1\.1 already exists/);
  assert.equal(originRefs(repo), refs);
});

test('a dry run leaves the clone and origin as they were', (t) => {
  const repo = repository(t);
  const refs = originRefs(repo);
  const tags = git(repo.clone, 'tag', '--list');

  const result = release(repo, ['minor', '--dry-run', '--push']);
  assert.equal(result.code, 0, result.text);
  assert.equal(result.out, '');
  assert.match(result.text, /0\.1\.0 → 0\.2\.0/);
  assert.match(result.text, /- LS-3_fix: third/);
  assert.equal(git(repo.clone, 'tag', '--list'), tags);
  assert.equal(originRefs(repo), refs);
});
