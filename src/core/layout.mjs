// Snapshot → five lines of tone-tagged segments. The single place that decides what the
// status line says; renderers only decide how a tone looks.

import { DASH, formatDuration, formatPercent, formatRate, formatTokens, formatUsd } from './format.mjs';
import { BAR_CELLS, brailleLine, normalizeSeries, progressBar } from './glyphs.mjs';
import { WINDOW_MS, analyzeLimit } from './metrics.mjs';
import { TONE, contextTone, limitTone } from './thresholds.mjs';

/**
 * The contract both adapters fill. Unknown values are null, never undefined.
 * @typedef {import('./metrics.mjs').LimitReading} LimitReading
 * @typedef {{
 *   nowMs: number,
 *   project: string | null,
 *   git: import('./git-status.mjs').GitState | null,
 *   modelName: string | null,
 *   costUsd: number | null,
 *   durationMs: number | null,
 *   cacheHitRatio: number | null,
 *   effort: string | null,
 *   context: { usedTokens: number | null, windowTokens: number | null, percent: number | null },
 *   contextHistory: number[],
 *   limits: { sevenDay: LimitReading | null, fiveHour: LimitReading | null },
 * }} Snapshot
 * A segment that draws a line chart also carries its points (`series`, 0–1, oldest first), so a
 * surface that can draw vector graphics draws the line instead of the braille `text`.
 * @typedef {{ text: string, tone: string, series?: number[] }} Segment
 * @typedef {Segment[]} Line
 */

const LINE_CHARS = 15; // the mockup's line spans 15 characters
const WIDE = Object.freeze({ barWidth: BAR_CELLS, lineChars: LINE_CHARS });
const NARROW = Object.freeze({ barWidth: 10, lineChars: 0 });
const FULL_LINE_COLUMNS = 52; // "ctx " + 16 cells + " 54%" + "  543k/1.0M" + "  " + 15-char line
const LABEL_WIDTH = 4; // "ctx ", "7d  ", "5h  "; the session line is indented to match
const PERCENT_WIDTH = 3;
const COUNTDOWN_WIDTH = 6; // "76h10m"
const GAP = '  ';
const POINTS_PER_CHAR = 2;

const segment = (text, tone = TONE.plain) => ({ text, tone });
const separator = (text) => segment(text, TONE.muted);
const indent = () => segment(' '.repeat(LABEL_WIDTH));

/** @param {Line} line */
export const lineText = (line) => line.map((part) => part.text).join('');

/**
 * @param {Snapshot} snapshot
 * @param {{ columns?: number }} options terminal or band width in cells
 * @returns {Line[]}
 */
export function buildLines(snapshot, { columns } = {}) {
  const size = Number.isFinite(columns) && columns < FULL_LINE_COLUMNS ? NARROW : WIDE;
  return [
    headerLine(snapshot),
    contextLine(snapshot, size),
    sessionLine(snapshot),
    limitLine('7d', analyzeLimit(snapshot.limits?.sevenDay ?? null, WINDOW_MS.sevenDay, snapshot.nowMs), size),
    limitLine('5h', analyzeLimit(snapshot.limits?.fiveHour ?? null, WINDOW_MS.fiveHour, snapshot.nowMs), size),
  ];
}

function headerLine({ project, git, modelName }) {
  return [
    segment(project ?? DASH, TONE.accent),
    separator(' | '),
    gitSegment(git),
    separator(' | '),
    segment(`✦ ${modelName ?? DASH}`, TONE.model),
  ];
}

function gitSegment(git) {
  if (!git?.isRepo) return segment('no git', TONE.muted);
  return segment(`git ${git.branch ?? DASH}${git.isDirty ? '*' : ''}`);
}

function contextLine({ context, contextHistory }, size) {
  const tone = contextTone(context?.percent);
  const series = normalizeSeries(contextHistory, size.lineChars * POINTS_PER_CHAR);
  const chart = brailleLine(series, size.lineChars);
  return [
    segment('ctx'.padEnd(LABEL_WIDTH), TONE.muted),
    ...barSegments(context?.percent, tone, size.barWidth),
    segment(GAP),
    segment(`${formatTokens(context?.usedTokens)}/${formatTokens(context?.windowTokens)}`, TONE.muted),
    ...(chart ? [segment(GAP), { text: chart, tone: TONE.spark, series }] : []),
  ];
}

function sessionLine({ costUsd, durationMs, cacheHitRatio, effort }) {
  const items = [
    Number.isFinite(costUsd) && segment(formatUsd(costUsd), TONE.cost),
    Number.isFinite(durationMs) && segment(formatDuration(durationMs), TONE.muted),
    Number.isFinite(cacheHitRatio) && segment(`cache ${formatPercent(cacheHitRatio * 100)}`, TONE.muted),
    effort && segment(effort, TONE.ok),
  ].filter(Boolean);
  if (items.length === 0) return [indent(), segment(DASH, TONE.muted)];
  return [indent(), ...items.flatMap((item, index) => (index === 0 ? [item] : [separator(' · '), item]))];
}

function limitLine(label, analysis, size) {
  const labelSegment = segment(label.padEnd(LABEL_WIDTH), TONE.muted);
  if (!analysis) return [labelSegment, segment(DASH, TONE.muted)];
  const tone = limitTone(analysis);
  // The rate stays quiet while the pace is fine and takes the warning colour when it is not.
  const rateTone = Number.isFinite(analysis.ratePerHour) && tone !== TONE.ok ? tone : TONE.muted;
  return [
    labelSegment,
    ...barSegments(analysis.percentUsed, tone, size.barWidth),
    segment(GAP),
    segment(`↻ ${formatDuration(analysis.remainingMs).padEnd(COUNTDOWN_WIDTH)}`, TONE.muted),
    segment(GAP),
    segment(`↗ ${formatRate(analysis.ratePerHour)}`, rateTone),
  ];
}

function barSegments(percent, tone, width) {
  const { filled, empty } = progressBar(percent, width);
  return [
    segment(filled, tone),
    segment(empty, TONE.muted),
    segment(' '),
    segment(formatPercent(percent).padStart(PERCENT_WIDTH), tone),
  ];
}
