import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  latestVersion, nextVersion, releaseNotes, releaseSource, sourceTrailer, withManifestVersion,
} from '../../scripts/lib/release-lib.mjs';

test('nextVersion raises the patch, minor or major part of the last release', () => {
  assert.equal(nextVersion('1.0.10', 'patch'), '1.0.11');
  assert.equal(nextVersion('1.0.10', 'minor'), '1.1.0');
  assert.equal(nextVersion('1.9.3', 'major'), '2.0.0');
  assert.equal(nextVersion('0.9.9', 'patch'), '0.9.10');
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

const DEVELOP_MANIFEST = '{\n  "name": "limits-statusline",\n  "displayName": "Limits Status Line",\n  "icon": "./assets/icon.svg"\n}\n';

test('withManifestVersion puts the version on its own line after "name" in develop\'s manifest', () => {
  assert.equal(withManifestVersion(DEVELOP_MANIFEST, '1.0.11'),
    '{\n  "name": "limits-statusline",\n  "version": "1.0.11",\n  "displayName": "Limits Status Line",\n  "icon": "./assets/icon.svg"\n}\n');
  const crlf = DEVELOP_MANIFEST.replace(/\n/g, '\r\n');
  assert.equal(withManifestVersion(crlf, '1.1.0'), crlf.replace('"limits-statusline",\r\n', '"limits-statusline",\r\n  "version": "1.1.0",\r\n'));
  assert.deepEqual(JSON.parse(withManifestVersion(DEVELOP_MANIFEST, '2.0.0')), { ...JSON.parse(DEVELOP_MANIFEST), version: '2.0.0' });
});

test('withManifestVersion puts the version after a "name" that is the last field, and the JSON stays valid', () => {
  assert.equal(withManifestVersion('{\n  "name": "demo"\n}\n', '0.1.1'), '{\n  "name": "demo",\n  "version": "0.1.1"\n}\n');
  assert.deepEqual(JSON.parse(withManifestVersion('{\r\n  "name": "demo"\r\n}\r\n', '0.1.1')), { name: 'demo', version: '0.1.1' });
});

test('withManifestVersion replaces a version line that is there and leaves the rest as written', () => {
  const withVersion = DEVELOP_MANIFEST.replace('"limits-statusline",\n', '"limits-statusline",\n  "version": "1.0.10",\n');
  assert.equal(withManifestVersion(withVersion, '1.0.11'), withVersion.replace('"1.0.10"', '"1.0.11"'));
});

test('withManifestVersion refuses two version lines, and a manifest with no "name" line', () => {
  const twice = '{\n  "name": "x",\n  "version": "1.0.0",\n  "version": "2.0.0"\n}\n';
  assert.throws(() => withManifestVersion(twice, '1.0.11'), /2 "version" lines/);
  assert.throws(() => withManifestVersion('{\n  "displayName": "x"\n}\n', '1.0.11'), /no "name" line/);
});

test('withManifestVersion refuses a result that is not the manifest with its top-level version set', () => {
  const nested = '{\n  "name": "x",\n  "userConfig": { "band": { "version": "1" } }\n}\n';
  assert.throws(() => withManifestVersion(nested, '1.0.11'), /not the top-level version/);
  assert.throws(() => withManifestVersion('{\n  "name": "x",\n  "icon": \n}\n', '1.0.11'), /not valid JSON/);
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

test('a release commit names its develop commit in a trailer that releaseSource reads back', () => {
  const sha = 'a'.repeat(40);
  assert.equal(sourceTrailer(sha), `Source: develop@${sha}`);
  assert.equal(releaseSource(`Release v1.0.11\n\n- LS-60_feat: a\n\n${sourceTrailer(sha)}\n`), sha);
});

test('releaseSource finds none in a message without the trailer or with a malformed one', () => {
  for (const message of ['LS-58_docs: an old release, develop\'s own commit', 'Source: develop@abc', 'Source: master@' + 'b'.repeat(40), '']) {
    assert.equal(releaseSource(message), null, message);
  }
});
