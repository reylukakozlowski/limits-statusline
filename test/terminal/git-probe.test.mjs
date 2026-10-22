import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { probeGit } from '../../src/terminal/git-probe.mjs';

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

test('probeGit returns null when git is missing or times out, and when there is no folder', () => {
  assert.equal(probeGit('/repo', { spawn: () => ({ error: new Error('ENOENT') }) }), null);
  assert.equal(probeGit(null, { spawn: () => assert.fail('must not run') }), null);
});

test('probeGit tells a plain folder from a fresh repository with real git', (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'ls-git-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  assert.equal(probeGit(dir).isRepo, false);
  spawnSync('git', ['init', '-q', '-b', 'trunk', dir]);
  assert.deepEqual(probeGit(dir), { isRepo: true, branch: 'trunk', isDirty: false });
});
