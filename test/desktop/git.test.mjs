import { test } from 'node:test';
import assert from 'node:assert/strict';
import { probeGitWithEngine } from '../../src/desktop/git.mjs';

const engine = ({ run, repo = null, files = {} } = {}) => ({
  session: { cwd: async () => 'C:/work/app', repo: async () => repo },
  process: { run: run ?? (async () => { throw new Error('CLI only'); }) },
  fs: {
    read: async (path) => {
      if (!(path in files)) throw new Error(`ENOENT ${path}`);
      return files[path];
    },
  },
});

test('git status through $.process gives branch and dirty state', async () => {
  const calls = [];
  const run = async (argv, init) => {
    calls.push({ argv, init });
    return { exitCode: 0, stdout: '# branch.oid abc\n# branch.head develop\n1 .M N... a b c d e f x.mjs\n' };
  };
  assert.deepEqual(await probeGitWithEngine(engine({ run })), { isRepo: true, branch: 'develop', isDirty: true });
  assert.deepEqual(calls[0].argv.slice(0, 3), ['git', '-C', 'C:/work/app']);
  assert.equal(calls[0].init.env.GIT_OPTIONAL_LOCKS, '0');
});

test('without $.process the branch comes from .git/HEAD of the session repository', async () => {
  const $ = engine({ repo: { root: 'C:/work/app', remote: null }, files: { 'C:/work/app/.git/HEAD': 'ref: refs/heads/feature/x\n' } });
  assert.deepEqual(await probeGitWithEngine($), { isRepo: true, branch: 'feature/x', isDirty: false });
});

test('a detached HEAD reads as its short commit, an unreadable HEAD as an unknown branch', async () => {
  const detached = engine({ repo: { root: 'C:/r' }, files: { 'C:/r/.git/HEAD': '0123456789abcdef\n' } });
  assert.equal((await probeGitWithEngine(detached)).branch, '0123456');
  assert.deepEqual(await probeGitWithEngine(engine({ repo: { root: 'C:/r' } })), { isRepo: true, branch: null, isDirty: false });
});

test('outside a repository, or when everything fails, there is no git', async () => {
  assert.deepEqual(await probeGitWithEngine(engine()), { isRepo: false, branch: null, isDirty: false });
  const broken = { session: { cwd: async () => { throw new Error('x'); }, repo: async () => { throw new Error('y'); } } };
  assert.equal(await probeGitWithEngine(broken), null);
});
