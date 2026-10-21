import { test } from 'node:test';
import assert from 'node:assert/strict';
import { NOT_A_REPO, dotGitPaths, gitDirFromFile, gitFromHead } from '../../src/desktop/git.mjs';

test('a branch HEAD gives the branch, with the dirty marker unknown', () => {
  assert.deepEqual(gitFromHead('ref: refs/heads/feature/x\n'), { isRepo: true, branch: 'feature/x', isDirty: false });
});

test('a detached HEAD reads as its short commit, an unreadable or odd HEAD as an unknown branch', () => {
  assert.equal(gitFromHead('0123456789abcdef\n').branch, '0123456');
  assert.deepEqual(gitFromHead(null), { isRepo: true, branch: null, isDirty: false });
  assert.equal(gitFromHead('something else').branch, null);
});

test('outside a repository there is no git', () => {
  assert.deepEqual(NOT_A_REPO, { isRepo: false, branch: null, isDirty: false });
});

test('.git is looked for from the folder up to its root, as git looks for it', () => {
  assert.deepEqual(dotGitPaths('/home/dev/project/src'), [
    '/home/dev/project/src/.git', '/home/dev/project/.git', '/home/dev/.git', '/home/.git', '/.git',
  ]);
  assert.deepEqual(dotGitPaths('C:\\Users\\dev\\project\\'), [
    'C:\\Users\\dev\\project/.git', 'C:\\Users\\dev/.git', 'C:\\Users/.git', 'C:/.git',
  ]);
  assert.deepEqual(dotGitPaths('C:/'), ['C:/.git']);
  assert.deepEqual(dotGitPaths('/'), ['/.git']);
});

test('a worktree\'s .git file names its git folder, absolute as git writes it', () => {
  assert.equal(gitDirFromFile('gitdir: C:/repo/main/.git/worktrees/feature\n', 'C:/repo/feature/.git'),
    'C:/repo/main/.git/worktrees/feature');
  assert.equal(gitDirFromFile('gitdir: /home/dev/main/.git/worktrees/feature\n', '/home/dev/feature/.git'),
    '/home/dev/main/.git/worktrees/feature');
  assert.equal(gitDirFromFile('gitdir: C:\\repo\\main\\.git\\worktrees\\feature', 'C:\\repo\\feature/.git'),
    'C:\\repo\\main\\.git\\worktrees\\feature');
});

test('a relative git folder is taken from the folder that holds the .git file', () => {
  assert.equal(gitDirFromFile('gitdir: ../main/.git/worktrees/feature\n', '/home/dev/feature/.git'),
    '/home/dev/feature/../main/.git/worktrees/feature');
  assert.equal(gitDirFromFile('gitdir: ..\\..\\.git\\modules\\lib', 'C:\\repo\\main\\vendor\\lib/.git'),
    'C:\\repo\\main\\vendor\\lib/..\\..\\.git\\modules\\lib');
});

test('a .git file written with CRLF line endings names the same folder', () => {
  assert.equal(gitDirFromFile('gitdir: C:/repo/main/.git/worktrees/feature\r\n', 'C:/repo/feature/.git'),
    'C:/repo/main/.git/worktrees/feature');
});

test('a .git file that names no folder gives none', () => {
  for (const text of [null, '', '\n', 'gitdir:', 'gitdir:   \r\n', 'ref: refs/heads/develop', 'not a git file', ' gitdir: /x']) {
    assert.equal(gitDirFromFile(text, '/home/dev/feature/.git'), null, JSON.stringify(text));
  }
});
