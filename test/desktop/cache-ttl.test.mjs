import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cacheTtlFromEngine } from '../../src/desktop/cache-ttl.mjs';

const NOW = 1_800_000_000_000;
const RESET = NOW + 15_000_000;
const ONE_HOUR = 3_600_000;
const FIVE_MINUTES = 300_000;

const fiveHour = (percentUsed, resetsAtMs) => ({ kind: 'five_hour', percentUsed, resetsAt: new Date(resetsAtMs).toISOString() });
const ttl = (rateLimits, { env = {}, settings = {} } = {}) => cacheTtlFromEngine({ env, settings, rateLimits, nowMs: NOW });

test('an hour on a plan within its limits, five minutes over it or off a plan', () => {
  const sevenDay = { kind: 'seven_day', percentUsed: 20, resetsAt: new Date(NOW + 86_400_000).toISOString() };
  assert.equal(ttl([fiveHour(40, RESET), sevenDay]), ONE_HOUR);
  assert.equal(ttl([fiveHour(100, RESET)]), FIVE_MINUTES);
  assert.equal(ttl([{ kind: 'spend_limit', percentUsed: 10 }]), FIVE_MINUTES);
  assert.equal(ttl(undefined), FIVE_MINUTES);
});

test('a window whose reset has passed no longer counts as the plan', () => {
  assert.equal(ttl([fiveHour(40, NOW - 1)]), FIVE_MINUTES);
});

test('the variables and the promptCacheTtl setting decide before the plan does', () => {
  assert.equal(ttl([fiveHour(10, RESET)], { env: { FORCE_PROMPT_CACHING_5M: '1' } }), FIVE_MINUTES);
  assert.equal(ttl([fiveHour(10, RESET)], { settings: { promptCacheTtl: '5m' } }), FIVE_MINUTES);
  assert.equal(ttl([], { env: { CLAUDE_CODE_PROMPT_CACHE_TTL: '1h' } }), ONE_HOUR);
  assert.equal(ttl([], { env: { ENABLE_PROMPT_CACHING_1H: '1' } }), ONE_HOUR);
});

test('settings that are not an object count as none', () => {
  assert.equal(ttl([fiveHour(10, RESET)], { settings: null }), ONE_HOUR);
});
