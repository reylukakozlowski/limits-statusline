// What every line of the layout is made of: tone-tagged segments, the bar with its percentage,
// and the choice of the fullest drawing that fits the surface.

import { formatPercent } from './format.mjs';
import { progressBar } from './glyphs.mjs';
import { TONE } from './thresholds.mjs';

/**
 * A segment that draws a line chart also carries its points (`series`, 0–1, oldest first), so a
 * surface that can draw vector graphics draws the line instead of the braille `text`.
 * @typedef {{ text: string, tone: string, series?: number[] }} Segment
 * @typedef {Segment[]} Line
 */

export const LABEL_WIDTH = 4; // "ctx ", "7d  ", "5h  ", "usd "; the session line is indented to match
export const PERCENT_WIDTH = 3; // "54%"
export const GAP = '  ';

export const segment = (text, tone = TONE.plain) => ({ text, tone });
export const separator = (text) => segment(text, TONE.muted);
export const label = (text) => segment(text.padEnd(LABEL_WIDTH), TONE.muted);

/** @param {Line} line */
export const lineText = (line) => line.map((part) => part.text).join('');

/** The length of the longest of `texts`, and at least `least`. */
export const widest = (texts, least = 0) => Math.max(least, ...texts.map((text) => text.length));

/**
 * The first of the drawings, fullest first, whose lines all fit the width; the last one when
 * none does. An unknown width fits everything.
 * @param {number | null} width
 * @param {Array<() => Line[]>} drawings
 * @returns {Line[]}
 */
export function firstThatFits(width, drawings) {
  const fits = (lines) => width === null || lines.every((line) => lineText(line).length <= width);
  for (const draw of drawings.slice(0, -1)) {
    const lines = draw();
    if (fits(lines)) return lines;
  }
  return drawings.at(-1)();
}

/** A bar of `width` cells and the percentage after it, padded to `percentWidth`. */
export function barSegments(percent, tone, width, percentWidth = PERCENT_WIDTH) {
  const { filled, empty } = progressBar(percent, width);
  return [
    segment(filled, tone),
    segment(empty, TONE.muted),
    segment(' '),
    segment(formatPercent(percent).padStart(percentWidth), tone),
  ];
}
