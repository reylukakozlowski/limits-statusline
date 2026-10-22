// Pure release arithmetic: versions, the latest version tag, release notes.

const SEMVER = /^v?(\d+)\.(\d+)\.(\d+)$/;
const MANIFEST_VERSION = /^\d+\.\d+\.\d+$/;
const VERSION_TAG = /^v\d+\.\d+\.\d+$/;

const parse = (version) => {
  const match = SEMVER.exec(String(version).trim());
  return match ? match.slice(1).map(Number) : null;
};

const compare = (a, b) => a[0] - b[0] || a[1] - b[1] || a[2] - b[2];

export const BUMPS = Object.freeze(['patch', 'minor', 'major']);
const VERSION_LINE = /("version"\s*:\s*")\d+\.\d+\.\d+(")/g;

/**
 * The version after the last release, with the part the owner picked raised.
 * @param {string | null} previous X.Y.Z of the latest version tag, null before the first release
 * @param {unknown} bump patch | minor | major
 */
export function nextVersion(previous, bump) {
  if (!BUMPS.includes(bump)) throw new Error(`The part to raise must be patch, minor or major (it is ${JSON.stringify(bump)}).`);
  const base = previous === null ? [0, 0, 0] : parse(previous);
  if (!base) throw new Error(`The last release "${previous}" is not a version (X.Y.Z).`);
  const [major, minor, patch] = base;
  if (bump === 'major') return `${major + 1}.0.0`;
  if (bump === 'minor') return `${major}.${minor + 1}.0`;
  return `${major}.${minor}.${patch + 1}`;
}

/**
 * The manifest's text with its version set to `version`: the version line alone changes, so the
 * file stays as written.
 * @param {string} text .claude-plugin/plugin.json
 * @param {string} version X.Y.Z
 */
export function withManifestVersion(text, version) {
  const lines = text.match(VERSION_LINE) ?? [];
  if (lines.length !== 1) throw new Error(`plugin.json has to have one "version" line X.Y.Z (it has ${lines.length}).`);
  return text.replace(VERSION_LINE, `$1${version}$2`);
}

/**
 * The number for the next change: one past the highest `<prefix>-<n>_` among commit subjects and
 * branch names, so it collides with no change already made or under way.
 * @param {string[]} names commit subjects and branch names
 * @param {string} prefix such as LS
 */
export function nextChangeNumber(names, prefix) {
  const pattern = new RegExp(`(?:^|/)${prefix}-(\\d+)_`);
  const numbers = names.map((name) => pattern.exec(name)?.[1]).filter(Boolean).map(Number);
  return Math.max(0, ...numbers) + 1;
}

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
      + 'run the Prepare release workflow (patch, minor or major) and merge its pull request first, '
      + 'or raise it in a pull request of your own.');
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
