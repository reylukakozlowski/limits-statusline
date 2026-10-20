// The shared record of plan-limit readings behind the recent pace: every session and both
// surfaces add to one file, so a new session knows the pace at once and the 7-day pace can look
// back a whole day. Pure: the adapters read and write the file.
//
// A session adds a reading only when its own figure changed. A change comes with a new response,
// so it is stamped now. A figure the session reports for the first time may be old (a session
// left open before the history existed, or forgotten since), so it is stamped with the
// session's last response: stamping it "now" would put an old figure after newer ones.

import { LIMIT_KINDS, LIMIT_WINDOWS, retentionMs } from './limit-windows.mjs';
import { MS_PER_MINUTE } from './time.mjs';

export const LIMIT_HISTORY_VERSION = 1;

/** How long readings of each kind are kept. */
export const HISTORY_RETENTION_MS = Object.freeze(Object.fromEntries(
  LIMIT_KINDS.map((kind) => [kind, retentionMs(LIMIT_WINDOWS[kind])]),
));

/** Sessions whose last figures are remembered; the least recently seen fall off first. */
export const MAX_SESSIONS = 64;

/** Reset times this close together name the same window (the API may round them). */
export const SAME_WINDOW_TOLERANCE_MS = 10 * MS_PER_MINUTE;

/**
 * @typedef {[atMs: number, percentUsed: number, resetsAtMs: number]} LimitPoint
 * @typedef {{ fiveHour: LimitPoint[], sevenDay: LimitPoint[] }} LimitReadings
 * @typedef {[percentUsed: number, resetsAtMs: number]} SeenFigure
 * @typedef {{ atMs: number, fiveHour: SeenFigure | null, sevenDay: SeenFigure | null }} SessionSeen
 * @typedef {{ readings: LimitReadings, sessions: Record<string, SessionSeen> }} LimitHistory
 * @typedef {{ fiveHour: import('./metrics.mjs').LimitReading | null,
 *             sevenDay: import('./metrics.mjs').LimitReading | null }} Limits
 */

/** @type {LimitHistory} */
export const EMPTY_LIMIT_HISTORY = Object.freeze({
  readings: Object.freeze({ fiveHour: Object.freeze([]), sevenDay: Object.freeze([]) }),
  sessions: Object.freeze({}),
});

/** @param {number} a @param {number} b reset times */
export const isSameWindow = (a, b) => Math.abs(a - b) <= SAME_WINDOW_TOLERANCE_MS;

const isPercent = (value) => Number.isFinite(value) && value >= 0;
const isUsableReading = (reading) => isPercent(reading?.percentUsed) && Number.isFinite(reading?.resetsAtMs);

/**
 * Adds the session's readings that differ from what it reported last, prunes what is too old.
 * @param {LimitHistory} history
 * @param {{ sessionId: unknown, limits: Limits | null, nowMs: number, lastResponseAtMs?: number | null }} update
 *   `lastResponseAtMs`: when the session's last response arrived, if known; it stamps figures the
 *   session reports for the first time
 * @returns {LimitHistory} `history` itself when nothing was added
 */
export function recordLimits(history, { sessionId, limits, nowMs, lastResponseAtMs = null }) {
  if (typeof sessionId !== 'string' || sessionId === '' || !limits) return history;
  const seen = history.sessions[sessionId];
  const changed = LIMIT_KINDS.filter((kind) => isUsableReading(limits[kind]) && !isSameFigure(seen?.[kind], limits[kind]));
  if (changed.length === 0) return history;

  const firstSeenAtMs = Number.isFinite(lastResponseAtMs) ? Math.min(lastResponseAtMs, nowMs) : nowMs;
  const readings = { ...history.readings };
  const figures = { fiveHour: seen?.fiveHour ?? null, sevenDay: seen?.sevenDay ?? null };
  for (const kind of changed) {
    const { percentUsed, resetsAtMs } = limits[kind];
    const atMs = figures[kind] ? nowMs : firstSeenAtMs;
    readings[kind] = prune(withPoint(readings[kind], [atMs, percentUsed, resetsAtMs], kind), kind, nowMs);
    figures[kind] = [percentUsed, resetsAtMs];
  }
  const sessions = keepRecentSessions({ ...history.sessions, [sessionId]: { atMs: nowMs, ...figures } }, nowMs);
  return { readings, sessions };
}

function isSameFigure(figure, reading) {
  return Array.isArray(figure) && figure[0] === reading.percentUsed && isSameWindow(figure[1], reading.resetsAtMs);
}

// Fixed buckets rather than "close to the last point", which would slide along a busy session
// and keep a single point forever. A late point (stamped before the newest) is simply added.
function withPoint(points, point, kind) {
  const last = points.at(-1);
  const bucket = (atMs) => Math.floor(atMs / LIMIT_WINDOWS[kind].bucketMs);
  const isSameBucket = last !== undefined && point[0] >= last[0] && bucket(point[0]) === bucket(last[0])
    && isSameWindow(last[2], point[2]);
  return isSameBucket ? [...points.slice(0, -1), point] : [...points, point];
}

// Drops readings older than the retention but the newest of them: after a pause longer than the
// retention the pace still needs a reading from before its look-back to read the start off.
function prune(points, kind, nowMs) {
  const cutoffMs = nowMs - HISTORY_RETENTION_MS[kind];
  const baseline = points
    .filter(([atMs]) => atMs < cutoffMs)
    .reduce((newest, point) => (!newest || point[0] > newest[0] ? point : newest), null);
  return points.filter((point) => point[0] >= cutoffMs || point === baseline);
}

function keepRecentSessions(sessions, nowMs) {
  const maxAgeMs = Math.max(...Object.values(HISTORY_RETENTION_MS));
  const recent = Object.entries(sessions)
    .filter(([, session]) => nowMs - session.atMs <= maxAgeMs)
    .sort(([, a], [, b]) => b.atMs - a.atMs)
    .slice(0, MAX_SESSIONS);
  return Object.fromEntries(recent);
}

/** @param {LimitHistory} history @returns {string} */
export function serializeLimitHistory(history) {
  return JSON.stringify({ version: LIMIT_HISTORY_VERSION, ...history });
}

/**
 * Reads the file's text back; anything unreadable, of another version or malformed is dropped,
 * entry by entry, so one bad line never costs the rest.
 * @param {unknown} text
 * @returns {LimitHistory}
 */
export function parseLimitHistory(text) {
  let data;
  try {
    data = JSON.parse(typeof text === 'string' ? text : '');
  } catch {
    return EMPTY_LIMIT_HISTORY;
  }
  if (data === null || typeof data !== 'object' || data.version !== LIMIT_HISTORY_VERSION) return EMPTY_LIMIT_HISTORY;
  const readings = Object.fromEntries(LIMIT_KINDS.map((kind) => [kind, validPoints(data.readings?.[kind])]));
  const sessions = Object.fromEntries(Object.entries(data.sessions ?? {})
    .filter(([, session]) => isSession(session))
    .map(([id, { atMs, fiveHour = null, sevenDay = null }]) => [id, { atMs, fiveHour, sevenDay }]));
  return { readings, sessions };
}

const isPoint = (point) => Array.isArray(point) && point.length === 3
  && Number.isFinite(point[0]) && isPercent(point[1]) && Number.isFinite(point[2]);
const validPoints = (points) => (Array.isArray(points) ? points.filter(isPoint) : []);

const isFigure = (figure) => figure === null
  || (Array.isArray(figure) && figure.length === 2 && isPercent(figure[0]) && Number.isFinite(figure[1]));
const isSession = (session) => session !== null && typeof session === 'object'
  && Number.isFinite(session.atMs) && LIMIT_KINDS.every((kind) => isFigure(session[kind] ?? null));
