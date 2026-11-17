// The main conversation's prompt-cache lifetime as the band can learn it. First from what the
// API reported: each turn's cache writes say which lifetime they were written for, whatever made
// Claude Code choose it (the plan, usage credits, a setting). Before a turn has reported one, and
// on an engine that does not report it, from the variables and the setting Claude Code reads and
// whether the session runs on a plan within its limits. The band reads them through `$`
// (band.mjs) and passes the answers here.

import { FULL_PERCENT } from '../core/metrics.mjs';
import { CACHE_TTL_MS, mainCacheTtlMs } from '../core/prompt-cache.mjs';
import { recordOf } from '../core/values.mjs';
import { limitsFromRateLimits } from './snapshot.mjs';

/**
 * The lifetime the main conversation's last cache write was made for.
 * @param {import('./tracker.mjs').Tracker | null} tracker
 * @returns {number | null} null when no turn has reported one
 */
export function observedCacheTtlMs(tracker) {
  const ttl = tracker?.cacheTtl;
  return typeof ttl === 'string' && Object.hasOwn(CACHE_TTL_MS, ttl) ? CACHE_TTL_MS[ttl] : null;
}

/**
 * @param {{
 *   env: { FORCE_PROMPT_CACHING_5M?: unknown, CLAUDE_CODE_PROMPT_CACHE_TTL?: unknown, ENABLE_PROMPT_CACHING_1H?: unknown },
 *   settings: unknown,
 *   rateLimits: unknown,
 *   nowMs: number,
 * }} answers the variables, `$.settings.read()`, and `$.session.usage()`'s windows
 * @returns {number | null}
 */
export function cacheTtlFromEngine({ env, settings, rateLimits, nowMs }) {
  const planReadings = Object.values(limitsFromRateLimits(rateLimits, nowMs)).filter(Boolean);
  return mainCacheTtlMs({
    env,
    settingTtl: recordOf(settings).promptCacheTtl,
    isSubscription: planReadings.length > 0,
    isOverPlan: planReadings.some((reading) => reading.percentUsed >= FULL_PERCENT),
  });
}
