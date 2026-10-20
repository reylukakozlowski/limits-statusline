// The main conversation's prompt-cache lifetime as the band can learn it: the variables and the
// setting Claude Code reads, and whether the session runs on a plan within its limits.

import { FULL_PERCENT } from '../core/metrics.mjs';
import { mainCacheTtlMs } from '../core/prompt-cache.mjs';
import { recordOf } from '../core/values.mjs';
import { limitsFromRateLimits } from './snapshot.mjs';

/**
 * @param {{ env: any, settings: any }} $ the mods API
 * @param {unknown} rateLimits `$.session.usage()`'s windows
 * @param {number} nowMs
 * @returns {Promise<number | null>} null when the engine cannot answer
 */
export async function cacheTtlWithEngine($, rateLimits, nowMs) {
  try {
    // Literal names: the engine lists the variables a module reads from its calls.
    const [force5m, chosenTtl, enable1h, settings] = await Promise.all([
      $.env.get('FORCE_PROMPT_CACHING_5M'),
      $.env.get('CLAUDE_CODE_PROMPT_CACHE_TTL'),
      $.env.get('ENABLE_PROMPT_CACHING_1H'),
      $.settings.read(),
    ]);
    const planReadings = Object.values(limitsFromRateLimits(rateLimits, nowMs)).filter(Boolean);
    return mainCacheTtlMs({
      env: { FORCE_PROMPT_CACHING_5M: force5m, CLAUDE_CODE_PROMPT_CACHE_TTL: chosenTtl, ENABLE_PROMPT_CACHING_1H: enable1h },
      settingTtl: recordOf(settings).promptCacheTtl,
      isSubscription: planReadings.length > 0,
      isOverPlan: planReadings.some((reading) => reading.percentUsed >= FULL_PERCENT),
    });
  } catch {
    return null;
  }
}
