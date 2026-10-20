// Plan-limit arithmetic. The burn rate is the average since the window opened
// (used% / elapsed hours) and the projection extends it to the reset.

const MS_PER_HOUR = 3_600_000;

export const WINDOW_MS = Object.freeze({
  fiveHour: 5 * MS_PER_HOUR,
  sevenDay: 7 * 24 * MS_PER_HOUR,
});

/** Below this much elapsed time a rate is noise (a window that just reset). */
export const MIN_ELAPSED_MS = 15 * 60_000;

/**
 * @typedef {{ percentUsed: number, resetsAtMs: number | null }} LimitReading
 * @typedef {{ percentUsed: number, remainingMs: number | null,
 *             ratePerHour: number | null, projectedPercent: number | null }} LimitAnalysis
 */

/**
 * @param {LimitReading | null} reading
 * @param {number} windowMs length of the window this reading belongs to
 * @param {number} nowMs
 * @returns {LimitAnalysis | null} null when there is no usable usage figure
 */
export function analyzeLimit(reading, windowMs, nowMs) {
  if (!reading || !Number.isFinite(reading.percentUsed)) return null;
  const { percentUsed, resetsAtMs } = reading;
  if (!Number.isFinite(resetsAtMs)) {
    return { percentUsed, remainingMs: null, ratePerHour: null, projectedPercent: null };
  }
  const remainingMs = Math.max(0, resetsAtMs - nowMs);
  const elapsedMs = windowMs - remainingMs;
  if (elapsedMs < MIN_ELAPSED_MS) {
    return { percentUsed, remainingMs, ratePerHour: null, projectedPercent: null };
  }
  const ratePerHour = percentUsed / (elapsedMs / MS_PER_HOUR);
  const projectedPercent = percentUsed + ratePerHour * (remainingMs / MS_PER_HOUR);
  return { percentUsed, remainingMs, ratePerHour, projectedPercent };
}

const tokens = (value) => (Number.isFinite(value) && value > 0 ? value : 0);

/**
 * Share of input tokens served from the prompt cache, 0–1; null when nothing was counted.
 * @param {{ inputTokens?: number, cacheCreationTokens?: number, cacheReadTokens?: number } | null} usage
 */
export function cacheHitRatio(usage) {
  if (!usage) return null;
  const read = tokens(usage.cacheReadTokens);
  const total = tokens(usage.inputTokens) + tokens(usage.cacheCreationTokens) + read;
  return total > 0 ? read / total : null;
}
