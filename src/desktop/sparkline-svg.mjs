// The context history as a thin vector line, the way the approved mockup draws it. The desktop
// app has an Svg element; the terminal falls back to the braille line from core/glyphs.

const PADDING = 1;
const SAFE_COLOR = /^#[0-9a-f]{3,8}$|^[a-z]+$/i;

const round = (value) => Math.round(value * 10) / 10;

/**
 * @param {number[]} series 0 (bottom) to 1 (top), oldest first
 * @param {{ width: number, height: number, color: string }} box CSS pixels and a stroke colour
 * @returns {string} an SVG document, or '' when there is nothing to draw
 */
export function sparklineSvg(series, { width, height, color }) {
  if (!SAFE_COLOR.test(color)) throw new Error(`Unsafe colour for the sparkline: ${color}`);
  if (series.length === 0) return '';
  const values = series.length === 1 ? [series[0], series[0]] : series;
  const innerWidth = width - 2 * PADDING;
  const innerHeight = height - 2 * PADDING;
  const points = values.map((value, index) => {
    const x = PADDING + (index / (values.length - 1)) * innerWidth;
    const y = PADDING + (1 - Math.min(1, Math.max(0, value))) * innerHeight;
    return `${round(x)},${round(y)}`;
  });
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">`
    + `<polyline fill="none" stroke="${color}" stroke-width="1.5" stroke-linejoin="round" stroke-linecap="round" points="${points.join(' ')}"/>`
    + '</svg>';
}
