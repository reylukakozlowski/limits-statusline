// One `git status` call answers both "is this a repo / which branch" and "is it dirty". Where
// git gives no answer the folder itself does: its repository's HEAD names the branch.

import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import { dotGitPaths, gitDirFromFile, gitFromHead } from '../core/git-head.mjs';
import { GIT_STATUS_ARGS, NOT_A_REPO, parseGitStatus } from '../core/git-status.mjs';

export const GIT_TIMEOUT_MS = 1000;
// A HEAD or a worktree's `.git` file is one short line. Anything else under that name (a pipe or
// a device, which would never finish reading, or a large file) is not read.
export const HEAD_MAX_BYTES = 4096;

/**
 * @param {string | null} cwd
 * @param {{ spawn?: typeof spawnSync, timeoutMs?: number,
 *           files?: Pick<typeof fs, 'existsSync' | 'statSync' | 'readFileSync'> }} [options]
 * @returns {import('../core/git-status.mjs').GitState | null} null without a folder to ask about
 */
export function probeGit(cwd, { spawn = spawnSync, timeoutMs = GIT_TIMEOUT_MS, files = fs } = {}) {
  if (typeof cwd !== 'string' || cwd === '') return null;
  const result = spawn('git', ['-C', cwd, ...GIT_STATUS_ARGS], {
    encoding: 'utf8',
    timeout: timeoutMs,
    windowsHide: true,
    stdio: ['ignore', 'pipe', 'ignore'],
  });
  const answer = result.error ? null : parseGitStatus({ exitCode: result.status, stdout: result.stdout });
  return answer ?? gitFromFolder(cwd, files);
}

// git is missing, took too long or refused: the nearest `.git` from the folder up says whether
// this is a repository, and its HEAD which branch; whether it is dirty stays unknown.
function gitFromFolder(cwd, files) {
  try {
    const dotGit = dotGitPaths(cwd).find((path) => files.existsSync(path));
    return dotGit === undefined ? { ...NOT_A_REPO } : gitFromHead(readHead(dotGit, files));
  } catch {
    return null;
  }
}

/** A `.git` folder holds HEAD; a `.git` file, a worktree's, names the folder that does. */
function readHead(dotGit, files) {
  const read = (path) => {
    try {
      const stat = files.statSync(path);
      return stat.isFile() && stat.size <= HEAD_MAX_BYTES ? files.readFileSync(path, 'utf8') : null;
    } catch {
      return null;
    }
  };
  const head = read(`${dotGit}/HEAD`);
  if (head !== null) return head;
  const gitDir = gitDirFromFile(read(dotGit), dotGit);
  return gitDir === null ? null : read(`${gitDir}/HEAD`);
}
