// Git state for the band. The band runs `git status` through `$.process`, which is documented as
// CLI only; where it is unavailable the branch is read from <repo>/.git/HEAD through `$.fs` and
// the dirty marker is then unknown. The calls on `$` live in band.mjs, where the directory reads
// them; this file keeps what is decided from their answers.

export const GIT_TIMEOUT_MS = 1500;
const SHORT_SHA_LENGTH = 7;
export const NOT_A_REPO = Object.freeze({ isRepo: false, branch: null, isDirty: false });

/**
 * The state of a repository known only by its .git/HEAD.
 * @param {unknown} head the file's text, or null when it could not be read
 * @returns {import('../core/git-status.mjs').GitState}
 */
export function gitFromHead(head) {
  return { isRepo: true, branch: head == null ? null : branchFromHead(head), isDirty: false };
}

function branchFromHead(head) {
  const text = String(head).trim();
  if (text.startsWith('ref: refs/heads/')) return text.slice('ref: refs/heads/'.length);
  return /^[0-9a-f]{7,}$/i.test(text) ? text.slice(0, SHORT_SHA_LENGTH) : null;
}
