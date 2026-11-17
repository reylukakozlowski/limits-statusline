// Git state without git: where `git status` gives no answer (git is missing or too slow, it
// refuses the folder, or the band has no `$.process`, which is documented as CLI only), the
// branch is read from the HEAD of the folder's own repository and the dirty marker is unknown.
// Pure: the adapters look for the files and read them.
//
// The files may come from anyone (an unpacked archive, a repository git refused as not the
// user's own), and what is read here is printed and followed. So a branch is only a name git
// itself would accept, with no control character that a terminal would act on, and a `.git`
// file never leads to another machine.

import { SHORT_SHA_LENGTH } from './git-status.mjs';

// git check-ref-format: no control character or space, none of ~ ^ : ? * [ \, no "..", and no
// part that starts with a dot (`.invalid` is what a reftable repository's HEAD names).
const REF_NAME = /^(?!\.)(?!.*\/\.)(?!.*\.\.)[^\u0000-\u0020\u007f-\u009f~^:?*[\\]+$/;
// \\server\share, //server/share and either separator mixed, which Windows reads the same:
// reading there would send the user's sign-in to that server.
const NETWORK_PATH = /^[\\/]{2}/;

/**
 * The state of a repository known only by its HEAD file.
 * @param {unknown} head the file's text, or null when it could not be read
 * @returns {import('./git-status.mjs').GitState}
 */
export function gitFromHead(head) {
  return { isRepo: true, branch: head == null ? null : branchFromHead(head), isDirty: false };
}

function branchFromHead(head) {
  const text = String(head).trim();
  if (text.startsWith('ref: refs/heads/')) {
    const name = text.slice('ref: refs/heads/'.length);
    return REF_NAME.test(name) ? name : null;
  }
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
 * @returns {string | null} null when the text names no folder, or one on another machine
 */
export function gitDirFromFile(text, dotGit) {
  const match = /^gitdir:[ \t]*(\S.*?)\s*$/.exec(String(text ?? '').split('\n')[0]);
  if (!match) return null;
  const gitDir = match[1];
  if (NETWORK_PATH.test(gitDir)) return null;
  return isAbsolute(gitDir) ? gitDir : `${dotGit.slice(0, lastSeparator(dotGit) + 1)}${gitDir}`;
}

const lastSeparator = (path) => Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\'));
const isAbsolute = (path) => /^(?:[\\/]|[A-Za-z]:[\\/])/.test(path);
