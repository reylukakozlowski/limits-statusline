// Pure release arithmetic: versions, changelog sections, commit numbering, manifest updates.

const SEMVER = /^v?(\d+)\.(\d+)\.(\d+)$/;
const BUMPS = Object.freeze(['patch', 'minor', 'major']);
export const COMMIT_PREFIX = 'LS';

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

const UNRELEASED_HEADING = /^## \[Unreleased\][^\n]*\n/m;
const NEXT_HEADING = /^## \[/m;

/** Moves the [Unreleased] notes under `## [version] - date`, leaving [Unreleased] empty. */
export function stampChangelog(text, version, isoDate) {
  const heading = UNRELEASED_HEADING.exec(text);
  if (!heading) throw new Error('CHANGELOG.md has no [Unreleased] section.');
  const start = heading.index + heading[0].length;
  const end = sectionEnd(text, start);
  const notes = text.slice(start, end).trim();
  if (!notes) throw new Error('The [Unreleased] section of CHANGELOG.md is empty: describe the release first.');
  return `${text.slice(0, start)}\n## [${version}] - ${isoDate}\n\n${notes}\n\n${text.slice(end)}`;
}

/** The body of `## [version]`, for the GitHub release. */
export function extractReleaseNotes(text, version) {
  const bare = String(version).replace(/^v/, '');
  const heading = new RegExp(`^## \\[${bare.replace(/\./g, '\\.')}\\][^\\n]*\\n`, 'm').exec(text);
  const notes = heading ? text.slice(heading.index + heading[0].length, sectionEnd(text, heading.index + heading[0].length)).trim() : '';
  if (!notes) throw new Error(`No release notes for ${bare} in CHANGELOG.md.`);
  return notes;
}

function sectionEnd(text, start) {
  const next = text.slice(start).search(NEXT_HEADING);
  return next === -1 ? text.length : start + next;
}

/** Next N for `LS-N_…` and the older `LS-N …` commit subjects. */
export function nextCommitIndex(subjects, prefix = COMMIT_PREFIX) {
  // Not \b: `_` is a word character, so `LS-12_fix` has no word boundary after the number.
  const pattern = new RegExp(`^${prefix}-(\\d+)(?!\\d)`);
  const numbers = subjects.map((subject) => pattern.exec(subject)?.[1]).filter(Boolean).map(Number);
  return numbers.length ? Math.max(...numbers) + 1 : 1;
}

/** A manifest with its version (top-level and/or marketplace entries) set to `version`. */
export function withVersion(manifest, version) {
  const updated = { ...manifest };
  if ('version' in manifest) updated.version = version;
  if (Array.isArray(manifest.plugins)) {
    updated.plugins = manifest.plugins.map((entry) => ('version' in entry ? { ...entry, version } : entry));
  }
  return updated;
}

/**
 * The commit that released `version`: the newest of `sha<TAB>subject` lines (newest first) whose
 * subject is `LS-N_chore(release): vX.Y.Z` (or the older `LS-N chore(release): …`); null when none did.
 */
export function findReleaseCommit(lines, version, prefix = COMMIT_PREFIX) {
  const bare = String(version).replace(/^v/, '').replace(/\./g, '\\.');
  const subject = new RegExp(`^${prefix}-\\d+[ _]chore\\(release\\): v${bare}$`);
  for (const line of lines) {
    const tab = line.indexOf('\t');
    if (tab > 0 && subject.test(line.slice(tab + 1))) return line.slice(0, tab);
  }
  return null;
}
