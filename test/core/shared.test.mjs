import { test } from 'node:test';
import assert from 'node:assert/strict';
import { folderName } from '../../src/core/paths.mjs';
import { appendPoint } from '../../src/core/history.mjs';

test('folderName takes the last segment of Windows and POSIX paths', () => {
  assert.equal(folderName('C:\\Users\\dev\\daily-claude'), 'daily-claude');
  assert.equal(folderName('/home/dev/api/'), 'api');
  assert.equal(folderName('C:/'), 'C:');
  assert.equal(folderName(''), null);
  assert.equal(folderName(42), null);
});

test('appendPoint adds a changed finite value and keeps the newest maxPoints', () => {
  assert.deepEqual(appendPoint([1, 2], 3, 40), [1, 2, 3]);
  assert.deepEqual(appendPoint([1, 2, 3], 4, 3), [2, 3, 4]);
});

test('appendPoint returns the same array for a repeat or a non-finite value', () => {
  const points = [5];
  assert.equal(appendPoint(points, 5, 40), points);
  assert.equal(appendPoint(points, NaN, 40), points);
  assert.equal(appendPoint(points, undefined, 40), points);
});
