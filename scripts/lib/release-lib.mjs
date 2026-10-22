// Pure release arithmetic: versions, the latest version tag, release notes, the release commit's
// manifest and the develop commit a release was made from.

const SEMVER = /^v?(\d+)\.(\d+)\.(\d+)$/;
const VERSION_TAG = /^v\d+\.\d+\.\d+$/;
const VERSION_LINE = /("version"\s*:\s*")[^"]*(")/g;
const NAME_LINE = /^([ \t]*)("name"\s*:\s*"[^"]*")(,?)[ \t]*(\r?\n)/m;
const SOURCE = /^Source: develop@([0-9a-f]{40})$/m;

export const BUMPS = Object.freeze(['patch', 'minor', 'major']);

const parse = (version) => {
  const match = SEMVER.exec(String(version).trim());
  return match ? match.slice(1).map(Number) : null;
};

const compare = (a, b) => a[0] - b[0] || a[1] - b[1] || a[2] - b[2];

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
 * The manifest of a release commit: develop's plugin.json, which carries no version, with the
 * release's version on a line of its own after "name"; a version line already there is replaced.
 * Nothing else in the file changes.
 * @param {string} text .claude-plugin/plugin.json
 * @param {string} version X.Y.Z
 */
export function withManifestVersion(text, version) {
  const result = setVersionLine(text, version);
  // The text is edited as text; the result has to be the same JSON with the top-level version set.
  let manifest;
  try {
    manifest = JSON.parse(result);
  } catch {
    throw new Error('plugin.json is not valid JSON with the version set.');
  }
  if (manifest.version !== version) throw new Error('plugin.json\'s "version" line is not the top-level version.');
  return result;
}

function setVersionLine(text, version) {
  const versionLines = text.match(VERSION_LINE) ?? [];
  if (versionLines.length > 1) throw new Error(`plugin.json has ${versionLines.length} "version" lines, not one.`);
  if (versionLines.length === 1) return text.replace(VERSION_LINE, `$1${version}$2`);
  if (!NAME_LINE.test(text)) throw new Error('plugin.json has no "name" line to put the version after.');
  // After "name"; a "name" that was the last field gets the comma, and the version becomes the last.
  return text.replace(NAME_LINE, (line, indent, name, comma, newline) => (comma
    ? `${line}${indent}"version": "${version}",${newline}`
    : `${indent}${name},${newline}${indent}"version": "${version}"${newline}`));
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

/** The line a release commit's message ends with: the develop commit whose files it carries. */
export const sourceTrailer = (sha) => `Source: develop@${sha}`;

/**
 * The develop commit a release commit was made from, read from its message; null for a message
 * without one (the releases up to v1.0.10 were develop's own commits).
 * @param {string} message a release commit's message
 */
export const releaseSource = (message) => SOURCE.exec(message)?.[1] ?? null;
