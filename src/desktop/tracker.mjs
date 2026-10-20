// What the desktop band learns from events, as pure reducers: effort from each main-loop
// model request, cache counts from each main-loop turn, the context fill after each turn,
// and the last git answer. Subagent traffic is ignored, like the terminal's prompt_cache.

import { HISTORY_MAX_POINTS, appendPoint } from '../core/history.mjs';
import { numberOrNull } from '../core/values.mjs';

/**
 * @typedef {{
 *   effort: string | null,
 *   cache: { input: number, creation: number, read: number },
 *   history: number[],
 *   git: import('../core/git-status.mjs').GitState | null,
 * }} Tracker
 */

/** @returns {Tracker} */
export function initialTracker() {
  return { effort: null, cache: { input: 0, creation: 0, read: 0 }, history: [], git: null };
}

/** @param {Tracker} tracker @param {{ effort?: unknown, agentId?: string }} step `turn.step` input */
export function withEffort(tracker, step) {
  if (step?.agentId) return tracker;
  const level = step?.effort;
  const effort = typeof level === 'string' ? level : Number.isFinite(level) ? String(level) : null;
  return effort === tracker.effort ? tracker : { ...tracker, effort };
}

/** @param {Tracker} tracker @param {{ usage?: Record<string, unknown>, agentId?: string }} complete `turn.complete` input */
export function withTurnUsage(tracker, complete) {
  const usage = complete?.usage;
  if (complete?.agentId || !usage) return tracker;
  const add = (total, value) => total + (numberOrNull(value) ?? 0);
  return {
    ...tracker,
    cache: {
      input: add(tracker.cache.input, usage.input_tokens),
      creation: add(tracker.cache.creation, usage.cache_creation_input_tokens),
      read: add(tracker.cache.read, usage.cache_read_input_tokens),
    },
  };
}

/** @param {Tracker} tracker @param {unknown} percent */
export function withContext(tracker, percent, maxPoints = HISTORY_MAX_POINTS) {
  const history = appendPoint(tracker.history, percent, maxPoints);
  return history === tracker.history ? tracker : { ...tracker, history };
}

/**
 * After /clear the conversation starts over: its cache counts and context history go, while the
 * effort setting and the git state still hold.
 * @param {Tracker} tracker
 */
export function afterClear(tracker) {
  return { ...initialTracker(), effort: tracker.effort, git: tracker.git };
}

/** @param {Tracker} tracker @param {import('../core/git-status.mjs').GitState | null} git */
export function withGit(tracker, git) {
  return { ...tracker, git };
}
