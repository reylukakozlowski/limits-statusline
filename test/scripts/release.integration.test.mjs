// The release command against real git: a clone on develop and a bare origin, with master at the
// last release made the oldest way (v0.1.0 on develop's own commit). The command pushes nothing;
// `publish` stands for the Release workflow's promote job, whose checks run against real git in
// release-workflow.test.mjs. `npm test` is stubbed (it passes); the unit tests cover a failing one.

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
  return { status: result.status ?? 1, stdout: result.stdout ?? '', stderr: result.stderr || result.error?.message || '' };
};

const git = (cwd, ...args) => {
  const result = run(cwd, 'git', args);
  assert.equal(result.status, 0, `git ${args.join(' ')}: ${result.stderr.trim()}`);
  return result.stdout.trim();
};

// Identity, signing and line endings are set per repository, so the machine's git config never
// applies: Git for Windows sets core.autocrlf, which would write CRLF when the release checks out
// its commit to test it.
const configure = (dir) => {
  for (const [key, value] of [
    ['user.name', 'Release Test'], ['user.email', 'release@example.com'], ['commit.gpgsign', 'false'], ['tag.gpgsign', 'false'],
    ['core.autocrlf', 'false'],
  ]) {
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

const release = (repo, argv, { note } = {}) => {
  const out = [];
  const err = [];
  const exec = (command, args) => (command === 'npm' ? { status: 0, stdout: '' } : run(repo.clone, command, args));
  const code = runRelease({
    argv,
    note,
    exec,
    readManifest: () => readFileSync(join(repo.clone, MANIFEST), 'utf8'),
    writeManifest: (text) => writeFileSync(join(repo.clone, MANIFEST), text),
    stdout: { write: (text) => out.push(text) },
    stderr: { write: (text) => err.push(text) },
  });
  return { code, out: out.join(''), text: [...out, ...err].join('') };
};

/** What the Release workflow's promote job does once its checks pass: the tag and master, together. */
const publish = (repo, tag) => {
  git(repo.clone, 'push', '--quiet', '--atomic', 'origin', `refs/tags/${tag}`, `${tag}^{commit}:refs/heads/master`);
  git(repo.clone, 'fetch', '--quiet', 'origin');
};

/** A new develop commit at origin, as a merged pull request leaves it. */
const merged = (repo, file, subject) => {
  commit(repo.clone, file, subject);
  git(repo.clone, 'push', '--quiet', 'origin', 'develop');
  git(repo.clone, 'fetch', '--quiet', 'origin');
};

/** Every ref at origin, as `<sha> <ref>` lines. */
const originRefs = (repo) => git(repo.origin, 'for-each-ref', '--format=%(objectname) %(refname)');

const tagBody = (repo, tag) => git(repo.clone, 'tag', '--list', '--format=%(contents:body)', tag);

test('a release is a merge of develop into master: develop\'s files with plugin.json at the version, tagged, nothing pushed', (t) => {
  const repo = repository(t);
  const develop = git(repo.clone, 'rev-parse', 'develop');
  const refs = originRefs(repo);
  const result = release(repo, ['patch']);
  assert.equal(result.code, 0, result.text);
  assert.equal(result.out, 'v0.1.1\n');

  const tagged = git(repo.clone, 'rev-parse', 'v0.1.1^{commit}');
  assert.equal(git(repo.clone, 'rev-parse', `${tagged}^1`), git(repo.clone, 'rev-parse', 'origin/master'), 'master\'s head is its first parent');
  assert.equal(git(repo.clone, 'rev-parse', `${tagged}^2`), develop, 'develop\'s commit is its second parent');
  assert.equal(git(repo.clone, 'rev-list', '--parents', '-n', '1', tagged).split(' ').length, 3, 'two parents, no more');
  assert.equal(git(repo.clone, 'cat-file', '-t', 'v0.1.1'), 'tag');
  // Its files are develop's, the manifest alone carrying the version.
  assert.equal(git(repo.clone, 'diff', '--name-only', develop, tagged), '.claude-plugin/plugin.json');
  assert.equal(JSON.parse(git(repo.clone, 'show', `${tagged}:.claude-plugin/plugin.json`)).version, '0.1.1');
  // The message and the tag list develop's commits that master lacks, oldest first; no trailer.
  assert.equal(git(repo.clone, 'log', '-1', '--format=%B', tagged), 'Release v0.1.1\n\n- LS-2_feat: second\n- LS-3_fix: third');
  assert.equal(tagBody(repo, 'v0.1.1'), '- LS-2_feat: second\n- LS-3_fix: third');
  // develop, the clone's files and origin are untouched.
  assert.equal(git(repo.clone, 'rev-parse', 'develop'), develop);
  assert.equal(git(repo.clone, 'status', '--porcelain'), '');
  assert.equal(readFileSync(join(repo.clone, MANIFEST), 'utf8'), DEVELOP_MANIFEST);
  assert.equal(originRefs(repo), refs);
});

test('the owner\'s note comes first in the tag and the message, kept as written even when it starts with #', (t) => {
  const repo = repository(t);
  const result = release(repo, ['patch'], { note: '#42 is fixed: the band shows the weekly limit again.' });
  assert.equal(result.code, 0, result.text);
  const notes = '#42 is fixed: the band shows the weekly limit again.\n\n- LS-2_feat: second\n- LS-3_fix: third';
  assert.equal(tagBody(repo, 'v0.1.1'), notes);
  assert.equal(git(repo.clone, 'log', '-1', '--format=%B', 'v0.1.1^{commit}'), `Release v0.1.1\n\n${notes}`);
});

test('the next release lists only what develop gained since the last one, read from master', (t) => {
  const repo = repository(t);
  assert.equal(release(repo, ['patch']).code, 0);
  publish(repo, 'v0.1.1');
  merged(repo, 'c.txt', 'LS-4_feat: fourth');

  const result = release(repo, ['minor']);
  assert.equal(result.code, 0, result.text);
  assert.equal(result.out, 'v0.2.0\n');
  assert.equal(tagBody(repo, 'v0.2.0'), '- LS-4_feat: fourth');
  publish(repo, 'v0.2.0');
  assert.equal(git(repo.origin, 'rev-parse', 'master^1'), git(repo.origin, 'rev-parse', 'v0.1.1^{commit}'));
  assert.equal(git(repo.origin, 'rev-parse', 'master^2'), git(repo.origin, 'rev-parse', 'develop'));
  assert.equal(git(repo.origin, 'rev-list', '--first-parent', '--count', 'master'), '3', 'master: v0.1.0, v0.1.1, v0.2.0, one after another');
  // master holds develop's history: no commit of develop is missing from it.
  assert.equal(git(repo.origin, 'rev-list', '--count', 'master..develop'), '0');
});

test('a run again on the develop commit just released is refused: no new commit, tag or version', (t) => {
  const repo = repository(t);
  assert.equal(release(repo, ['patch']).code, 0);
  publish(repo, 'v0.1.1');
  const refs = originRefs(repo);

  const again = release(repo, ['patch']);
  assert.equal(again.code, 2, again.text);
  assert.equal(again.out, '');
  assert.match(again.text, /is in master already: nothing new since the last release/);
  assert.equal(git(repo.clone, 'tag', '--list'), 'v0.1.0\nv0.1.1');
  assert.equal(originRefs(repo), refs);
});

// develop is protected from force pushes on GitHub; this stands for a develop that lost the commit
// the last release was made from, which would put older files on master under a new version.
test('a develop that no longer holds the commit the release on master was made from is refused', (t) => {
  const repo = repository(t);
  assert.equal(release(repo, ['patch']).code, 0);
  publish(repo, 'v0.1.1');
  git(repo.clone, 'reset', '--quiet', '--hard', 'HEAD~1');
  commit(repo.clone, 'b.txt', 'LS-3_fix: third, again');
  git(repo.clone, 'push', '--quiet', '--force', 'origin', 'develop');
  git(repo.clone, 'fetch', '--quiet', 'origin');

  const result = release(repo, ['patch']);
  assert.equal(result.code, 2, result.text);
  assert.match(result.text, /lacks [0-9a-f]{7}, the develop commit of the release on master/);
  assert.equal(git(repo.clone, 'tag', '--list'), 'v0.1.0\nv0.1.1');
});

// The promote job pushes a tag and master in one atomic push; a tag that reached origin without
// master (a push made by hand) holds its version for good, since tags are never moved or deleted.
test('a tag that never reached master keeps its version: the next release takes the one after and lists all master lacks', (t) => {
  const repo = repository(t);
  assert.equal(release(repo, ['patch']).code, 0);
  git(repo.clone, 'push', '--quiet', 'origin', 'refs/tags/v0.1.1');
  merged(repo, 'c.txt', 'LS-4_feat: fourth');

  const result = release(repo, ['patch']);
  assert.equal(result.code, 0, result.text);
  assert.equal(result.out, 'v0.1.2\n');
  assert.equal(tagBody(repo, 'v0.1.2'), '- LS-2_feat: second\n- LS-3_fix: third\n- LS-4_feat: fourth');
  assert.equal(git(repo.clone, 'rev-parse', 'v0.1.2^{commit}^1'), git(repo.clone, 'rev-parse', 'origin/master'));
});

test('the first release of a repository without master sits on develop\'s commit alone', (t) => {
  const repo = repository(t, { withMaster: false });
  const result = release(repo, ['minor']);
  assert.equal(result.code, 0, result.text);
  assert.equal(git(repo.clone, 'rev-parse', 'v0.2.0^{commit}^'), git(repo.clone, 'rev-parse', 'develop'));
  assert.equal(git(repo.clone, 'rev-list', '--count', 'v0.2.0^{commit}'), '4', 'develop\'s three commits and the release');
});

test('a release from a commit origin\'s develop lacks, or with uncommitted changes, stops before anything is written', (t) => {
  const repo = repository(t);
  const refs = originRefs(repo);
  writeFileSync(join(repo.clone, 'a.txt'), 'changed\n');
  const dirty = release(repo, ['patch']);
  assert.equal(dirty.code, 2);
  assert.match(dirty.text, /uncommitted changes/);
  git(repo.clone, 'checkout', '--quiet', '--', 'a.txt');
  git(repo.clone, 'switch', '--quiet', '-c', 'feature/x');
  commit(repo.clone, 'x.txt', 'LS-9_feat: not merged');
  const offDevelop = release(repo, ['patch']);
  assert.equal(offDevelop.code, 2);
  assert.match(offDevelop.text, /feature\/x is not on origin\/develop/);
  assert.equal(git(repo.clone, 'tag', '--list'), 'v0.1.0');
  assert.equal(originRefs(repo), refs);
});

test('a dry run leaves the clone and origin as they were', (t) => {
  const repo = repository(t);
  const refs = originRefs(repo);
  const tags = git(repo.clone, 'tag', '--list');
  const result = release(repo, ['major', '--dry-run']);
  assert.equal(result.code, 0, result.text);
  assert.equal(result.out, '');
  assert.match(result.text, /0\.1\.0 → 1\.0\.0/);
  assert.match(result.text, /- LS-3_fix: third/);
  assert.equal(git(repo.clone, 'tag', '--list'), tags);
  assert.equal(git(repo.clone, 'status', '--porcelain'), '');
  assert.equal(originRefs(repo), refs);
});
