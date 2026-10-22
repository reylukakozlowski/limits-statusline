import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  latestVersion, nextChangeNumber, nextVersion, releaseVersion, releaseNotes, withManifestVersion,
} from '../../scripts/lib/release-lib.mjs';

test('nextVersion raises the patch, minor or major part of the last release', () => {
  assert.equal(nextVersion('1.0.10', 'patch'), '1.0.11');
  assert.equal(nextVersion('1.0.10', 'minor'), '1.1.0');
  assert.equal(nextVersion('1.9.3', 'major'), '2.0.0');
});

test('nextVersion counts from 0.0.0 before the first release', () => {
  assert.equal(nextVersion(null, 'patch'), '0.0.1');
  assert.equal(nextVersion(null, 'minor'), '0.1.0');
});

test('nextVersion refuses a part that is not patch, minor or major, and a last release that is no version', () => {
  for (const bump of ['', 'PATCH', 'major ', '1.2.3', undefined]) {
    assert.throws(() => nextVersion('1.0.10', bump), /patch, minor or major/, String(bump));
  }
  assert.throws(() => nextVersion('one', 'patch'), /not a version/);
});

const MANIFEST = '{\n  "name": "limits-statusline",\n  "version": "1.0.10",\n  "icon": "./assets/icon.svg"\n}\n';

test('withManifestVersion changes the version line alone and keeps the rest as written', () => {
  assert.equal(withManifestVersion(MANIFEST, '1.0.11'), MANIFEST.replace('"1.0.10"', '"1.0.11"'));
  const crlf = MANIFEST.replace(/\n/g, '\r\n');
  assert.equal(withManifestVersion(crlf, '1.1.0'), crlf.replace('"1.0.10"', '"1.1.0"'));
});

test('withManifestVersion refuses a manifest without exactly one version line', () => {
  assert.throws(() => withManifestVersion('{\n  "name": "x"\n}\n', '1.0.11'), /one "version"/);
  const twice = MANIFEST.replace('"icon"', '"version": "9.9.9",\n  "icon"');
  assert.throws(() => withManifestVersion(twice, '1.0.11'), /one "version"/);
});

test('nextChangeNumber takes the next number after every LS-<n> in commit subjects and branch names', () => {
  const subjects = ['LS-53_docs: a', 'LS-54_chore: b', 'Update README.md', 'LS-3 feat: old style'];
  const branches = ['origin/feature/lko/develop/LS-55_prepare-release', 'origin/develop'];
  assert.equal(nextChangeNumber([...subjects, ...branches], 'LS'), 56);
  assert.equal(nextChangeNumber(['Initial commit'], 'LS'), 1);
  assert.equal(nextChangeNumber(['XLS-99_no', 'LS-9_yes'], 'LS'), 10);
});

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
