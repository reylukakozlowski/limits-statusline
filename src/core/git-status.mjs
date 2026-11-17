// Parses `git status --porcelain=v2 --branch` so both adapters share one git question and one
// answer. Where git gives no answer (it is missing, too slow, or refuses the folder), the
// adapters read the branch from the repository's HEAD instead (git-head.mjs).

// --no-optional-locks (git 2.15+, the same as GIT_OPTIONAL_LOCKS=0): never take the index lock away
// from the user's own git commands.
export const GIT_STATUS_ARGS = Object.freeze(['--no-optional-locks', 'status', '--porcelain=v2', '--branch', '--untracked-files=no']);

export const NOT_A_REPO = Object.freeze({ isRepo: false, branch: null, isDirty: false });
export const SHORT_SHA_LENGTH = 7;

/**
 * @typedef {{ isRepo: boolean, branch: string | null, isDirty: boolean }} GitState
 * @param {{ exitCode: number, stdout: string } | null} result of running git with GIT_STATUS_ARGS
 * @returns {GitState | null} null when git gave no answer: a failed git says nothing about the
 *   folder (exit 128 is "not a git repository", and also a repository git refuses to read)
 */
export function parseGitStatus(result) {
  if (!result || result.exitCode !== 0 || typeof result.stdout !== 'string') return null;
  let head = null;
  let oid = null;
  let isDirty = false;
  for (const line of result.stdout.split(/\r?\n/)) {
    if (line.startsWith('# branch.head ')) head = line.slice('# branch.head '.length).trim();
    else if (line.startsWith('# branch.oid ')) oid = line.slice('# branch.oid '.length).trim();
    else if (line !== '' && !line.startsWith('#')) isDirty = true;
  }
  return { isRepo: true, branch: branchName(head, oid), isDirty };
}

function branchName(head, oid) {
  if (head && head !== '(detached)') return head;
  if (oid && oid !== '(initial)') return oid.slice(0, SHORT_SHA_LENGTH);
  return null;
}
