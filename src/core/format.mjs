// Number → short label formatting shared by every renderer. Pure: no I/O, no clock.

export const DASH = '—';

const MS_PER_SECOND = 1000;
const SECONDS_PER_MINUTE = 60;
const MINUTES_PER_HOUR = 60;

/** Duration as `42s`, `50m` or `5h40m` (hours never roll into days, minutes zero-padded). */
export function formatDuration(ms) {
  if (!Number.isFinite(ms) || ms < 0) return DASH;
  const totalSeconds = Math.floor(ms / MS_PER_SECOND);
  if (totalSeconds < SECONDS_PER_MINUTE) return `${totalSeconds}s`;
  const totalMinutes = Math.floor(totalSeconds / SECONDS_PER_MINUTE);
  if (totalMinutes < MINUTES_PER_HOUR) return `${totalMinutes}m`;
  const hours = Math.floor(totalMinutes / MINUTES_PER_HOUR);
  const minutes = String(totalMinutes % MINUTES_PER_HOUR).padStart(2, '0');
  return `${hours}h${minutes}m`;
}

/** Token count as `950`, `543k` or `1.0M`. */
export function formatTokens(count) {
  if (!Number.isFinite(count) || count < 0) return DASH;
  if (count < 1000) return String(Math.round(count));
  const thousands = Math.round(count / 1000);
  if (thousands < 1000) return `${thousands}k`;
  return `${(count / 1_000_000).toFixed(1)}M`;
}

/** US dollars with two decimals: `$20.33`. */
export function formatUsd(amount) {
  if (!Number.isFinite(amount) || amount < 0) return DASH;
  return `$${amount.toFixed(2)}`;
}

/** Whole percent: `54%`. */
export function formatPercent(percent) {
  return Number.isFinite(percent) ? `${Math.round(percent)}%` : DASH;
}

/** Percent per hour with one decimal: `14.4%/h`. */
export function formatRate(percentPerHour) {
  return Number.isFinite(percentPerHour) ? `${percentPerHour.toFixed(1)}%/h` : DASH;
}
