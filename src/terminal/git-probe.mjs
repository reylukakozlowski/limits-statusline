// One `git status` call answers both "is this a repo / which branch" and "is it dirty".

import { spawnSync } from 'node:child_process';
import { GIT_STATUS_ARGS, parseGitStatus } from '../core/git-status.mjs';

export const GIT_TIMEOUT_MS = 1000;

/**
 * @param {string | null} cwd
 * @param {{ spawn?: typeof spawnSync, timeoutMs?: number }} [options]
 * @returns {import('../core/git-status.mjs').GitState | null} null when git is missing or too slow
 */
export function probeGit(cwd, { spawn = spawnSync, timeoutMs = GIT_TIMEOUT_MS } = {}) {
  if (typeof cwd !== 'string' || cwd === '') return null;
  const result = spawn('git', ['-C', cwd, ...GIT_STATUS_ARGS], {
    encoding: 'utf8',
    timeout: timeoutMs,
    windowsHide: true,
    stdio: ['ignore', 'pipe', 'ignore'],
    // A status line must never take the index lock away from the user's own git commands.
    env: { ...process.env, GIT_OPTIONAL_LOCKS: '0' },
  });
  if (result.error) return null;
  return parseGitStatus({ exitCode: result.status, stdout: result.stdout });
}
