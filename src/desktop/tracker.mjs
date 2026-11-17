// What the desktop band learns from events, as pure reducers: effort from each main-loop
// model request, cache counts, cache lifetime and the time of each main-loop turn, the context
// fill after each turn, and the last git answer. Subagent traffic is ignored, like the terminal's prompt_cache.

import { HISTORY_MAX_POINTS, appendPoint } from '../core/history.mjs';
import { numberOrNull } from '../core/values.mjs';

/**
 * @typedef {{
 *   effort: string | null,
 *   cache: { input: number, creation: number, read: number },
 *   lastTurn: import('../core/prompt-cache.mjs').LastTurn | null,
 *   cacheTtl: '5m' | '1h' | null,
 *   history: number[],
 *   git: import('../core/git-status.mjs').GitState | null,
 * }} Tracker
 * `cacheTtl`: the lifetime of the main conversation's last cache write, as the API reported it;
 * null until a turn reports one (an engine that does not split cache writes by lifetime never does).
 */

/** @returns {Tracker} */
export function initialTracker() {
  return { effort: null, cache: { input: 0, creation: 0, read: 0 }, lastTurn: null, cacheTtl: null, history: [], git: null };
}

/** @param {Tracker} tracker @param {{ effort?: unknown, agentId?: string }} step `turn.step` input */
export function withEffort(tracker, step) {
  if (step?.agentId) return tracker;
  const level = step?.effort;
  const effort = typeof level === 'string' ? level : Number.isFinite(level) ? String(level) : null;
  return effort === tracker.effort ? tracker : { ...tracker, effort };
}

/**
 * Adds a main-loop turn's cache counts and notes when it ended and whether it touched the cache,
 * which is when the cache's lifetime starts over.
 * @param {Tracker} tracker
 * @param {{ usage?: Record<string, unknown>, agentId?: string }} complete `turn.complete` input
 * @param {number} nowMs
 */
export function withTurnUsage(tracker, complete, nowMs) {
  const usage = complete?.usage;
  if (complete?.agentId || !usage) return tracker;
  const add = (total, value) => total + (numberOrNull(value) ?? 0);
  const cachedTokens = add(0, usage.cache_creation_input_tokens) + add(0, usage.cache_read_input_tokens);
  return {
    ...tracker,
    cache: {
      input: add(tracker.cache.input, usage.input_tokens),
      creation: add(tracker.cache.creation, usage.cache_creation_input_tokens),
      read: add(tracker.cache.read, usage.cache_read_input_tokens),
    },
    lastTurn: Number.isFinite(nowMs) ? { atMs: nowMs, isCached: cachedTokens > 0 } : tracker.lastTurn ?? null,
    cacheTtl: writtenCacheTtl(usage) ?? tracker.cacheTtl ?? null,
  };
}

// The turn's cache writes by lifetime (`ephemeral_5m_input_tokens`, `ephemeral_1h_input_tokens`).
// A turn that wrote both changed lifetime on the way, which Claude Code does when a session
// goes over its plan: from an hour down to five minutes.
function writtenCacheTtl(usage) {
  if (numberOrNull(usage.ephemeral_5m_input_tokens) > 0) return '5m';
  if (numberOrNull(usage.ephemeral_1h_input_tokens) > 0) return '1h';
  return null;
}

/** @param {Tracker} tracker @param {unknown} percent */
export function withContext(tracker, percent, maxPoints = HISTORY_MAX_POINTS) {
  const history = appendPoint(tracker.history, percent, maxPoints);
  return history === tracker.history ? tracker : { ...tracker, history };
}

/**
 * After /clear the conversation starts over: its cache counts, last turn and context history
 * go, while the effort setting and the git state still hold.
 * @param {Tracker} tracker
 */
export function afterClear(tracker) {
  return { ...initialTracker(), effort: tracker.effort, git: tracker.git };
}

/** @param {Tracker} tracker @param {import('../core/git-status.mjs').GitState | null} git */
export function withGit(tracker, git) {
  return { ...tracker, git };
}
