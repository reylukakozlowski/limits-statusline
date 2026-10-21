import { test } from 'node:test';
import assert from 'node:assert/strict';
import { latestVersion, releaseVersion, releaseNotes } from '../../scripts/lib/release-lib.mjs';

test('releaseVersion takes the manifest version when it is higher than the last release, compared numerically', () => {
  assert.equal(releaseVersion('1.0.9', '1.0.8'), '1.0.9');
  assert.equal(releaseVersion('1.1.0', '1.0.8'), '1.1.0');
  assert.equal(releaseVersion('2.0.0', '1.9.9'), '2.0.0');
  assert.equal(releaseVersion('0.10.0', '0.9.0'), '0.10.0');
});

test('releaseVersion takes any manifest version for the first release', () => {
  assert.equal(releaseVersion('0.0.1', null), '0.0.1');
});

test('releaseVersion refuses a manifest version that is already released or lower', () => {
  assert.throws(() => releaseVersion('1.0.8', '1.0.8'), /1\.0\.8 is not higher than the released 1\.0\.8.*pull request/);
  assert.throws(() => releaseVersion('1.0.7', '1.0.8'), /not higher/);
});

test('releaseVersion refuses a manifest without a plain X.Y.Z version', () => {
  for (const version of [undefined, null, '', 'v1.0.9', '1.0', '1.0.9-rc.1', ' 1.0.9', 109]) {
    assert.throws(() => releaseVersion(version, '1.0.8'), /plugin\.json/, String(version));
  }
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
