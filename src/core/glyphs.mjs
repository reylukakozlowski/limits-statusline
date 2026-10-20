// Bars and line charts drawn with plain Unicode, so every surface can show them.

export const GLYPH = Object.freeze({ filled: '■', empty: '□' });

/** Cells in a full-width bar, as measured in the approved mockup. */
export const BAR_CELLS = 16;

const clampPercent = (value) => Math.min(100, Math.max(0, value));

/**
 * A fixed-width bar split into its filled and empty parts, so a renderer can colour them apart.
 * @param {number} percent 0–100; anything else is clamped, non-finite counts as 0
 * @param {number} width cells in the whole bar
 * @returns {{ filled: string, empty: string }}
 */
export function progressBar(percent, width) {
  const ratio = Number.isFinite(percent) ? clampPercent(percent) / 100 : 0;
  const filledCells = Math.round(ratio * width);
  return {
    filled: GLYPH.filled.repeat(filledCells),
    empty: GLYPH.empty.repeat(width - filledCells),
  };
}

/**
 * The newest `maxPoints` finite values scaled from their minimum (0) to their maximum (1),
 * so the line shows the shape of the trend; a flat series sits in the middle.
 * @param {unknown[] | undefined} values
 * @param {number} maxPoints
 * @returns {number[]}
 */
export function normalizeSeries(values, maxPoints) {
  if (!Array.isArray(values) || !(maxPoints > 0)) return [];
  const points = values.filter(Number.isFinite).slice(-maxPoints);
  const low = Math.min(...points);
  const span = Math.max(...points) - low;
  return points.map((value) => (span > 0 ? (value - low) / span : 0.5));
}

// A braille character holds 2×4 dots: the bit of each [row][column], rows from the top.
const DOT_BITS = Object.freeze([[0x01, 0x08], [0x02, 0x10], [0x04, 0x20], [0x40, 0x80]]);
const DOT_ROWS = DOT_BITS.length;
const POINTS_PER_CHAR = 2;
const BRAILLE_BLANK = 0x2800;

/**
 * A one-row line chart: two points per character, four heights, each point joined
 * vertically to the one before it so the line reads as continuous.
 * @param {number[]} series values from 0 (bottom) to 1 (top), as normalizeSeries gives them
 * @param {number} widthChars characters available; the newest points that fit are drawn
 */
export function brailleLine(series, widthChars) {
  if (!(widthChars > 0)) return '';
  const points = series.slice(-widthChars * POINTS_PER_CHAR);
  const cells = new Array(Math.ceil(points.length / POINTS_PER_CHAR)).fill(0);
  let previousRow = null;
  points.forEach((value, index) => {
    const row = DOT_ROWS - 1 - Math.round(Math.min(1, Math.max(0, value)) * (DOT_ROWS - 1));
    const column = index % POINTS_PER_CHAR;
    const cell = Math.floor(index / POINTS_PER_CHAR);
    const top = Math.min(row, previousRow ?? row);
    const bottom = Math.max(row, previousRow ?? row);
    for (let dotRow = top; dotRow <= bottom; dotRow += 1) {
      // The previous point's own dot is already drawn; this column gets the rest of the step.
      if (dotRow === row || dotRow !== previousRow) cells[cell] |= DOT_BITS[dotRow][column];
    }
    previousRow = row;
  });
  return cells.map((bits) => String.fromCodePoint(BRAILLE_BLANK + bits)).join('');
}
