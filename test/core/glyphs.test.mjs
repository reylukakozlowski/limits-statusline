import { test } from 'node:test';
import assert from 'node:assert/strict';
import { BAR_CELLS, brailleLine, normalizeSeries, progressBar } from '../../src/core/glyphs.mjs';

test('bars have 16 cells, as measured in the mockup', () => {
  assert.equal(BAR_CELLS, 16);
});

test('progressBar rounds to the nearest cell like the mockup', () => {
  assert.deepEqual(progressBar(54, 16), { filled: '■'.repeat(9), empty: '□'.repeat(7) });
  assert.deepEqual(progressBar(39, 16), { filled: '■'.repeat(6), empty: '□'.repeat(10) });
  assert.deepEqual(progressBar(12, 16), { filled: '■■', empty: '□'.repeat(14) });
});

test('progressBar clamps out-of-range and non-finite percentages', () => {
  assert.deepEqual(progressBar(140, 10), { filled: '■'.repeat(10), empty: '' });
  assert.deepEqual(progressBar(-5, 10), { filled: '', empty: '□'.repeat(10) });
  assert.deepEqual(progressBar(NaN, 4), { filled: '', empty: '□□□□' });
});

test('normalizeSeries scales the newest points from their minimum to their maximum', () => {
  assert.deepEqual(normalizeSeries([10, 20, 30], 16), [0, 0.5, 1]);
  assert.deepEqual(normalizeSeries([5, 10, 20, 30], 2), [0, 1]);
  assert.deepEqual(normalizeSeries([10, NaN, 30, undefined], 16), [0, 1]);
});

test('normalizeSeries puts a flat series in the middle and handles nothing', () => {
  assert.deepEqual(normalizeSeries([40, 40], 16), [0.5, 0.5]);
  assert.deepEqual(normalizeSeries([], 16), []);
  assert.deepEqual(normalizeSeries(undefined, 16), []);
  assert.deepEqual(normalizeSeries([1, 2], 0), []);
});

test('brailleLine draws two points per character on four dot rows', () => {
  assert.equal(brailleLine([0, 1 / 3, 2 / 3, 1], 15), '⡠⠊');
  assert.equal(brailleLine([0.5, 0.5, 0.5, 0.5], 15), '⠒⠒');
  assert.equal(brailleLine([1], 15), '⠁');
});

test('brailleLine joins a jump vertically so the line stays continuous', () => {
  assert.equal(brailleLine([0, 1], 15), '⡸');
});

test('brailleLine keeps the newest points that fit and draws nothing without points', () => {
  assert.equal(brailleLine([1, 1, 0, 1 / 3, 2 / 3, 1], 2), '⡠⠊');
  assert.equal(brailleLine([], 15), '');
  assert.equal(brailleLine([0.5], 0), '');
});
