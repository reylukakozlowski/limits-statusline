// Path helpers that must work on Windows and POSIX paths alike, whatever platform runs them.

import { textOrNull } from './values.mjs';

/** Last path segment, or null. @param {unknown} path */
export function folderName(path) {
  if (typeof path !== 'string') return null;
  return path.split(/[\\/]+/).filter(Boolean).at(-1) ?? null;
}

const withoutTrailingSeparator = (path) => path.replace(/[\\/]+$/, '');

/**
 * The Claude Code configuration folder as Claude Code picks it: CLAUDE_CONFIG_DIR, else
 * `.claude` in the home folder. Null when neither is known.
 * @param {unknown} configDirVariable CLAUDE_CONFIG_DIR @param {unknown} home the home folder
 * @returns {string | null}
 */
export function claudeConfigDir(configDirVariable, home) {
  const configured = textOrNull(configDirVariable);
  if (configured) return configured;
  const homeFolder = textOrNull(home);
  return homeFolder ? `${withoutTrailingSeparator(homeFolder)}/.claude` : null;
}

/**
 * The limit history both surfaces share, next to what setup keeps: it outlives the plugin's
 * data folder, which differs between install sources and which the desktop band cannot name.
 * @param {string} configDir
 */
export const limitHistoryPath = (configDir) => `${withoutTrailingSeparator(configDir)}/limits-statusline/limit-history.json`;
