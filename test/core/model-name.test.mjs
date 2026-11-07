import { test } from 'node:test';
import assert from 'node:assert/strict';
import { prettyModelName } from '../../src/core/model-name.mjs';

test('prettyModelName turns API ids into family and version', () => {
  assert.equal(prettyModelName('claude-opus-5-5'), 'Opus 5.5');
  assert.equal(prettyModelName('claude-opus-5-5[1m]'), 'Opus 5.5');
  assert.equal(prettyModelName('claude-sonnet-4-5-20250929'), 'Sonnet 4.5');
  assert.equal(prettyModelName('claude-haiku-5-5'), 'Haiku 5.5');
});

// Major releases have no minor in their id: claude-opus-5, claude-sonnet-5 and claude-fable-5 are
// on https://platform.claude.com/docs/en/models/overview (legacy models, 2026-11-07).
test('prettyModelName reads the id of a major release, which has no minor version', () => {
  assert.equal(prettyModelName('claude-opus-5'), 'Opus 5');
  assert.equal(prettyModelName('claude-sonnet-5'), 'Sonnet 5');
  assert.equal(prettyModelName('claude-fable-5'), 'Fable 5');
  assert.equal(prettyModelName('claude-opus-5[1m]'), 'Opus 5');
});

// The date of an id is YYYYMMDD; a minor version is one or two digits.
test('prettyModelName never reads a date as a minor version', () => {
  assert.equal(prettyModelName('claude-haiku-4-5-20251001'), 'Haiku 4.5');
  assert.equal(prettyModelName('claude-opus-5-20260101'), 'Opus 5');
});

test('prettyModelName passes through ids of other forms unchanged', () => {
  for (const id of ['claude-3-5-sonnet-20241022', 'claude-opus-4-5@20251101', 'anthropic.claude-opus-5-5', 'claude-opus-5-123']) {
    assert.equal(prettyModelName(id), id);
  }
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
