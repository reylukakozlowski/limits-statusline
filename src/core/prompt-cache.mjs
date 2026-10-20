// When the main conversation's prompt cache goes cold, for a surface that is not told (the
// desktop band; the terminal status line receives `prompt_cache.expires_at` itself). The time
// to live follows Claude Code's documented order:
// https://code.claude.com/docs/en/prompt-caching#which-ttl-each-request-gets

import { MS_PER_HOUR, MS_PER_MINUTE } from './time.mjs';

export const CACHE_TTL_MS = Object.freeze({ '5m': 5 * MS_PER_MINUTE, '1h': MS_PER_HOUR });

/**
 * @typedef {{ warm: boolean | null, expiresAtMs: number | null }} PromptCache
 * @typedef {{ atMs: number, isCached: boolean }} LastTurn the last main-conversation response
 */

const isTtl = (value) => typeof value === 'string' && Object.hasOwn(CACHE_TTL_MS, value);

/**
 * The main conversation's cache lifetime: FORCE_PROMPT_CACHING_5M, then
 * CLAUDE_CODE_PROMPT_CACHE_TTL, the `promptCacheTtl` setting, ENABLE_PROMPT_CACHING_1H, and by
 * default one hour on a subscription within its plan, five minutes otherwise.
 * @param {{ env?: Record<string, string | undefined>, settingTtl?: unknown,
 *           isSubscription: boolean, isOverPlan: boolean }} context
 * @returns {number}
 */
export function mainCacheTtlMs({ env = {}, settingTtl, isSubscription, isOverPlan }) {
  if (env.FORCE_PROMPT_CACHING_5M === '1') return CACHE_TTL_MS['5m'];
  const chosen = [env.CLAUDE_CODE_PROMPT_CACHE_TTL, settingTtl].find(isTtl);
  if (chosen) return CACHE_TTL_MS[chosen];
  if (env.ENABLE_PROMPT_CACHING_1H === '1') return CACHE_TTL_MS['1h'];
  return isSubscription && !isOverPlan ? CACHE_TTL_MS['1h'] : CACHE_TTL_MS['5m'];
}

/**
 * The cache stays warm for one lifetime after the last response that reported cache tokens.
 * @param {LastTurn | null} lastTurn
 * @param {number} ttlMs
 * @returns {PromptCache | null} null before the first response
 */
export function promptCacheAfter(lastTurn, ttlMs) {
  if (!lastTurn || !Number.isFinite(lastTurn.atMs)) return null;
  return lastTurn.isCached ? { warm: true, expiresAtMs: lastTurn.atMs + ttlMs } : { warm: false, expiresAtMs: null };
}

/**
 * @param {PromptCache | null} promptCache
 * @param {number} nowMs
 * @returns {number | null} ms until the cache goes cold, 0 once it is, null when unknown
 */
export function cacheTimeLeftMs(promptCache, nowMs) {
  if (promptCache?.warm === false) return 0;
  if (promptCache?.warm !== true || !Number.isFinite(promptCache.expiresAtMs) || !Number.isFinite(nowMs)) return null;
  return Math.max(0, promptCache.expiresAtMs - nowMs);
}
