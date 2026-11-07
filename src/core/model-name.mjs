// Model labels: the API id `claude-opus-5-5[1m]` reads as `Opus 5.5` and `claude-opus-5` as
// `Opus 5`; display names pass through. Ids follow https://platform.claude.com/docs/en/about-claude/models/model-ids-and-versions:
// `claude-{name}-{major}[-{minor}]` from the 4.6 generation on (a major release has no minor),
// `claude-{name}-{major}-{minor}-{YYYYMMDD}` before it.

const API_ID = /^claude-([a-z]+)-(\d+)(?:-(\d{1,2}))?(?:-\d{8})?$/i;
const BRACKET_SUFFIX = /\[[^\]]*\]$/;

/** @param {unknown} raw @returns {string | null} */
export function prettyModelName(raw) {
  if (typeof raw !== 'string') return null;
  const name = raw.trim().replace(BRACKET_SUFFIX, '');
  if (name === '') return null;
  const match = API_ID.exec(name);
  if (!match) return name;
  const [, family, major, minor] = match;
  const version = minor === undefined ? major : `${major}.${minor}`;
  return `${family[0].toUpperCase()}${family.slice(1).toLowerCase()} ${version}`;
}
