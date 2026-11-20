// Snapshot → lines of tone-tagged segments: the header, the session and the context, then a line
// for each limit the account has (layout-limits.mjs). The single place that decides what the
// status line says; renderers only decide how a tone looks.

import { DASH, formatDuration, formatPercent, formatTokens, formatUsd } from './format.mjs';
import { BAR_CELLS, brailleLine, normalizeSeries } from './glyphs.mjs';
import { headerLine } from './layout-header.mjs';
import { planLimitLines, spendLimitLines } from './layout-limits.mjs';
import { GAP, LABEL_WIDTH, barSegments, label, segment, separator } from './layout-segments.mjs';
import { cacheTimeLeftMs } from './prompt-cache.mjs';
import { TONE, cacheTone, contextTone } from './thresholds.mjs';

export { lineText } from './layout-segments.mjs';

/**
 * The contract both adapters fill. Unknown values are null, never undefined.
 * @typedef {import('./metrics.mjs').LimitReading} LimitReading
 * @typedef {{
 *   nowMs: number,
 *   timeZone: string | null,
 *   project: string | null,
 *   git: import('./git-status.mjs').GitState | null,
 *   modelName: string | null,
 *   costUsd: number | null,
 *   modelTimeMs: number | null,
 *   cacheHitRatio: number | null,
 *   promptCache: import('./prompt-cache.mjs').PromptCache | null,
 *   effort: string | null,
 *   fastMode: boolean | null,
 *   linesChanged: { added: number, removed: number } | null,
 *   context: { usedTokens: number | null, windowTokens: number | null, percent: number | null },
 *   contextHistory: number[],
 *   limits: { sevenDay: LimitReading | null, fiveHour: LimitReading | null },
 *   limitHistory: Pick<import('./limit-history.mjs').LimitHistory, 'readings' | 'seenAtMs'>,
 *   spendLimit: import('./metrics.mjs').SpendLimit | null,
 * }} Snapshot
 * `modelTimeMs`: how long the session waited for the model's responses, not how long it has been
 * open; `limits`: the session's own figures; `limitHistory`: what every session reported, for the
 * pace and for which windows the account has.
 * @typedef {import('./layout-segments.mjs').Segment} Segment
 * @typedef {import('./layout-segments.mjs').Line} Line
 */

const LINE_CHARS = 15; // the mockup's line spans 15 characters
const WIDE = Object.freeze({ barWidth: BAR_CELLS, lineChars: LINE_CHARS });
const NARROW = Object.freeze({ barWidth: 10, lineChars: 0 });
const FULL_LINE_COLUMNS = 52; // "ctx " + 16 cells + " 54%" + "  543k/1.0M" + "  " + 15-char line
const POINTS_PER_CHAR = 2;

/**
 * @param {Snapshot} snapshot
 * @param {{ columns?: number }} options terminal or band width in cells; anything but a positive
 *   number is an unknown width (an unset or empty COLUMNS), which draws everything
 * @returns {Line[]}
 */
export function buildLines(snapshot, { columns } = {}) {
  const width = Number.isFinite(columns) && columns > 0 ? columns : null;
  const size = width !== null && width < FULL_LINE_COLUMNS ? NARROW : WIDE;
  return [
    headerLine(snapshot, width),
    sessionLine(snapshot),
    contextLine(snapshot, size),
    ...planLimitLines(snapshot, size, width),
    ...spendLimitLines(snapshot, size, width),
  ];
}

function contextLine({ context, contextHistory }, size) {
  const tone = contextTone(context?.percent);
  const series = normalizeSeries(contextHistory, size.lineChars * POINTS_PER_CHAR);
  const chart = brailleLine(series, size.lineChars);
  return [
    label('ctx'),
    ...barSegments(context?.percent, tone, size.barWidth),
    segment(GAP),
    segment(`${formatTokens(context?.usedTokens)}/${formatTokens(context?.windowTokens)}`, TONE.muted),
    ...(chart ? [segment(GAP), { text: chart, tone: TONE.spark, series }] : []),
  ];
}

function sessionLine({ costUsd, modelTimeMs, cacheHitRatio, promptCache, effort, fastMode, linesChanged, nowMs }) {
  const indent = segment(' '.repeat(LABEL_WIDTH));
  const items = [
    Number.isFinite(costUsd) && [segment(formatUsd(costUsd), TONE.cost)],
    Number.isFinite(modelTimeMs) && [segment(formatDuration(modelTimeMs), TONE.muted)],
    Number.isFinite(cacheHitRatio) && cacheSegments(cacheHitRatio, promptCache, nowMs),
    effort && [segment(effort, TONE.ok)],
    fastMode === true && [segment('fast', TONE.warn)],
    linesChangedSegments(linesChanged),
  ].filter(Boolean);
  if (items.length === 0) return [indent, segment(DASH, TONE.muted)];
  return [indent, ...items.flatMap((item, index) => (index === 0 ? item : [separator(' · '), ...item]))];
}

// `cache 99%`, then how long the cache stays warm (`52m`) or that it went cold.
function cacheSegments(ratio, promptCache, nowMs) {
  const ratioSegment = segment(`cache ${formatPercent(ratio * 100)}`, TONE.muted);
  const leftMs = cacheTimeLeftMs(promptCache, nowMs);
  if (leftMs === null) return [ratioSegment];
  return [ratioSegment, segment(leftMs > 0 ? ` ${formatDuration(leftMs)}` : ' cold', cacheTone(leftMs))];
}

function linesChangedSegments(linesChanged) {
  const { added = 0, removed = 0 } = linesChanged ?? {};
  if (!(added + removed > 0)) return null;
  return [segment(`+${added}`, TONE.added), segment(` -${removed}`, TONE.removed)];
}
