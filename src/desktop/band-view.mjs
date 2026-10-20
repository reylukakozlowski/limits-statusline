// Lines → a Box/Text tree for the band above the prompt. Tones become theme colour keys, so
// the band follows the person's light or dark theme; a line chart becomes an SVG where the
// surface draws one (the desktop app), as in the approved mockup.

import { sparklineSvg } from './sparkline-svg.mjs';

export const TONE_COLOR = Object.freeze({
  muted: 'subtle',
  accent: 'suggestion',
  model: 'merged',
  ok: 'success',
  warn: 'warning',
  alert: 'error',
  cost: 'claude',
  spark: 'suggestion',
  added: 'success',
  removed: 'error',
});

const BOLD_TONES = new Set(['accent', 'alert']);

// About 15 monospaced characters by one row, like the mockup's line; SVG cannot use theme
// keys, so the stroke is the terminal sparkline's teal.
const CHART = Object.freeze({ width: 120, height: 16, color: '#5fafaf', alt: 'Context window fill over the session' });

/**
 * @param {import('../core/layout.mjs').Line[]} lines
 * @param {{ Box: unknown, Text: unknown, Svg?: unknown }} elements the surface's table from $.ui.resolve(e)
 * @param {(tag: unknown, props: object, ...children: unknown[]) => unknown} createElement the engine's `h`
 * @param {{ typography?: boolean }} [options] true where Text takes `mono` and `tabular` (2.1.299+)
 */
export function renderBand(lines, elements, createElement, { typography = false } = {}) {
  const rowProps = typography ? { wrap: 'truncate-end', mono: true, tabular: true } : { wrap: 'truncate-end' };
  const textRow = (parts) => createElement(elements.Text, rowProps, ...parts
    .filter((part) => part.text)
    .map((part) => createElement(elements.Text, styleFor(part.tone), part.text)));

  const rows = lines.map((line) => {
    const chartIndex = elements.Svg ? line.findIndex((part) => part.series?.length) : -1;
    if (chartIndex === -1) return textRow(line);
    return createElement(
      elements.Box,
      { flexDirection: 'row' },
      textRow(line.slice(0, chartIndex)),
      createElement(elements.Svg, {
        source: sparklineSvg(line[chartIndex].series, CHART),
        alt: CHART.alt,
        width: CHART.width,
        height: CHART.height,
      }),
    );
  });
  return createElement(elements.Box, { flexDirection: 'column' }, ...rows);
}

function styleFor(tone) {
  const style = {};
  if (Object.hasOwn(TONE_COLOR, tone)) style.color = TONE_COLOR[tone];
  // `bold` rather than `weight`: a tree with `weight` does not draw before Claude Code 2.1.299.
  if (BOLD_TONES.has(tone)) style.bold = true;
  return style;
}
