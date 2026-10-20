// Model labels: the API id `claude-opus-5-5[1m]` reads as `Opus 5.5`; display names pass through.

const API_ID = /^claude-([a-z]+)-(\d+)-(\d+)(?:-\d{8})?$/i;
const BRACKET_SUFFIX = /\[[^\]]*\]$/;

/** @param {unknown} raw @returns {string | null} */
export function prettyModelName(raw) {
  if (typeof raw !== 'string') return null;
  const name = raw.trim().replace(BRACKET_SUFFIX, '');
  if (name === '') return null;
  const match = API_ID.exec(name);
  if (!match) return name;
  const [, family, major, minor] = match;
  return `${family[0].toUpperCase()}${family.slice(1).toLowerCase()} ${major}.${minor}`;
}
