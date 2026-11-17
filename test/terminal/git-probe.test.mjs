import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { HEAD_MAX_BYTES, probeGit } from '../../src/terminal/git-probe.mjs';

test('probeGit asks git about the given folder and parses the answer', () => {
  const calls = [];
  const spawn = (cmd, args, options) => {
    calls.push({ cmd, args, options });
    return { status: 0, stdout: '# branch.oid abc\n# branch.head develop\n' };
  };
  assert.deepEqual(probeGit('/repo', { spawn }), { isRepo: true, branch: 'develop', isDirty: false });
  assert.equal(calls[0].cmd, 'git');
  assert.deepEqual(calls[0].args.slice(0, 3), ['-C', '/repo', '--no-optional-locks']);
  assert.equal(calls[0].options.timeout, 1000);
  // The lock is an argument, so git gets the status line's environment as it is.
  assert.equal(calls[0].options.env, undefined);
});

/** A disk of `entries` (path → text, or null for a folder) for probeGit to look at. */
const disk = (entries) => ({
  existsSync: (path) => Object.hasOwn(entries, path),
  statSync: (path) => {
    if (!Object.hasOwn(entries, path)) throw new Error(`no ${path}`);
    return { isFile: () => typeof entries[path] === 'string', size: Buffer.byteLength(entries[path] ?? '') };
  },
  readFileSync: (path) => {
    if (typeof entries[path] !== 'string') throw new Error(`cannot read ${path}`);
    return entries[path];
  },
});
const MISSING = () => ({ error: new Error('spawnSync git ENOENT') });
const TIMED_OUT = () => ({ error: new Error('spawnSync git ETIMEDOUT'), status: null, stdout: '' });
const REFUSED = () => ({ status: 128, stdout: '' }); // "not a git repository", or an owner git does not trust

test('probeGit asks nothing without a folder', () => {
  assert.equal(probeGit(null, { spawn: () => assert.fail('must not run') }), null);
  assert.equal(probeGit('', { spawn: () => assert.fail('must not run') }), null);
});

// A slow or refusing git used to read as "no git" inside a real repository.
test('when git is missing, too slow or refuses, the branch comes from the HEAD of the nearest .git', () => {
  const files = disk({ '/work/project/.git': null, '/work/project/.git/HEAD': 'ref: refs/heads/feature/LS-88_git-head\n' });
  for (const spawn of [MISSING, TIMED_OUT, REFUSED]) {
    assert.deepEqual(probeGit('/work/project/src/core', { spawn, files }),
      { isRepo: true, branch: 'feature/LS-88_git-head', isDirty: false });
  }
});

test('a worktree is read through its .git file, and a HEAD that cannot be read leaves the branch unknown', () => {
  const worktree = disk({
    '/work/project/.git': null,
    '/work/project/.git/HEAD': 'ref: refs/heads/develop\n',
    '/work/trees/fix/.git': 'gitdir: /work/project/.git/worktrees/fix\n',
    '/work/project/.git/worktrees/fix/HEAD': 'ref: refs/heads/fix\n',
  });
  assert.equal(probeGit('/work/trees/fix', { spawn: REFUSED, files: worktree }).branch, 'fix');
  const unreadable = disk({ '/work/project/.git': null });
  assert.deepEqual(probeGit('/work/project', { spawn: REFUSED, files: unreadable }), { isRepo: true, branch: null, isDirty: false });
});

// A pipe or a device named HEAD would never finish reading, and the status line would hang.
test('a HEAD that is no small regular file is not read: the branch stays unknown', () => {
  const unknown = { isRepo: true, branch: null, isDirty: false };
  const reads = [];
  const special = {
    existsSync: () => true,
    statSync: () => ({ isFile: () => false, size: 0 }),
    readFileSync: (path) => { reads.push(path); return 'ref: refs/heads/develop\n'; },
  };
  assert.deepEqual(probeGit('/work/project', { spawn: REFUSED, files: special }), unknown);
  assert.deepEqual(reads, []);
  const large = disk({ '/work/project/.git': null, '/work/project/.git/HEAD': `ref: refs/heads/${'a'.repeat(HEAD_MAX_BYTES)}\n` });
  assert.deepEqual(probeGit('/work/project', { spawn: REFUSED, files: large }), unknown);
});

test('without a .git from the folder up, a git that gave no answer means no repository', () => {
  const asked = [];
  const files = { existsSync: (path) => { asked.push(path); return false; }, statSync: () => assert.fail('nothing to stat'), readFileSync: () => assert.fail('nothing to read') };
  assert.deepEqual(probeGit('/home/dev/notes', { spawn: REFUSED, files }), { isRepo: false, branch: null, isDirty: false });
  assert.deepEqual(asked, ['/home/dev/notes/.git', '/home/dev/.git', '/home/.git', '/.git']);
});

test('a git that answered is believed: the disk is not looked at', () => {
  const files = { existsSync: () => assert.fail('must not look'), statSync: () => assert.fail('must not stat'), readFileSync: () => assert.fail('must not read') };
  const spawn = () => ({ status: 0, stdout: '# branch.oid abc\n# branch.head develop\n1 .M N... a b c d e f x.mjs\n' });
  assert.deepEqual(probeGit('/repo', { spawn, files }), { isRepo: true, branch: 'develop', isDirty: true });
});

test('with real git cut off after a millisecond, a real repository still shows its branch', (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'ls-git-slow-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  spawnSync('git', ['init', '-q', '-b', 'trunk', dir]);
  assert.deepEqual(probeGit(dir, { timeoutMs: 1 }), { isRepo: true, branch: 'trunk', isDirty: false });
});

test('probeGit tells a plain folder from a fresh repository with real git', (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'ls-git-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  assert.equal(probeGit(dir).isRepo, false);
  spawnSync('git', ['init', '-q', '-b', 'trunk', dir]);
  assert.deepEqual(probeGit(dir), { isRepo: true, branch: 'trunk', isDirty: false });
});
