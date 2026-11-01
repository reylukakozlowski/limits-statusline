// The user's wall clock: what the clock of a named time zone shows, for the clock times on the
// limit lines (format.mjs) and the rules that follow the user's day rather than the plan's
// (night.mjs). The one place in the core that reads a zone's clock from Intl.

import { MS_PER_DAY, MS_PER_HOUR, MS_PER_MINUTE, MS_PER_SECOND } from './time.mjs';

/** @typedef {{ nowMs: number, timeZone: string | null }} Clock the moment, and the user's time zone */

const mod = (value, base) => ((value % base) + base) % base;

/**
 * What the 24-hour clock of `timeZone` shows at `atMs`, by Intl's part names (`hour`, `minute`,
 * `weekday`…), or null for an unknown time or zone.
 * @param {number} atMs @param {string | null | undefined} timeZone
 * @param {Intl.DateTimeFormatOptions} fields the parts to show, e.g. `{ hour: '2-digit' }`
 * @returns {Record<string, string> | null}
 */
export function clockParts(atMs, timeZone, fields) {
  if (!Number.isFinite(atMs) || typeof timeZone !== 'string') return null;
  try {
    const parts = new Intl.DateTimeFormat('en-GB', { timeZone, hourCycle: 'h23', ...fields }).formatToParts(atMs);
    return Object.fromEntries(parts.map(({ type, value }) => [type, value]));
  } catch {
    return null; // an unknown zone name, or a time beyond the dates Intl can show
  }
}

/**
 * The time of day on the clock of `timeZone`: milliseconds since local midnight, or null for an
 * unknown time or zone.
 * @param {number} atMs @param {string | null | undefined} timeZone
 * @returns {number | null}
 */
export function timeOfDayMs(atMs, timeZone) {
  const parts = clockParts(atMs, timeZone, { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  if (!parts) return null;
  // Today's zone offsets are whole minutes, so the milliseconds are the same on every clock.
  return Number(parts.hour) * MS_PER_HOUR + Number(parts.minute) * MS_PER_MINUTE
    + Number(parts.second) * MS_PER_SECOND + mod(atMs, MS_PER_SECOND);
}

/**
 * The last moment before `beforeMs` at which the clock of `timeZone` showed the time of day
 * `timeOfDay`, or null for an unknown time or zone. Where the clock jumped over that time
 * (spring), the moment of the jump. The offset at `beforeMs` gives a first guess, corrected once
 * for a daylight-saving change between the two.
 * @param {number} beforeMs @param {number} timeOfDay milliseconds since midnight
 * @param {string | null | undefined} timeZone
 * @returns {number | null}
 */
export function lastTimeOfDayBefore(beforeMs, timeOfDay, timeZone) {
  const beforeTimeOfDay = timeOfDayMs(beforeMs, timeZone);
  if (beforeTimeOfDay === null) return null;
  const guess = beforeMs - (mod(beforeTimeOfDay - timeOfDay - 1, MS_PER_DAY) + 1); // 1 ms to a whole day earlier
  const atMs = guess - clockDrift(timeOfDayMs(guess, timeZone), timeOfDay);
  return atMs < beforeMs ? atMs : atMs - MS_PER_DAY;
}

// How far the clock at the guess is off the wanted time of day, folded into half a day either way.
function clockDrift(shown, wanted) {
  return mod(shown - wanted + MS_PER_DAY / 2, MS_PER_DAY) - MS_PER_DAY / 2;
}
