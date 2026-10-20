import { test } from 'node:test';
import assert from 'node:assert/strict';
import { GIT_STATUS_ARGS, parseGitStatus } from '../../src/core/git-status.mjs';

const head = (name, oid = '0123456789abcdef0123456789abcdef01234567') =>
  `# branch.oid ${oid}\n# branch.head ${name}\n`;

test('GIT_STATUS_ARGS asks for porcelain v2 with branch info and no untracked scan', () => {
  assert.deepEqual(GIT_STATUS_ARGS, ['status', '--porcelain=v2', '--branch', '--untracked-files=no']);
});

test('parseGitStatus reads a clean branch', () => {
  assert.deepEqual(parseGitStatus({ exitCode: 0, stdout: head('develop') }),
    { isRepo: true, branch: 'develop', isDirty: false });
});

test('parseGitStatus flags tracked changes as dirty, CRLF included', () => {
  const stdout = `${head('main')}1 .M N... 100644 100644 100644 a b src/x.mjs\r\n`.replace(/\n/g, '\r\n');
  assert.deepEqual(parseGitStatus({ exitCode: 0, stdout }), { isRepo: true, branch: 'main', isDirty: true });
});

test('parseGitStatus names a detached head by its short commit', () => {
  assert.equal(parseGitStatus({ exitCode: 0, stdout: head('(detached)') }).branch, '0123456');
});

test('parseGitStatus keeps the branch of a repository without commits', () => {
  assert.equal(parseGitStatus({ exitCode: 0, stdout: head('develop', '(initial)') }).branch, 'develop');
});

test('parseGitStatus treats a failing git as no repository', () => {
  const none = { isRepo: false, branch: null, isDirty: false };
  assert.deepEqual(parseGitStatus({ exitCode: 128, stdout: '' }), none);
  assert.deepEqual(parseGitStatus({ exitCode: 0, stdout: undefined }), none);
  assert.deepEqual(parseGitStatus(null), none);
});
