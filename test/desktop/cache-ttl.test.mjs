import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cacheTtlWithEngine } from '../../src/desktop/cache-ttl.mjs';
import { fakeEngine, fiveHour } from './fake-engine.mjs';

const NOW = 1_800_000_000_000;
const RESET = NOW + 15_000_000;
const ONE_HOUR = 3_600_000;
const FIVE_MINUTES = 300_000;

test('an hour on a plan within its limits, five minutes over it or off a plan', async () => {
  const { $ } = fakeEngine();
  const sevenDay = { kind: 'seven_day', percentUsed: 20, resetsAt: new Date(NOW + 86_400_000).toISOString() };
  assert.equal(await cacheTtlWithEngine($, [fiveHour(40, RESET), sevenDay], NOW), ONE_HOUR);
  assert.equal(await cacheTtlWithEngine($, [fiveHour(100, RESET)], NOW), FIVE_MINUTES);
  assert.equal(await cacheTtlWithEngine($, [{ kind: 'spend_limit', percentUsed: 10 }], NOW), FIVE_MINUTES);
  assert.equal(await cacheTtlWithEngine($, undefined, NOW), FIVE_MINUTES);
});

test('a window whose reset has passed no longer counts as the plan', async () => {
  const { $ } = fakeEngine();
  assert.equal(await cacheTtlWithEngine($, [fiveHour(40, NOW - 1)], NOW), FIVE_MINUTES);
});

test('the variables and the promptCacheTtl setting decide before the plan does', async () => {
  const forced = fakeEngine({ env: { FORCE_PROMPT_CACHING_5M: '1' } });
  assert.equal(await cacheTtlWithEngine(forced.$, [fiveHour(10, RESET)], NOW), FIVE_MINUTES);
  const setting = fakeEngine({ settings: { promptCacheTtl: '5m' } });
  assert.equal(await cacheTtlWithEngine(setting.$, [fiveHour(10, RESET)], NOW), FIVE_MINUTES);
  const variable = fakeEngine({ env: { CLAUDE_CODE_PROMPT_CACHE_TTL: '1h' } });
  assert.equal(await cacheTtlWithEngine(variable.$, [], NOW), ONE_HOUR);
  const enabled = fakeEngine({ env: { ENABLE_PROMPT_CACHING_1H: '1' } });
  assert.equal(await cacheTtlWithEngine(enabled.$, [], NOW), ONE_HOUR);
});

test('unknown when the engine cannot answer', async () => {
  const settingsFail = fakeEngine();
  settingsFail.$.settings.read = async () => { throw new Error('no settings'); };
  assert.equal(await cacheTtlWithEngine(settingsFail.$, [fiveHour(10, RESET)], NOW), null);
  const envFail = fakeEngine();
  envFail.$.env.get = async () => { throw new Error('denied'); };
  assert.equal(await cacheTtlWithEngine(envFail.$, [fiveHour(10, RESET)], NOW), null);
});
