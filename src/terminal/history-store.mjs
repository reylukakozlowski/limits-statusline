// Per-session context-fill history for the sparkline: one small JSON array per session id.

import fs from 'node:fs';
import { join } from 'node:path';
import { HISTORY_MAX_POINTS, appendPoint } from '../core/history.mjs';
import { writeAtomic } from './atomic-file.mjs';

export const HISTORY_MAX_AGE_MS = 7 * 24 * 3_600_000;

// Session ids are UUIDs; anything else could escape the folder, so it gets no history.
const SAFE_SESSION_ID = /^[A-Za-z0-9_-]{1,128}$/;

/**
 * Records `percent` when it differs from the last point and returns the newest points.
 * Returns [] when the id is unsafe or the folder cannot be used; never throws.
 * @param {string} dir
 * @param {unknown} sessionId
 * @param {unknown} percent
 * @param {{ maxPoints?: number, nowMs?: number }} [options]
 * @returns {number[]}
 */
export function recordContext(dir, sessionId, percent, { maxPoints = HISTORY_MAX_POINTS, nowMs = Date.now() } = {}) {
  if (typeof dir !== 'string' || dir === '' || typeof sessionId !== 'string' || !SAFE_SESSION_ID.test(sessionId)) {
    return [];
  }
  try {
    const file = join(dir, `${sessionId}.json`);
    const stored = readPoints(file);
    if (stored === null) {
      fs.mkdirSync(dir, { recursive: true });
      pruneOldFiles(dir, nowMs);
    }
    const points = stored ?? [];
    const next = appendPoint(points, percent, maxPoints);
    if (next === points) return points.slice(-maxPoints);
    writeAtomic(file, JSON.stringify(next));
    return next;
  } catch {
    return [];
  }
}

/** @returns {number[] | null} null when there is no file yet; [] when it is unreadable */
function readPoints(file) {
  if (!fs.existsSync(file)) return null;
  try {
    const value = JSON.parse(fs.readFileSync(file, 'utf8'));
    return Array.isArray(value) ? value.filter(Number.isFinite) : [];
  } catch {
    return [];
  }
}

function pruneOldFiles(dir, nowMs) {
  for (const name of fs.readdirSync(dir)) {
    const path = join(dir, name);
    try {
      if (nowMs - fs.statSync(path).mtimeMs > HISTORY_MAX_AGE_MS) fs.unlinkSync(path);
    } catch {
      // Another session may be pruning the same folder; a file it removed first is fine.
    }
  }
}
