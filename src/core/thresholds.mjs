// Semantic tones. Renderers map them to ANSI codes (terminal) or theme colours (desktop).

import { MS_PER_MINUTE } from './time.mjs';

export const TONE = Object.freeze({
  plain: 'plain',
  muted: 'muted',
  accent: 'accent',
  model: 'model',
  ok: 'ok',
  warn: 'warn',
  alert: 'alert',
  cost: 'cost',
  spark: 'spark',
  added: 'added',
  removed: 'removed',
});

const LIMIT_WARN_AT = 80;
const LIMIT_ALERT_ABOVE = 100;
const CONTEXT_WARN_AT = 50;
const CONTEXT_ALERT_ABOVE = 80;
const CACHE_WARN_WITHIN_MS = 5 * MS_PER_MINUTE;

/** Tone of a plan limit, judged by where it is heading (projection), else where it is. */
export function limitTone({ percentUsed, projectedPercent }) {
  if (Number.isFinite(percentUsed) && percentUsed >= LIMIT_ALERT_ABOVE) return TONE.alert;
  const value = Number.isFinite(projectedPercent) ? projectedPercent : percentUsed;
  if (!Number.isFinite(value)) return TONE.muted;
  if (value > LIMIT_ALERT_ABOVE) return TONE.alert;
  return value >= LIMIT_WARN_AT ? TONE.warn : TONE.ok;
}

/** Tone of the context-window fill. */
export function contextTone(percent) {
  if (!Number.isFinite(percent)) return TONE.muted;
  if (percent > CONTEXT_ALERT_ABOVE) return TONE.alert;
  return percent >= CONTEXT_WARN_AT ? TONE.warn : TONE.ok;
}

/** Tone of the prompt cache's time left: a warning in its last five minutes. */
export function cacheTone(leftMs) {
  return Number.isFinite(leftMs) && leftMs > 0 && leftMs <= CACHE_WARN_WITHIN_MS ? TONE.warn : TONE.muted;
}
