// The main conversation's prompt-cache lifetime as the band can learn it: the variables and the
// setting Claude Code reads, and whether the session runs on a plan within its limits. The band
// reads them through `$` (band.mjs) and passes the answers here.

import { FULL_PERCENT } from '../core/metrics.mjs';
import { mainCacheTtlMs } from '../core/prompt-cache.mjs';
import { recordOf } from '../core/values.mjs';
import { limitsFromRateLimits } from './snapshot.mjs';

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
