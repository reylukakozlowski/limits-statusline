import { test } from 'node:test';
import assert from 'node:assert/strict';
import { latestVersion, nextVersion, releaseNotes } from '../../scripts/lib/release-lib.mjs';

test('nextVersion bumps patch, minor and major', () => {
  assert.equal(nextVersion('0.1.0', 'patch'), '0.1.1');
  assert.equal(nextVersion('0.1.9', 'minor'), '0.2.0');
  assert.equal(nextVersion('0.9.3', 'major'), '1.0.0');
});

test('nextVersion accepts a higher explicit version, compared numerically', () => {
  assert.equal(nextVersion('0.9.0', '0.10.0'), '0.10.0');
  assert.equal(nextVersion('0.1.0', 'v0.3.0'), '0.3.0');
});

test('nextVersion refuses garbage and versions that do not go up', () => {
  assert.throws(() => nextVersion('0.1.0', '0.1.0'), /must be higher/);
  assert.throws(() => nextVersion('0.1.0', '0.0.9'), /must be higher/);
  assert.throws(() => nextVersion('0.1.0', 'bump'), /patch, minor, major/);
  assert.throws(() => nextVersion('one', 'patch'), /not a version/);
});

test('latestVersion picks the highest vX.Y.Z tag, compared numerically, and ignores other tags', () => {
  assert.equal(latestVersion(['v0.9.0', 'v0.10.0', 'v0.2.1']), '0.10.0');
  assert.equal(latestVersion(['v1.0.2', 'latest', 'v2', 'v1.0.10-rc.1', '1.5.0', '']), '1.0.2');
  assert.equal(latestVersion([]), null);
  assert.equal(latestVersion(['nightly']), null);
});

test('releaseNotes lists each commit subject, oldest first as given', () => {
  assert.equal(releaseNotes(['LS-28_feat: a', 'LS-29_fix: b', '']), '- LS-28_feat: a\n- LS-29_fix: b');
  assert.throws(() => releaseNotes(['', '  ']), /no commits/);
});
