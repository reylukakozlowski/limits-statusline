// Git state for the band. `$.process` is documented as CLI only, so when it is unavailable the
// branch is read from <repo>/.git/HEAD through `$.fs`; the dirty marker is then unknown.

import { GIT_STATUS_ARGS, parseGitStatus } from '../core/git-status.mjs';

export const GIT_TIMEOUT_MS = 1500;
const SHORT_SHA_LENGTH = 7;
const NOT_A_REPO = Object.freeze({ isRepo: false, branch: null, isDirty: false });

/**
 * @param {{ session: any, process?: any, fs?: any }} $ the mods API
 * @returns {Promise<import('../core/git-status.mjs').GitState | null>} null when nothing could be asked
 */
export async function probeGitWithEngine($) {
  try {
    const cwd = await $.session.cwd();
    return parseGitStatus(await $.process.run(['git', '-C', cwd, ...GIT_STATUS_ARGS], {
      timeoutMs: GIT_TIMEOUT_MS,
      env: { GIT_OPTIONAL_LOCKS: '0' }, // never take the index lock from the user's own git
    }));
  } catch {
    return readHeadThroughFs($);
  }
}

async function readHeadThroughFs($) {
  let repo;
  try {
    repo = await $.session.repo();
  } catch {
    return null;
  }
  if (!repo?.root) return { ...NOT_A_REPO };
  try {
    return { isRepo: true, branch: branchFromHead(await $.fs.read(`${repo.root}/.git/HEAD`)), isDirty: false };
  } catch {
    return { isRepo: true, branch: null, isDirty: false };
  }
}

function branchFromHead(head) {
  const text = String(head).trim();
  if (text.startsWith('ref: refs/heads/')) return text.slice('ref: refs/heads/'.length);
  return /^[0-9a-f]{7,}$/i.test(text) ? text.slice(0, SHORT_SHA_LENGTH) : null;
}
