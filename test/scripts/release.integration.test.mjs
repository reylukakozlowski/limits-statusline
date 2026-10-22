// The release command against real git: a clone on develop and a bare origin it pushes to, with
// master at the last release made the old way (v0.1.0 on develop's own commit). `npm test` is
// stubbed; the unit tests cover what happens when it fails.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runRelease } from '../../scripts/lib/release-cli.mjs';

const MANIFEST = join('.claude-plugin', 'plugin.json');
const DEVELOP_MANIFEST = '{\n  "name": "demo",\n  "displayName": "Demo"\n}\n';

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

const commit = (dir, file, subject, text = `${subject}\n`) => {
  mkdirSync(join(dir, file, '..'), { recursive: true });
  writeFileSync(join(dir, file), text);
  git(dir, 'add', file);
  git(dir, 'commit', '--quiet', '-m', subject);
};

/** A clone on develop: v0.1.0 tagged on develop's first commit, which master points at, then two commits, all at origin. */
function repository(t, { withMaster = true } = {}) {
  const root = mkdtempSync(join(tmpdir(), 'ls-release-git-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const origin = join(root, 'origin.git');
  const clone = join(root, 'clone');
  git(root, 'init', '--quiet', '--bare', '--initial-branch=develop', origin);
  git(root, 'init', '--quiet', '--initial-branch=develop', clone);
  configure(clone);
  commit(clone, MANIFEST, 'LS-1_feat: first', DEVELOP_MANIFEST);
  git(clone, 'tag', '-a', 'v0.1.0', '-m', 'v0.1.0');
  git(clone, 'remote', 'add', 'origin', origin);
  if (withMaster) git(clone, 'push', '--quiet', 'origin', 'HEAD:refs/heads/master');
  commit(clone, 'a.txt', 'LS-2_feat: second');
  commit(clone, 'b.txt', 'LS-3_fix: third');
  git(clone, 'push', '--quiet', '--follow-tags', 'origin', 'develop');
  git(clone, 'fetch', '--quiet', 'origin');
  return { root, origin, clone };
}

const release = (repo, argv) => {
  const out = [];
  const err = [];
  const exec = (command, args) => (command === 'npm' ? { status: 0, stdout: '' } : run(repo.clone, command, args));
  const code = runRelease({
    argv,
    exec,
    readManifest: () => readFileSync(join(repo.clone, MANIFEST), 'utf8'),
    writeManifest: (text) => writeFileSync(join(repo.clone, MANIFEST), text),
    stdout: { write: (text) => out.push(text) },
    stderr: { write: (text) => err.push(text) },
  });
  return { code, out: out.join(''), text: [...out, ...err].join('') };
};

/** Every ref at origin, as `<sha> <ref>` lines. */
const originRefs = (repo) => git(repo.origin, 'for-each-ref', '--format=%(objectname) %(refname)');

test('a release is one commit on master: develop\'s files with plugin.json at the version, tagged and pushed', (t) => {
  const repo = repository(t);
  const develop = git(repo.origin, 'rev-parse', 'develop');
  const master = git(repo.origin, 'rev-parse', 'master');
  const result = release(repo, ['patch', '--push']);
  assert.equal(result.code, 0, result.text);
  assert.equal(result.out, 'v0.1.1\n');

  const tagged = git(repo.origin, 'rev-parse', 'v0.1.1^{commit}');
  assert.equal(git(repo.origin, 'rev-parse', 'master'), tagged);
  assert.equal(git(repo.origin, 'rev-parse', `${tagged}^`), master, 'the previous release is its parent: master moves forward');
  assert.equal(git(repo.origin, 'cat-file', '-t', 'v0.1.1'), 'tag');
  // Its files are develop's, the manifest alone carrying the version.
  assert.equal(git(repo.origin, 'diff', '--name-only', develop, tagged), '.claude-plugin/plugin.json');
  assert.equal(JSON.parse(git(repo.origin, 'show', `${tagged}:.claude-plugin/plugin.json`)).version, '0.1.1');
  // The message and the tag list develop's commits since the last release; the message names develop's head.
  assert.equal(git(repo.origin, 'log', '-1', '--format=%s', tagged), 'Release v0.1.1');
  assert.match(git(repo.origin, 'log', '-1', '--format=%B', tagged), new RegExp(`- LS-2_feat: second\\n- LS-3_fix: third\\n\\nSource: develop@${develop}`));
  assert.equal(git(repo.origin, 'tag', '--list', '--format=%(contents:body)', 'v0.1.1'), '- LS-2_feat: second\n- LS-3_fix: third');
  // develop is untouched, and so is the clone.
  assert.equal(git(repo.origin, 'rev-parse', 'develop'), develop);
  assert.equal(git(repo.clone, 'status', '--porcelain'), '');
  assert.equal(readFileSync(join(repo.clone, MANIFEST), 'utf8'), DEVELOP_MANIFEST);
});

test('the next release lists only what develop gained since the last one, read from its commit', (t) => {
  const repo = repository(t);
  assert.equal(release(repo, ['patch', '--push']).code, 0);
  commit(repo.clone, 'c.txt', 'LS-4_feat: fourth');
  git(repo.clone, 'push', '--quiet', 'origin', 'develop');
  git(repo.clone, 'fetch', '--quiet', 'origin');

  const result = release(repo, ['minor', '--push']);
  assert.equal(result.code, 0, result.text);
  assert.equal(result.out, 'v0.2.0\n');
  assert.equal(git(repo.origin, 'tag', '--list', '--format=%(contents:body)', 'v0.2.0'), '- LS-4_feat: fourth');
  assert.equal(git(repo.origin, 'rev-parse', 'master^'), git(repo.origin, 'rev-parse', 'v0.1.1^{commit}'));
  assert.equal(git(repo.origin, 'rev-list', '--count', 'master'), '3', 'master: v0.1.0, v0.1.1, v0.2.0, one after another');
});

test('running the release again on the same develop head finishes that release: no new tag', (t) => {
  const repo = repository(t);
  assert.equal(release(repo, ['patch', '--push']).code, 0);
  git(repo.clone, 'fetch', '--quiet', 'origin');
  const refs = originRefs(repo);

  const again = release(repo, ['patch', '--push']);
  assert.equal(again.code, 0, again.text);
  assert.equal(again.out, 'v0.1.1\n');
  assert.match(again.text, /finishing v0\.1\.1/);
  assert.equal(originRefs(repo), refs);
});

test('a release whose master push failed is finished first even after develop moved on, so master skips no version', (t) => {
  const repo = repository(t);
  assert.equal(release(repo, ['patch']).code, 0);
  git(repo.clone, 'push', '--quiet', 'origin', 'refs/tags/v0.1.1');
  commit(repo.clone, 'c.txt', 'LS-4_feat: fourth');
  git(repo.clone, 'push', '--quiet', 'origin', 'develop');
  git(repo.clone, 'fetch', '--quiet', 'origin');

  const finished = release(repo, ['patch', '--push']);
  assert.equal(finished.code, 0, finished.text);
  assert.equal(finished.out, 'v0.1.1\n');
  assert.match(finished.text, /master lacks it/);
  assert.equal(git(repo.origin, 'rev-parse', 'master'), git(repo.origin, 'rev-parse', 'v0.1.1^{commit}'));

  git(repo.clone, 'fetch', '--quiet', 'origin');
  const next = release(repo, ['patch', '--push']);
  assert.equal(next.code, 0, next.text);
  assert.equal(next.out, 'v0.1.2\n');
  assert.equal(git(repo.origin, 'tag', '--list', '--format=%(contents:body)', 'v0.1.2'), '- LS-4_feat: fourth');
  assert.equal(git(repo.origin, 'rev-list', '--count', 'master'), '3', 'master: v0.1.0, v0.1.1, v0.1.2');
});

test('a release whose master push failed is finished by the next run, which moves master to the tag', (t) => {
  const repo = repository(t);
  const local = release(repo, ['patch']);
  assert.equal(local.code, 0, local.text);
  git(repo.clone, 'push', '--quiet', 'origin', 'refs/tags/v0.1.1');
  const master = git(repo.origin, 'rev-parse', 'master');

  const finished = release(repo, ['patch', '--push']);
  assert.equal(finished.code, 0, finished.text);
  assert.equal(git(repo.origin, 'rev-parse', 'master'), git(repo.origin, 'rev-parse', 'v0.1.1^{commit}'));
  assert.equal(git(repo.origin, 'rev-parse', 'master^'), master);
});

test('the first release of a repository without master makes master with the release commit', (t) => {
  const repo = repository(t, { withMaster: false });
  const result = release(repo, ['minor', '--push']);
  assert.equal(result.code, 0, result.text);
  const tagged = git(repo.origin, 'rev-parse', 'v0.2.0^{commit}');
  assert.equal(git(repo.origin, 'rev-parse', 'master'), tagged);
  assert.equal(git(repo.origin, 'rev-list', '--count', 'master'), '1');
});

test('a release off develop or with uncommitted changes stops before anything is written', (t) => {
  const repo = repository(t);
  const refs = originRefs(repo);
  writeFileSync(join(repo.clone, 'a.txt'), 'changed\n');
  const dirty = release(repo, ['patch', '--push']);
  assert.equal(dirty.code, 2);
  assert.match(dirty.text, /uncommitted changes/);
  git(repo.clone, 'checkout', '--quiet', '--', 'a.txt');
  git(repo.clone, 'switch', '--quiet', '-c', 'feature/x');
  const offDevelop = release(repo, ['patch', '--push']);
  assert.equal(offDevelop.code, 2);
  assert.match(offDevelop.text, /cut from develop, not feature\/x/);
  assert.equal(git(repo.clone, 'tag', '--list'), 'v0.1.0');
  assert.equal(originRefs(repo), refs);
});

test('a dry run leaves the clone and origin as they were', (t) => {
  const repo = repository(t);
  const refs = originRefs(repo);
  const tags = git(repo.clone, 'tag', '--list');
  const result = release(repo, ['major', '--dry-run', '--push']);
  assert.equal(result.code, 0, result.text);
  assert.equal(result.out, '');
  assert.match(result.text, /0\.1\.0 → 1\.0\.0/);
  assert.match(result.text, /- LS-3_fix: third/);
  assert.equal(git(repo.clone, 'tag', '--list'), tags);
  assert.equal(git(repo.clone, 'status', '--porcelain'), '');
  assert.equal(originRefs(repo), refs);
});
