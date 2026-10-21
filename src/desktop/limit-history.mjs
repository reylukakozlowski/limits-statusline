// The shared limit history (core/limit-history.mjs) for the band: the same file the terminal
// status line keeps, in the folder where Claude Code keeps its configuration. The band reads and
// writes it through `$` (band.mjs); this file keeps what is decided from the answers.

import { recordLimits } from '../core/limit-history.mjs';
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
 * The history with this session's plan figures, measured just now; the same history when they
 * change nothing.
 * @param {import('../core/limit-history.mjs').LimitHistory} history
 * @param {{ sessionId: unknown, rateLimits: unknown, nowMs: number }} measurement `session.measure`'s windows
 */
export function withMeasuredLimits(history, { sessionId, rateLimits, nowMs }) {
  return recordLimits(history, { sessionId, limits: limitsFromRateLimits(rateLimits, nowMs), nowMs });
}
