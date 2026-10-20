// The shared limit history (core/limit-history.mjs) through the mods API: the same file the
// terminal status line keeps, found the way Claude Code finds its configuration folder. Every
// call settles: a file that cannot be used leaves the band with less to show, never without one.

import { EMPTY_LIMIT_HISTORY, parseLimitHistory, recordLimits, serializeLimitHistory } from '../core/limit-history.mjs';
import { claudeConfigDir, limitHistoryPath } from '../core/paths.mjs';
import { limitsFromRateLimits } from './snapshot.mjs';

/**
 * @param {{ env: any }} $ the mods API
 * @returns {Promise<string | null>} null when no configuration folder is known
 */
async function limitHistoryFile($) {
  try {
    // Literal names: the engine lists the variables a module reads from its calls.
    const [configDirVariable, userProfile, home] = await Promise.all([
      $.env.get('CLAUDE_CONFIG_DIR'), $.env.get('USERPROFILE'), $.env.get('HOME'),
    ]);
    // USERPROFILE first: on Windows Node's home folder is USERPROFILE even where HOME is set.
    const configDir = claudeConfigDir(configDirVariable, userProfile || home);
    return configDir ? limitHistoryPath(configDir) : null;
  } catch {
    return null;
  }
}

async function readHistory($, file) {
  try {
    return (await $.fs.exists(file)) ? parseLimitHistory(await $.fs.read(file)) : EMPTY_LIMIT_HISTORY;
  } catch {
    return EMPTY_LIMIT_HISTORY;
  }
}

/**
 * The shared readings to draw from.
 * @param {{ env: any, fs: any }} $ the mods API
 * @returns {Promise<import('../core/limit-history.mjs').LimitReadings>}
 */
export async function loadLimitReadings($) {
  const file = await limitHistoryFile($);
  return (file ? await readHistory($, file) : EMPTY_LIMIT_HISTORY).readings;
}

/**
 * Adds this session's plan figures, measured just now, to the shared history.
 * @param {{ env: any, fs: any, session: any }} $ the mods API
 * @param {unknown} rateLimits `session.measure`'s windows
 * @param {number} nowMs
 */
export async function recordMeasuredLimits($, rateLimits, nowMs) {
  const file = await limitHistoryFile($);
  if (!file) return;
  try {
    const history = await readHistory($, file);
    const sessionId = await $.session.id();
    const next = recordLimits(history, { sessionId, limits: limitsFromRateLimits(rateLimits, nowMs), nowMs });
    if (next !== history) await $.fs.write(file, serializeLimitHistory(next));
  } catch {
    // The terminal status line or another session may hold the file for a moment; the next
    // measurement records again.
  }
}
