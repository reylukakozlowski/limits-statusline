// What the release and the preparation of a release share: the branch they work from, the version
// tags, git through an injected exec, and a refusal that ends a run with its reason.

export const BASE_BRANCH = 'develop';
export const VERSION_TAGS = 'v*.*.*';

/** A run that stops with a reason for the person: exit code 2, nothing more written. */
export class Refusal extends Error {}

/**
 * @typedef {(command: string, args: string[], options?: { inherit?: boolean }) => { status: number, stdout: string }} Exec
 */

/** The non-empty lines of a command's output, trimmed. */
export const lines = (text) => text.split('\n').map((line) => line.trim()).filter(Boolean);

/** git through `exec`, its output on success, a Refusal naming the command on failure. @param {Exec} exec */
export const gitRunner = (exec) => (...args) => {
  const result = exec('git', args, {});
  if (result.status !== 0) throw new Refusal(`git ${args.join(' ')} failed (exit ${result.status}).`);
  return result.stdout;
};

/** The value `compute` gives, its error turned into a Refusal. */
export function toRefusal(compute) {
  try {
    return compute();
  } catch (error) {
    throw new Refusal(error.message);
  }
}

/** The manifest's `version`, whatever it holds; the caller judges it. @param {() => string} readManifest */
export function manifestVersion(readManifest) {
  let manifest;
  try {
    manifest = JSON.parse(readManifest());
  } catch (error) {
    throw new Refusal(`.claude-plugin/plugin.json cannot be read: ${error.message}`);
  }
  return manifest?.version;
}
