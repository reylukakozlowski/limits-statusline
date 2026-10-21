import { test } from 'node:test';
import assert from 'node:assert/strict';
import { NOT_A_REPO, gitFromHead } from '../../src/desktop/git.mjs';

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
