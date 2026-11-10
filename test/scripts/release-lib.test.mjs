import { test } from 'node:test';
import assert from 'node:assert/strict';
import { latestVersion, nextVersion, releaseNotes, withManifestVersion } from '../../scripts/lib/release-lib.mjs';

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

// The owner's decision: the note given in the Release form comes first, then the commits.
test('releaseNotes puts the owner\'s note first, a blank line before the commits', () => {
  assert.equal(releaseNotes(['LS-28_feat: a', 'LS-29_fix: b'], 'Faster start-up.'), 'Faster start-up.\n\n- LS-28_feat: a\n- LS-29_fix: b');
  assert.equal(releaseNotes(['LS-28_feat: a'], '  Faster start-up.  '), 'Faster start-up.\n\n- LS-28_feat: a', 'trimmed');
});

// The promote job trims the note with awk's [ \t]: any other trimming would make it refuse the notes.
test('releaseNotes trims the note of spaces and tabs only, as the promote job does', () => {
  assert.equal(releaseNotes(['LS-28_feat: a'], '\t Faster start-up. \t'), 'Faster start-up.\n\n- LS-28_feat: a');
  assert.equal(releaseNotes(['LS-28_feat: a'], ' Faster start-up. '), ' Faster start-up. \n\n- LS-28_feat: a');
});

// The promote job trims each subject with awk's [ \t] as well: String.prototype.trim would also
// take a no-break space, a vertical tab or a form feed, and the job would refuse the notes.
test('releaseNotes trims each subject of spaces and tabs only, as the promote job does', () => {
  assert.equal(releaseNotes([' \tLS-28_feat: a\t ', ' LS-29_fix: b ', '\vLS-30_fix: c\f']),
    '- LS-28_feat: a\n-  LS-29_fix: b \n- \vLS-30_fix: c\f');
  // A subject of spaces and tabs alone is skipped; one of other blanks stays, as in the job.
  assert.equal(releaseNotes(['LS-28_feat: a', ' \t ', ' ']), '- LS-28_feat: a\n-  ');
});

test('releaseNotes without a note, or with a blank one, is the commits alone', () => {
  for (const note of [undefined, '', '   ']) assert.equal(releaseNotes(['LS-28_feat: a'], note), '- LS-28_feat: a', JSON.stringify(note));
});

test('a note is no release: with no commits releaseNotes still refuses', () => {
  assert.throws(() => releaseNotes([], 'Faster start-up.'), /no commits/);
});
