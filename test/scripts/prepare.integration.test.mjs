// The preparation of a release against real git: a clone on develop and a bare origin it pushes to.
// gh is a stand-in that prints a pull request's address; the unit tests cover what it is asked.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runPrepare } from '../../scripts/lib/prepare-cli.mjs';

const MANIFEST = join('.claude-plugin', 'plugin.json');
const PR_URL = 'https://github.com/owner/repo/pull/1';

const run = (cwd, command, args) => {
  const result = spawnSync(command, args, { cwd, encoding: 'utf8' });
  return { status: result.status ?? 1, stdout: result.stdout ?? '' };
};

const git = (cwd, ...args) => {
  const result = run(cwd, 'git', args);
  assert.equal(result.status, 0, `git ${args.join(' ')}`);
  return result.stdout.trim();
};

const commit = (dir, file, subject, text = `${subject}\n`) => {
  mkdirSync(join(dir, file, '..'), { recursive: true });
  writeFileSync(join(dir, file), text);
  git(dir, 'add', file);
  git(dir, 'commit', '--quiet', '-m', subject);
};

const manifest = (version) => `{\n  "name": "demo",\n  "version": "${version}"\n}\n`;

/** A clone on develop: v0.1.0 released with plugin.json at 0.1.0, then a change, all at origin. */
function repository(t) {
  const root = mkdtempSync(join(tmpdir(), 'ls-prepare-git-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const origin = join(root, 'origin.git');
  const clone = join(root, 'clone');
  git(root, 'init', '--quiet', '--bare', '--initial-branch=develop', origin);
  git(root, 'init', '--quiet', '--initial-branch=develop', clone);
  for (const [key, value] of [['user.name', 'Prepare Test'], ['user.email', 'prepare@example.com'], ['commit.gpgsign', 'false'], ['tag.gpgsign', 'false']]) {
    git(clone, 'config', key, value);
  }
  commit(clone, MANIFEST, 'LS-1_feat: first', manifest('0.1.0'));
  git(clone, 'tag', '-a', 'v0.1.0', '-m', 'v0.1.0');
  commit(clone, 'a.txt', 'LS-2_fix: second');
  git(clone, 'remote', 'add', 'origin', origin);
  git(clone, 'push', '--quiet', '--follow-tags', 'origin', 'develop');
  return { origin, clone };
}

const prepare = (repo, argv) => {
  const out = [];
  const err = [];
  const exec = (command, args) => (command === 'gh' ? { status: 0, stdout: `${PR_URL}\n` } : run(repo.clone, command, args));
  const code = runPrepare({
    argv,
    exec,
    readManifest: () => readFileSync(join(repo.clone, MANIFEST), 'utf8'),
    writeManifest: (text) => writeFileSync(join(repo.clone, MANIFEST), text),
    stdout: { write: (text) => out.push(text) },
    stderr: { write: (text) => err.push(text) },
  });
  return { code, out: out.join(''), text: [...out, ...err].join('') };
};

const BRANCH = 'feature/lko/develop/LS-3_version-0.1.1';

test('a pushed preparation is one commit on a branch at origin that raises plugin.json alone', (t) => {
  const repo = repository(t);
  const develop = git(repo.origin, 'rev-parse', 'develop');
  const result = prepare(repo, ['patch', '--push']);
  assert.equal(result.code, 0, result.text);
  assert.equal(result.out, `${PR_URL}\n`);

  assert.equal(git(repo.origin, 'rev-parse', `${BRANCH}^`), develop);
  assert.equal(git(repo.origin, 'log', '-1', '--format=%s', BRANCH), 'LS-3_chore: plugin.json says 0.1.1, the version the next release tags');
  assert.equal(git(repo.origin, 'diff', '--name-only', develop, BRANCH), '.claude-plugin/plugin.json');
  assert.equal(git(repo.origin, 'show', `${BRANCH}:.claude-plugin/plugin.json`), manifest('0.1.1').trim());
  // develop itself is untouched: the version reaches it through the pull request.
  assert.equal(git(repo.origin, 'rev-parse', 'develop'), develop);
});

test('a dry run leaves the clone and origin as they were', (t) => {
  const repo = repository(t);
  const refs = git(repo.origin, 'for-each-ref', '--format=%(objectname) %(refname)');
  const result = prepare(repo, ['minor', '--dry-run', '--push']);
  assert.equal(result.code, 0, result.text);
  assert.match(result.text, /0\.1\.0 → 0\.2\.0/);
  assert.equal(git(repo.clone, 'rev-parse', '--abbrev-ref', 'HEAD'), 'develop');
  assert.equal(git(repo.clone, 'status', '--porcelain'), '');
  assert.equal(git(repo.origin, 'for-each-ref', '--format=%(objectname) %(refname)'), refs);
});

test('a second preparation of the same version stops before writing: the branch is on origin', (t) => {
  const repo = repository(t);
  assert.equal(prepare(repo, ['patch', '--push']).code, 0);
  git(repo.clone, 'switch', '--quiet', 'develop');
  const again = prepare(repo, ['patch', '--push']);
  assert.equal(again.code, 2, again.text);
  assert.match(again.text, /LS-3_version-0\.1\.1 prepares 0\.1\.1 already/);
  assert.equal(run(repo.origin, 'git', ['rev-parse', '--quiet', '--verify', 'refs/heads/feature/lko/develop/LS-4_version-0.1.1']).status, 1);
});
