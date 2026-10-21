// Pure release arithmetic: versions, the latest version tag, release notes.

const SEMVER = /^v?(\d+)\.(\d+)\.(\d+)$/;
const VERSION_TAG = /^v\d+\.\d+\.\d+$/;
const BUMPS = Object.freeze(['patch', 'minor', 'major']);

const parse = (version) => {
  const match = SEMVER.exec(String(version).trim());
  return match ? match.slice(1).map(Number) : null;
};

const compare = (a, b) => a[0] - b[0] || a[1] - b[1] || a[2] - b[2];

/**
 * @param {string} current X.Y.Z
 * @param {string} kind patch | minor | major | an explicit, higher X.Y.Z (a leading v is fine)
 */
export function nextVersion(current, kind) {
  const base = parse(current);
  if (!base) throw new Error(`Current version "${current}" is not a version (X.Y.Z).`);
  const [major, minor, patch] = base;
  if (kind === 'patch') return `${major}.${minor}.${patch + 1}`;
  if (kind === 'minor') return `${major}.${minor + 1}.0`;
  if (kind === 'major') return `${major + 1}.0.0`;
  const explicit = parse(kind);
  if (!explicit) throw new Error(`Release kind "${kind}" must be ${BUMPS.join(', ')} or a version X.Y.Z.`);
  if (compare(explicit, base) <= 0) throw new Error(`Version ${explicit.join('.')} must be higher than ${current}.`);
  return explicit.join('.');
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
