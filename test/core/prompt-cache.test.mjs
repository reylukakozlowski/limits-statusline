import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CACHE_TTL_MS, mainCacheTtlMs, promptCacheAfter } from '../../src/core/prompt-cache.mjs';

const FIVE_MINUTES = 300_000;
const ONE_HOUR = 3_600_000;
const subscriber = { isSubscription: true, isOverPlan: false };

test('the two lifetimes are five minutes and one hour', () => {
  assert.deepEqual(CACHE_TTL_MS, { '5m': FIVE_MINUTES, '1h': ONE_HOUR });
});

test('by default a subscription within its plan gets an hour, anything else five minutes', () => {
  assert.equal(mainCacheTtlMs(subscriber), ONE_HOUR);
  assert.equal(mainCacheTtlMs({ isSubscription: true, isOverPlan: true }), FIVE_MINUTES); // on usage credits
  assert.equal(mainCacheTtlMs({ isSubscription: false, isOverPlan: false }), FIVE_MINUTES); // API key, cloud
});

test('the documented order decides: force 5m, the variable, the setting, then enable 1h', () => {
  const all = { FORCE_PROMPT_CACHING_5M: '1', CLAUDE_CODE_PROMPT_CACHE_TTL: '1h', ENABLE_PROMPT_CACHING_1H: '1' };
  assert.equal(mainCacheTtlMs({ ...subscriber, env: all, settingTtl: '1h' }), FIVE_MINUTES);
  const apiKey = { isSubscription: false, isOverPlan: false };
  assert.equal(mainCacheTtlMs({ ...apiKey, env: { CLAUDE_CODE_PROMPT_CACHE_TTL: '1h' }, settingTtl: '5m' }), ONE_HOUR);
  assert.equal(mainCacheTtlMs({ ...subscriber, settingTtl: '5m', env: { ENABLE_PROMPT_CACHING_1H: '1' } }), FIVE_MINUTES);
  assert.equal(mainCacheTtlMs({ ...apiKey, env: { ENABLE_PROMPT_CACHING_1H: '1' } }), ONE_HOUR);
});

test('values Claude Code ignores are ignored here too', () => {
  const ignored = { FORCE_PROMPT_CACHING_5M: 'yes', CLAUDE_CODE_PROMPT_CACHE_TTL: '2h', ENABLE_PROMPT_CACHING_1H: 'true' };
  assert.equal(mainCacheTtlMs({ ...subscriber, env: ignored, settingTtl: 30 }), ONE_HOUR);
  assert.equal(mainCacheTtlMs({ isSubscription: false, isOverPlan: false, env: ignored, settingTtl: 'toString' }), FIVE_MINUTES);
});

test('promptCacheAfter: warm for one lifetime after a cached response, cold after one without cache', () => {
  assert.deepEqual(promptCacheAfter({ atMs: 1_000, isCached: true }, ONE_HOUR), { warm: true, expiresAtMs: 1_000 + ONE_HOUR });
  assert.deepEqual(promptCacheAfter({ atMs: 1_000, isCached: false }, ONE_HOUR), { warm: false, expiresAtMs: null });
  assert.equal(promptCacheAfter(null, ONE_HOUR), null);
  assert.equal(promptCacheAfter({ atMs: NaN, isCached: true }, ONE_HOUR), null);
});
