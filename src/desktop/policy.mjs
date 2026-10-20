// Where the band draws (userConfig `band`). The terminal has the classic status line at the
// bottom, so by default the band only draws in the desktop app.

export const BAND_SURFACES = Object.freeze({
  desktop: Object.freeze(['desktop']),
  all: Object.freeze(['desktop', 'terminal']),
  off: Object.freeze([]),
});

export const DEFAULT_BAND_MODE = 'desktop';

/** @param {unknown} mode userConfig value @param {string} surface `e.surface` */
export function shouldDraw(mode, surface) {
  const key = typeof mode === 'string' && Object.hasOwn(BAND_SURFACES, mode) ? mode : DEFAULT_BAND_MODE;
  return BAND_SURFACES[key].includes(surface);
}

// Text `mono` and `tabular` arrived in 2.1.299; an older release refuses the whole tree.
const TYPOGRAPHY_SINCE = Object.freeze([2, 1, 299]);

/** @param {unknown} version `$.session.version().version`, e.g. "2.1.299" */
export function supportsTypography(version) {
  const match = /^(\d+)\.(\d+)\.(\d+)/.exec(typeof version === 'string' ? version : '');
  if (!match) return false;
  const parts = match.slice(1).map(Number);
  const firstDifference = parts.findIndex((part, index) => part !== TYPOGRAPHY_SINCE[index]);
  return firstDifference === -1 || parts[firstDifference] > TYPOGRAPHY_SINCE[firstDifference];
}
