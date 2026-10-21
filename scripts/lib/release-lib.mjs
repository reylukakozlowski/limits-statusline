// Pure release arithmetic: versions, the latest version tag, release notes.

const SEMVER = /^v?(\d+)\.(\d+)\.(\d+)$/;
const MANIFEST_VERSION = /^\d+\.\d+\.\d+$/;
const VERSION_TAG = /^v\d+\.\d+\.\d+$/;

const parse = (version) => {
  const match = SEMVER.exec(String(version).trim());
  return match ? match.slice(1).map(Number) : null;
};

const compare = (a, b) => a[0] - b[0] || a[1] - b[1] || a[2] - b[2];

/**
 * The version a release makes: the one `.claude-plugin/plugin.json` carries, which a pull request
 * into develop raised, as every change reaches develop. It has to be higher than the last release.
 * @param {unknown} manifestVersion the manifest's `version`
 * @param {string | null} previous X.Y.Z of the latest version tag, null before the first release
 */
export function releaseVersion(manifestVersion, previous) {
  if (typeof manifestVersion !== 'string' || !MANIFEST_VERSION.test(manifestVersion)) {
    throw new Error(`plugin.json has no version X.Y.Z (it has ${JSON.stringify(manifestVersion) ?? 'none'}).`);
  }
  if (previous !== null && compare(parse(manifestVersion), parse(previous)) <= 0) {
    throw new Error(`plugin.json's version ${manifestVersion} is not higher than the released ${previous}: `
      + 'raise it in plugin.json through a pull request into develop first.');
  }
  return manifestVersion;
}

/** The highest X.Y.Z among `vX.Y.Z` tag names, or null when there is none. */
export function latestVersion(tags) {
  const versions = tags.filter((tag) => VERSION_TAG.test(tag)).map(parse);
  if (versions.length === 0) return null;
  return versions.sort(compare).at(-1).join('.');
}

/** The release notes: one line per commit subject, in the order given. */
export function releaseNotes(subjects) {
  const lines = subjects.map((subject) => subject.trim()).filter(Boolean);
  if (lines.length === 0) throw new Error('There are no commits to release.');
  return lines.map((subject) => `- ${subject}`).join('\n');
}
