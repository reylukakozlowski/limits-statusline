// The shared limit history (core/limit-history.mjs) for the band: the same file the terminal
// status line keeps, in the folder where Claude Code keeps its configuration. The band reads and
// writes it through `$` (band.mjs); this file keeps what is decided from the answers.

import { isBrokenFile, recordLimits } from '../core/limit-history.mjs';
import { claudeConfigDir } from '../core/paths.mjs';
import { limitsFromRateLimits } from './snapshot.mjs';

/**
 * The configuration folder as Claude Code finds it, with no separator at its end, so that
 * `${folder}/limits-statusline/limit-history.json` is the terminal's limitHistoryPath(folder).
 * @param {unknown} configDirVariable `CLAUDE_CONFIG_DIR`
 * @param {unknown} userProfile `USERPROFILE`
 * @param {unknown} home `HOME`
 * @returns {string | null} null when no configuration folder is known
 */
export function configFolderFor(configDirVariable, userProfile, home) {
  // USERPROFILE first: on Windows Node's home folder is USERPROFILE even where HOME is set.
  const configDir = claudeConfigDir(configDirVariable, userProfile || home);
  return configDir === null ? null : configDir.replace(/[\\/]+$/, '');
}

/**
 * Whether a history file that cannot be read may be replaced: only once it has stayed unreadable
 * (isBrokenFile), since one found unreadable may be a file another session is writing. The band
 * has no file times, so this remembers when it first found the file unreadable.
 */
export function unreadableFileWatch() {
  let sinceMs = null;
  return {
    /** The file was read. */
    readable() {
      sinceMs = null;
    },
    /** @param {number} nowMs @returns {boolean} whether the unreadable file may be replaced now */
    mayReplace(nowMs) {
      sinceMs ??= nowMs;
      return isBrokenFile(sinceMs, nowMs);
    },
  };
}

/**
 * The history with what a measurement that found something moved says: the session worked just
 * now, and its plan figures when they are among what moved. The same history when that changes
 * nothing.
 * @param {import('../core/limit-history.mjs').LimitHistory} history
 * @param {{ sessionId: unknown, rateLimits: unknown, nowMs: number }} measurement `rateLimits`:
 *   `session.measure`'s windows, null when they did not move
 */
export function withMeasuredLimits(history, { sessionId, rateLimits, nowMs }) {
  const limits = rateLimits === null ? null : limitsFromRateLimits(rateLimits, nowMs);
  return recordLimits(history, { sessionId, limits, nowMs, lastResponseAtMs: nowMs });
}
