import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  extractReleaseNotes, findReleaseCommit, nextCommitIndex, nextVersion, stampChangelog, withVersion,
} from '../../scripts/lib/release-lib.mjs';

const CHANGELOG = `# Changelog

Intro.

## [Unreleased]

### Fixed
- The thing.

## [0.1.0] - 2026-10-20

### Added
- First release.
`;

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

test('stampChangelog moves Unreleased under the new version and leaves it empty', () => {
  const stamped = stampChangelog(CHANGELOG, '0.1.1', '2026-10-21');
  assert.match(stamped, /## \[Unreleased\]\n\n## \[0\.1\.1\] - 2026-10-21\n\n### Fixed\n- The thing\.\n\n## \[0\.1\.0\]/);
});

test('stampChangelog refuses an empty or missing Unreleased section', () => {
  const empty = CHANGELOG.replace('### Fixed\n- The thing.\n\n', '');
  assert.throws(() => stampChangelog(empty, '0.1.1', '2026-10-21'), /Unreleased.*empty/);
  assert.throws(() => stampChangelog('# Changelog\n', '0.1.1', '2026-10-21'), /no \[Unreleased\]/);
});

test('extractReleaseNotes returns one version body, with or without the v prefix', () => {
  assert.equal(extractReleaseNotes(CHANGELOG, 'v0.1.0'), '### Added\n- First release.');
  assert.throws(() => extractReleaseNotes(CHANGELOG, '9.9.9'), /9\.9\.9/);
});

test('nextCommitIndex continues the LS-N numbering', () => {
  assert.equal(nextCommitIndex(['LS-1 feat: x', 'LS-7 fix: y', 'foo', 'CSL-99 z']), 8);
  assert.equal(nextCommitIndex([]), 1);
});

test('nextCommitIndex counts LS-N_ subjects too, where no word boundary follows the number', () => {
  assert.equal(nextCommitIndex(['LS-12_fix: y', 'LS-7 chore(release): v0.1.1', 'LS-9_chore: z']), 13);
  assert.equal(nextCommitIndex(['LS-123456789x', 'LS-2_a']), 123456790);
});

test('withVersion sets the top-level version and every marketplace entry version', () => {
  assert.deepEqual(withVersion({ name: 'p', version: '0.1.0' }, '0.2.0'), { name: 'p', version: '0.2.0' });
  assert.deepEqual(
    withVersion({ name: 'm', plugins: [{ name: 'p', version: '0.1.0', source: './' }] }, '0.2.0'),
    { name: 'm', plugins: [{ name: 'p', version: '0.2.0', source: './' }] },
  );
});

test('findReleaseCommit picks the newest commit that released the version, or null', () => {
  // v0.1.1 was released under the older `LS-N chore` subject, later releases as `LS-N_chore`.
  const log = ['c3\tLS-9_docs: later', 'c2\tLS-8_chore(release): v0.1.2', 'c1\tLS-7 chore(release): v0.1.1', ''];
  assert.equal(findReleaseCommit(log, '0.1.2'), 'c2');
  assert.equal(findReleaseCommit(log, 'v0.1.1'), 'c1');
  assert.equal(findReleaseCommit(log, '0.1.3'), null);
  assert.equal(findReleaseCommit(['c4\tLS-10 chore(release): v0x1x2'], '0.1.2'), null);
});
