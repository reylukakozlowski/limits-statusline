// Git state for the band. The band runs `git status` through `$.process`, which is documented as
// CLI only; where it is unavailable the branch is read from the session's own HEAD through `$.fs`
// and the dirty marker is then unknown. The calls on `$` live in band.mjs, where the directory
// reads them; this file keeps what is decided from their answers.

const SHORT_SHA_LENGTH = 7;
export const NOT_A_REPO = Object.freeze({ isRepo: false, branch: null, isDirty: false });

/**
 * The state of a repository known only by its HEAD file.
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

/**
 * The `.git` paths git looks for, from the folder up to its root, nearest first. The folder's own
 * separators are kept; `/.git` is added to each, which Windows takes as well.
 * @param {string} folder an absolute folder
 * @returns {string[]}
 */
export function dotGitPaths(folder) {
  const paths = [];
  for (let at = String(folder).replace(/[\\/]+$/, ''); ; at = at.slice(0, lastSeparator(at))) {
    paths.push(`${at}/.git`);
    if (lastSeparator(at) < 0) return paths;
  }
}

/**
 * The git folder a `.git` file names. A worktree's (and a submodule's) `.git` is a file,
 * `gitdir: <path>`, the path relative to the folder that holds the file unless absolute.
 * @param {unknown} text the `.git` file's text, or null when it could not be read
 * @param {string} dotGit the `.git` file's path
 * @returns {string | null} null when the text names no folder
 */
export function gitDirFromFile(text, dotGit) {
  const match = /^gitdir:[ \t]*(\S.*?)\s*$/.exec(String(text ?? '').split('\n')[0]);
  if (!match) return null;
  const gitDir = match[1];
  return isAbsolute(gitDir) ? gitDir : `${dotGit.slice(0, lastSeparator(dotGit) + 1)}${gitDir}`;
}

const lastSeparator = (path) => Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\'));
const isAbsolute = (path) => /^(?:[\\/]|[A-Za-z]:[\\/])/.test(path);
