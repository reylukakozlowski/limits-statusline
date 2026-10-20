// Snapshot → five lines of tone-tagged segments. The single place that decides what the
// status line says; renderers only decide how a tone looks.

import {
  DASH, formatClock, formatCountdown, formatDuration, formatPercent, formatRate, formatTokens, formatUsd,
} from './format.mjs';
import { BAR_CELLS, brailleLine, normalizeSeries, progressBar } from './glyphs.mjs';
import { LIMIT_WINDOWS } from './limit-windows.mjs';
import { analyzeLimit } from './metrics.mjs';
import { cacheTimeLeftMs } from './prompt-cache.mjs';
import { TONE, cacheTone, contextTone, limitTone } from './thresholds.mjs';

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
 *   durationMs: number | null,
 *   cacheHitRatio: number | null,
 *   promptCache: import('./prompt-cache.mjs').PromptCache | null,
 *   effort: string | null,
 *   linesChanged: { added: number, removed: number } | null,
 *   context: { usedTokens: number | null, windowTokens: number | null, percent: number | null },
 *   contextHistory: number[],
 *   limits: { sevenDay: LimitReading | null, fiveHour: LimitReading | null },
 *   limitReadings: import('./limit-history.mjs').LimitReadings,
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
const PROJECTION_WIDTH = 4; // "117%"
const GAP = '  ';
const POINTS_PER_CHAR = 2;

// The 7-day pace reads per day, which is how a week's budget is planned.
const LIMIT_LINES = Object.freeze([
  Object.freeze({ label: '7d', kind: 'sevenDay', rateUnit: 'd' }),
  Object.freeze({ label: '5h', kind: 'fiveHour', rateUnit: 'h' }),
]);

// What the limit lines give up, in order, until they fit the width: first the reset's clock
// time, then the time to 100%. Both lines drop the same parts, so their columns stay aligned.
const LIMIT_DETAILS = Object.freeze([
  Object.freeze({ showClock: true, showLimitIn: true }),
  Object.freeze({ showClock: false, showLimitIn: true }),
  Object.freeze({ showClock: false, showLimitIn: false }),
]);

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
    sessionLine(snapshot),
    contextLine(snapshot, size),
    ...limitLines(snapshot, size, columns),
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

function sessionLine({ costUsd, durationMs, cacheHitRatio, promptCache, effort, linesChanged, nowMs }) {
  const items = [
    Number.isFinite(costUsd) && [segment(formatUsd(costUsd), TONE.cost)],
    Number.isFinite(durationMs) && [segment(formatDuration(durationMs), TONE.muted)],
    Number.isFinite(cacheHitRatio) && cacheSegments(cacheHitRatio, promptCache, nowMs),
    effort && [segment(effort, TONE.ok)],
    linesChangedSegments(linesChanged),
  ].filter(Boolean);
  if (items.length === 0) return [indent(), segment(DASH, TONE.muted)];
  return [indent(), ...items.flatMap((item, index) => (index === 0 ? item : [separator(' · '), ...item]))];
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

function limitLines(snapshot, size, columns) {
  const clock = { nowMs: snapshot.nowMs, timeZone: snapshot.timeZone ?? null };
  const limits = LIMIT_LINES.map(({ label, kind, rateUnit }) => {
    const reading = snapshot.limits?.[kind] ?? null;
    const analysis = analyzeLimit(reading, LIMIT_WINDOWS[kind], snapshot.nowMs, snapshot.limitReadings?.[kind] ?? []);
    const clockText = formatClock(reading?.resetsAtMs, clock);
    return { label, rateUnit, analysis, countdown: formatCountdown(analysis?.remainingMs), clockText: clockText === DASH ? null : clockText };
  });
  const draw = (details) => {
    const resets = resetColumn(limits.filter(({ analysis }) => analysis), details.showClock);
    return limits.map((limit) => limitLine(limit, { size, details, reset: resets.get(limit) }));
  };
  const fits = (lines) => !Number.isFinite(columns) || lines.every((line) => lineText(line).length <= columns);
  for (const details of LIMIT_DETAILS) {
    const lines = draw(details);
    if (fits(lines)) return lines;
  }
  return draw(LIMIT_DETAILS.at(-1));
}

// The reset column of each limit line: `3h50m`, or with the clock time `3h50m 18:10`; the
// countdowns and the clock times are each padded to the longest, so the columns after them line up.
function resetColumn(limits, showClock) {
  const widest = (texts) => Math.max(0, ...texts.map((text) => text.length));
  const countdownWidth = widest(limits.map(({ countdown }) => countdown));
  const clockWidth = showClock ? widest(limits.map(({ clockText }) => clockText ?? '')) : 0;
  return new Map(limits.map((limit) => {
    const countdown = limit.countdown.padEnd(countdownWidth);
    return [limit, clockWidth > 0 ? `${countdown} ${(limit.clockText ?? '').padEnd(clockWidth)}` : countdown];
  }));
}

function limitLine({ label, rateUnit, analysis }, { size, details, reset }) {
  const labelSegment = segment(label.padEnd(LABEL_WIDTH), TONE.muted);
  if (!analysis) return [labelSegment, segment(DASH, TONE.muted)];
  const tone = limitTone(analysis);
  const hasProjection = Number.isFinite(analysis.projectedPercent);
  // The rate stays quiet while the pace is fine and takes the warning colour when it is not.
  const rateTone = Number.isFinite(analysis.ratePerHour) && tone !== TONE.ok ? tone : TONE.muted;
  return [
    labelSegment,
    ...barSegments(analysis.percentUsed, tone, size.barWidth),
    separator(' → '),
    segment(formatPercent(analysis.projectedPercent).padStart(PROJECTION_WIDTH), hasProjection ? tone : TONE.muted),
    segment(GAP),
    segment(`↻ ${reset}`, TONE.muted),
    segment(GAP),
    segment(`↗ ${formatRate(analysis.ratePerHour, rateUnit)}`, rateTone),
    ...(details.showLimitIn && analysis.limitInMs !== null
      ? [segment(GAP), segment(`⚠ 100% in ${formatCountdown(analysis.limitInMs)}`, TONE.alert)]
      : []),
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
