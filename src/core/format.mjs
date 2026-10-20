// Number → short label formatting shared by every renderer. Pure: no I/O, no clock.

import { MS_PER_DAY, MS_PER_HOUR, MS_PER_SECOND } from './time.mjs';

export const DASH = '—';

const SECONDS_PER_MINUTE = 60;
const MINUTES_PER_HOUR = 60;
const HOURS_PER_DAY = 24;

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

/** Time to a reset: `3h50m` under a day, `6d17h` from a day on. */
export function formatCountdown(ms) {
  if (!Number.isFinite(ms) || ms < 0) return DASH;
  const totalHours = Math.floor(ms / MS_PER_HOUR);
  if (totalHours < HOURS_PER_DAY) return formatDuration(ms);
  const hours = String(totalHours % HOURS_PER_DAY).padStart(2, '0');
  return `${Math.floor(totalHours / HOURS_PER_DAY)}d${hours}h`;
}

/** Percent per hour with one decimal: `14.4%/h`. */
export function formatRate(percentPerHour) {
  return Number.isFinite(percentPerHour) ? `${percentPerHour.toFixed(1)}%/h` : DASH;
}

/**
 * Wall-clock time of a moment in `timeZone`, 24-hour: `18:10` within a day of now, else with
 * the weekday, `Tue 08:10`. A dash for an unknown time or zone.
 * @param {number} atMs @param {{ nowMs: number, timeZone: string | null }} context
 */
export function formatClock(atMs, { nowMs, timeZone }) {
  if (!Number.isFinite(atMs) || !Number.isFinite(nowMs) || typeof timeZone !== 'string') return DASH;
  const withDay = atMs - nowMs >= MS_PER_DAY;
  try {
    const parts = new Intl.DateTimeFormat('en-GB', {
      timeZone, hour: '2-digit', minute: '2-digit', hourCycle: 'h23', ...(withDay ? { weekday: 'short' } : {}),
    }).formatToParts(atMs);
    const part = (type) => parts.find((candidate) => candidate.type === type)?.value;
    const time = `${part('hour')}:${part('minute')}`;
    return withDay ? `${part('weekday')} ${time}` : time;
  } catch {
    return DASH; // an unknown zone name
  }
}
