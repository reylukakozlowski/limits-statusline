// The context line's series: a point is added only when the value changes, so periodic redraws
// do not flatten the trend.

/** Points kept per session; the widest line draws 30 of them. */
export const HISTORY_MAX_POINTS = 40;

/**
 * @param {number[]} points
 * @param {unknown} value
 * @param {number} maxPoints
 * @returns {number[]} `points` itself when nothing was added
 */
export function appendPoint(points, value, maxPoints = HISTORY_MAX_POINTS) {
  if (!Number.isFinite(value) || points.at(-1) === value) return points;
  return [...points, value].slice(-maxPoints);
}
