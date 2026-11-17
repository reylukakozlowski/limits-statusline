import { test } from 'node:test';
import assert from 'node:assert/strict';
import { dotGitPaths, gitDirFromFile, gitFromHead } from '../../src/core/git-head.mjs';

test('a branch HEAD gives the branch, with the dirty marker unknown', () => {
  assert.deepEqual(gitFromHead('ref: refs/heads/feature/x\n'), { isRepo: true, branch: 'feature/x', isDirty: false });
});

test('a detached HEAD reads as its short commit, an unreadable or odd HEAD as an unknown branch', () => {
  assert.equal(gitFromHead('0123456789abcdef\n').branch, '0123456');
  assert.deepEqual(gitFromHead(null), { isRepo: true, branch: null, isDirty: false });
  assert.equal(gitFromHead('something else').branch, null);
});

// A HEAD can be written by anyone (an unpacked archive); its text ends up on the terminal.
test('a branch is only a name git would accept: no control characters, spaces or ".."', () => {
  const branchOf = (name) => gitFromHead(`ref: refs/heads/${name}\n`).branch;
  assert.equal(branchOf('feature/lko/develop/LS-88_git-head'), 'feature/lko/develop/LS-88_git-head');
  assert.equal(branchOf('zażółć-gęślą'), 'zażółć-gęślą');
  for (const name of ['\u001b[2J\u001b]0;owned\u0007', 'a\u009bb', 'two words', 'tab\there', 'a..b', 'a~1', 'a^', 'a:b', 'a?', 'a*', 'a[b', 'a\\b', '', '.invalid', 'feature/.hidden']) {
    assert.equal(branchOf(name), null, JSON.stringify(name));
  }
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

// Opening \\server\share on Windows signs in to that server: a .git file must not make that happen.
test('a .git file that names a folder on another machine gives none', () => {
  // Windows reads either separator, also mixed, as the start of \\server\share.
  for (const gitDir of ['\\\\evil.example\\share\\repo', '//evil.example/share/repo', '\\/evil.example/share/repo',
    '/\\evil.example/share/repo', '\\\\?\\C:\\repo\\.git']) {
    assert.equal(gitDirFromFile(`gitdir: ${gitDir}\n`, 'C:\\work\\tree/.git'), null, gitDir);
  }
});

test('a .git file that names no folder gives none', () => {
  for (const text of [null, '', '\n', 'gitdir:', 'gitdir:   \r\n', 'ref: refs/heads/develop', 'not a git file', ' gitdir: /x']) {
    assert.equal(gitDirFromFile(text, '/home/dev/feature/.git'), null, JSON.stringify(text));
  }
});
