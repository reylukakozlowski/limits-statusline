import { test } from 'node:test';
import assert from 'node:assert/strict';
import { prettyModelName } from '../../src/core/model-name.mjs';

test('prettyModelName turns API ids into family and version', () => {
  assert.equal(prettyModelName('claude-opus-5-5'), 'Opus 5.5');
  assert.equal(prettyModelName('claude-opus-5-5[1m]'), 'Opus 5.5');
  assert.equal(prettyModelName('claude-sonnet-4-5-20250929'), 'Sonnet 4.5');
  assert.equal(prettyModelName('claude-haiku-5-5'), 'Haiku 5.5');
});

test('prettyModelName keeps display names and rejects empty input', () => {
  assert.equal(prettyModelName('Opus 5.5'), 'Opus 5.5');
  assert.equal(prettyModelName('  Fable 5.1  '), 'Fable 5.1');
  assert.equal(prettyModelName(''), null);
  assert.equal(prettyModelName(null), null);
  assert.equal(prettyModelName(42), null);
});

test('prettyModelName drops a bracketed context suffix from aliases', () => {
  assert.equal(prettyModelName('opus[1m]'), 'opus');
});
