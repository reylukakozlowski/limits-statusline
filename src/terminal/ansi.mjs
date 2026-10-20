// Tone → 256-colour SGR codes. Plain text when colour is off (NO_COLOR).

const ESC = '\u001b';
const RESET = `${ESC}[0m`;

export const TONE_SGR = Object.freeze({
  plain: '',
  muted: '38;5;245',
  accent: '1;38;5;75',
  model: '38;5;141',
  ok: '38;5;71',
  warn: '38;5;214',
  alert: '1;38;5;203',
  cost: '38;5;214',
  spark: '38;5;73',
});

/**
 * @param {import('../core/layout.mjs').Line[]} lines
 * @param {{ color: boolean }} options
 * @returns {string} lines joined by \n, without a trailing newline
 */
export function renderAnsi(lines, { color }) {
  return lines.map((line) => line.map((part) => paint(part, color)).join('')).join('\n');
}

function paint({ text, tone }, color) {
  if (!text) return '';
  const sgr = color && Object.hasOwn(TONE_SGR, tone) ? TONE_SGR[tone] : '';
  return sgr ? `${ESC}[${sgr}m${text}${RESET}` : text;
}
