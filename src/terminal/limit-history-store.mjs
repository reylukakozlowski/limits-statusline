// The shared limit history (core/limit-history.mjs) as a file for the terminal status line.
// Never throws: a file that cannot be read or written leaves this run with what it has.

import fs from 'node:fs';
import { dirname } from 'node:path';
import {
  EMPTY_LIMIT_HISTORY, UNREADABLE_GRACE_MS, readLimitHistory, recordLimits, serializeLimitHistory,
} from '../core/limit-history.mjs';
import { writeAtomic } from './atomic-file.mjs';

/**
 * Adds the session's changed readings to the file and returns the readings to draw from.
 * @param {string} file
 * @param {{ sessionId: unknown, limits: Parameters<typeof recordLimits>[1]['limits'], nowMs: number }} update
 * @returns {import('../core/limit-history.mjs').LimitReadings}
 */
export function recordLimitHistory(file, update) {
  const { history, isReplaceable } = readHistory(file, update.nowMs);
  const next = recordLimits(history, update);
  if (next !== history && isReplaceable) {
    try {
      fs.mkdirSync(dirname(file), { recursive: true });
      writeAtomic(file, serializeLimitHistory(next));
    } catch {
      // Another run will try again; this one still draws with its own new readings.
    }
  }
  return next.readings;
}

/**
 * When the session last wrote its transcript, which is when its last response (and with it the
 * plan figures) arrived; null when the transcript cannot be read.
 * @param {unknown} transcriptPath
 * @returns {number | null}
 */
export function transcriptWrittenAtMs(transcriptPath) {
  if (typeof transcriptPath !== 'string' || transcriptPath === '') return null;
  try {
    return fs.statSync(transcriptPath).mtimeMs;
  } catch {
    return null;
  }
}

// The history and whether this run may write the file. A file that is there and cannot be used
// (another session is writing it, or something holds it) is left alone: this run draws with its
// own readings and the next one reads again. Only one that stayed unreadable is replaced.
function readHistory(file, nowMs) {
  let text;
  try {
    text = fs.readFileSync(file, 'utf8');
  } catch (error) {
    return { history: EMPTY_LIMIT_HISTORY, isReplaceable: error?.code === 'ENOENT' };
  }
  const history = readLimitHistory(text);
  if (history) return { history, isReplaceable: true };
  return { history: EMPTY_LIMIT_HISTORY, isReplaceable: nowMs - writtenAtMs(file) >= UNREADABLE_GRACE_MS };
}

/** When the file was last written; now-like (never replaceable) when that cannot be told. */
function writtenAtMs(file) {
  try {
    return fs.statSync(file).mtimeMs;
  } catch {
    return Infinity;
  }
}
