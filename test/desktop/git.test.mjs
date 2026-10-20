import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { GIT_STATUS_ARGS } from '../../src/core/git-status.mjs';
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

// The band writes its git command as fixed text, so that the directory can read what the mod
// runs; it has to stay the terminal's command.
test('the band runs the same git status as the terminal status line', () => {
  const band = readFileSync(new URL('../../src/desktop/band.mjs', import.meta.url), 'utf8');
  const argv = band.match(/\$\.process\.run\((\[[^\]]*\])/);
  assert.ok(argv, 'band.mjs calls $.process.run with an argument vector written out');
  assert.deepEqual(JSON.parse(argv[1].replaceAll("'", '"')), ['git', ...GIT_STATUS_ARGS]);
});
