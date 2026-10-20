import { test } from 'node:test';
import assert from 'node:assert/strict';
import { TONE, limitTone, contextTone } from '../../src/core/thresholds.mjs';

test('limitTone follows the projection: <80 ok, 80–100 warn, >100 alert', () => {
  assert.equal(limitTone({ percentUsed: 10, projectedPercent: 79.9 }), TONE.ok);
  assert.equal(limitTone({ percentUsed: 10, projectedPercent: 80 }), TONE.warn);
  assert.equal(limitTone({ percentUsed: 10, projectedPercent: 100 }), TONE.warn);
  assert.equal(limitTone({ percentUsed: 10, projectedPercent: 100.1 }), TONE.alert);
});

test('limitTone falls back to the usage and treats a full window as alert', () => {
  assert.equal(limitTone({ percentUsed: 85, projectedPercent: null }), TONE.warn);
  assert.equal(limitTone({ percentUsed: 100, projectedPercent: 100 }), TONE.alert);
  assert.equal(limitTone({ percentUsed: NaN, projectedPercent: null }), TONE.muted);
});

test('contextTone: <50 ok, 50–80 warn, >80 alert, unknown muted', () => {
  assert.equal(contextTone(49), TONE.ok);
  assert.equal(contextTone(50), TONE.warn);
  assert.equal(contextTone(80), TONE.warn);
  assert.equal(contextTone(80.1), TONE.alert);
  assert.equal(contextTone(null), TONE.muted);
});
