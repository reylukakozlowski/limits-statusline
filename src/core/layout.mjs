// Snapshot → lines of tone-tagged segments: the header, the session and the context, then a line
// for each limit the account has (the 7-day and the 5-hour plan windows, a gateway's spend limit). The single place that decides what the
// status line says; renderers only decide how a tone looks.

import {
  DASH, formatClock, formatCountdown, formatDuration, formatPercent, formatRate, formatTokens, formatUsd,
} from './format.mjs';
import { BAR_CELLS, brailleLine, normalizeSeries, progressBar } from './glyphs.mjs';
import { wasSeenLately } from './limit-history.mjs';
import { LIMIT_WINDOWS } from './limit-windows.mjs';
import { analyzeLimit } from './metrics.mjs';
import { cacheTimeLeftMs } from './prompt-cache.mjs';
import { TONE, cacheTone, contextTone, limitTone } from './thresholds.mjs';

/**
 * The contract both adapters fill. Unknown values are null, never undefined.
 * @typedef {import('./metrics.mjs').LimitReading} LimitReading
 * @typedef {{ percentUsed: number, resetsAtMs: number | null, usedUsd: number | null, limitUsd: number | null }} SpendLimit
 *   a Claude apps gateway's spend limit: the share used (past 100 once exceeded), and the amounts when sent
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
 *   fastMode: boolean | null,
 *   linesChanged: { added: number, removed: number } | null,
 *   context: { usedTokens: number | null, windowTokens: number | null, percent: number | null },
 *   contextHistory: number[],
 *   limits: { sevenDay: LimitReading | null, fiveHour: LimitReading | null },
 *   limitReadings: import('./limit-history.mjs').LimitReadings,
 *   limitsSeenAtMs: import('./limit-history.mjs').LimitSeen,
 *   spendLimit: SpendLimit | null,
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
const PERCENT_WIDTH = 3; // "54%"; a limit at "100%" widens the column on both limit lines
const PROJECTION_WIDTH = 4; // "117%"
const PROJECTION_CAP = 999; // beyond it the figure says nothing more: ">999%"
const GAP = '  ';
const ELLIPSIS = '…';
const SHORTEST_NAME = 8; // a branch or project is cut no shorter than this, the ellipsis included
const POINTS_PER_CHAR = 2;

const LIMIT_LINES = Object.freeze([
  Object.freeze({ label: '7d', kind: 'sevenDay' }),
  Object.freeze({ label: '5h', kind: 'fiveHour' }),
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
const widest = (texts, least = 0) => Math.max(least, ...texts.map((text) => text.length));

/** @param {Line} line */
export const lineText = (line) => line.map((part) => part.text).join('');

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
    ...limitLines(snapshot, size, width),
    ...spendLimitLines(snapshot, size, width),
  ];
}

// The model comes last, and a surface cuts a line at its end. A header too wide for the surface
// gives up the start of the branch first (its end tells the branches of one project apart),
// then the end of the project.
function headerLine({ project, git, modelName }, width) {
  const draw = (projectName, branch) => [
    segment(projectName, TONE.accent),
    separator(' | '),
    gitSegment(git, branch),
    separator(' | '),
    segment(`✦ ${modelName ?? DASH}`, TONE.model),
  ];
  const names = { project: project ?? DASH, branch: git?.branch ?? DASH };
  const excess = () => (width === null ? 0 : lineText(draw(names.project, names.branch)).length - width);
  if (git?.isRepo) names.branch = shortened(names.branch, excess(), (text, length) => `${ELLIPSIS}${text.slice(-length)}`);
  names.project = shortened(names.project, excess(), (text, length) => `${text.slice(0, length)}${ELLIPSIS}`);
  return draw(names.project, names.branch);
}

/** `text` shorter by `excess` characters, as far as SHORTEST_NAME allows; `cut` keeps `length` of it. */
function shortened(text, excess, cut) {
  if (excess <= 0 || text.length <= SHORTEST_NAME) return text;
  return cut(text, Math.max(SHORTEST_NAME, text.length - excess) - ELLIPSIS.length);
}

function gitSegment(git, branch) {
  if (!git?.isRepo) return segment('no git', TONE.muted);
  return segment(`git ${branch}${git.isDirty ? '*' : ''}`);
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

function sessionLine({ costUsd, durationMs, cacheHitRatio, promptCache, effort, fastMode, linesChanged, nowMs }) {
  const items = [
    Number.isFinite(costUsd) && [segment(formatUsd(costUsd), TONE.cost)],
    Number.isFinite(durationMs) && [segment(formatDuration(durationMs), TONE.muted)],
    Number.isFinite(cacheHitRatio) && cacheSegments(cacheHitRatio, promptCache, nowMs),
    effort && [segment(effort, TONE.ok)],
    fastMode === true && [segment('fast', TONE.warn)],
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

function limitLines(snapshot, size, width) {
  const clock = { nowMs: snapshot.nowMs, timeZone: snapshot.timeZone ?? null };
  // A window without a figure keeps its line, as a dash, only while the account is known to have it.
  const hasLine = ({ kind }) => Boolean(snapshot.limits?.[kind]) || wasSeenLately(snapshot.limitsSeenAtMs?.[kind], snapshot.nowMs);
  const limits = LIMIT_LINES.filter(hasLine).map(({ label, kind }) => {
    const reading = snapshot.limits?.[kind] ?? null;
    const analysis = analyzeLimit(reading, LIMIT_WINDOWS[kind], clock, snapshot.limitReadings?.[kind] ?? []);
    const clockText = formatClock(reading?.resetsAtMs, clock);
    return {
      label,
      analysis,
      percentText: formatPercent(analysis?.percentUsed),
      projectionText: projectionText(analysis?.projectedPercent),
      countdown: formatCountdown(analysis?.remainingMs),
      clockText: clockText === DASH ? null : clockText,
    };
  });
  // Each column is as wide as its longest value on either line, so what follows it lines up.
  const drawn = limits.filter(({ analysis }) => analysis);
  const widths = {
    percent: widest(drawn.map(({ percentText }) => percentText), PERCENT_WIDTH),
    projection: widest(drawn.map((limit) => limit.projectionText), PROJECTION_WIDTH),
  };
  const draw = (details) => {
    const resets = resetColumn(drawn, details.showClock);
    return limits.map((limit) => limitLine(limit, { size, details, widths, reset: resets.get(limit) }));
  };
  const fits = (lines) => width === null || lines.every((line) => lineText(line).length <= width);
  for (const details of LIMIT_DETAILS) {
    const lines = draw(details);
    if (fits(lines)) return lines;
  }
  return draw(LIMIT_DETAILS.at(-1));
}

// The reset column of each limit line: `3h50m`, or with the clock time `3h50m 18:10`; the
// countdowns and the clock times are each padded to the longest, so the columns after them line up.
function resetColumn(limits, showClock) {
  const countdownWidth = widest(limits.map(({ countdown }) => countdown));
  const clockWidth = showClock ? widest(limits.map(({ clockText }) => clockText ?? '')) : 0;
  return new Map(limits.map((limit) => {
    const countdown = limit.countdown.padEnd(countdownWidth);
    return [limit, clockWidth > 0 ? `${countdown} ${(limit.clockText ?? '').padEnd(clockWidth)}` : countdown];
  }));
}

function limitLine({ label, analysis, projectionText: projection }, { size, details, widths, reset }) {
  const labelSegment = segment(label.padEnd(LABEL_WIDTH), TONE.muted);
  if (!analysis) return [labelSegment, segment(DASH, TONE.muted)];
  const tone = limitTone(analysis);
  const hasProjection = Number.isFinite(analysis.projectedPercent);
  // The rate stays quiet while the pace is fine and takes the warning colour when it is not.
  const rateTone = Number.isFinite(analysis.ratePerHour) && tone !== TONE.ok ? tone : TONE.muted;
  return [
    labelSegment,
    ...barSegments(analysis.percentUsed, tone, size.barWidth, widths.percent),
    separator(' → '),
    segment(projection.padStart(widths.projection), hasProjection ? tone : TONE.muted),
    segment(GAP),
    segment(`↻ ${reset}`, TONE.muted),
    segment(GAP),
    segment(`↗ ${formatRate(analysis.ratePerHour)}`, rateTone),
    ...(details.showLimitIn && analysis.limitInMs !== null
      ? [segment(GAP), segment(`⚠ 100% in ${formatCountdown(analysis.limitInMs)}`, TONE.alert)]
      : []),
  ];
}

// A gateway's spend limit: no pace or projection, since the length of its period is not always
// sent. `usd ■■■■■■■■■■□□□□□□ 63%  $314.12/$500.00  ↻ 12d04h Mon 12:10`; the clock time goes
// first when the line is too wide.
function spendLimitLines({ spendLimit, nowMs, timeZone }, size, width) {
  if (!spendLimit || !Number.isFinite(spendLimit.percentUsed)) return [];
  const clock = { nowMs, timeZone: timeZone ?? null };
  const draw = (showClock) => {
    const clockText = showClock ? formatClock(spendLimit.resetsAtMs, clock) : DASH;
    const countdown = formatCountdown(spendLimit.resetsAtMs - nowMs);
    const hasAmounts = Number.isFinite(spendLimit.usedUsd) && Number.isFinite(spendLimit.limitUsd);
    return [
      segment('usd'.padEnd(LABEL_WIDTH), TONE.muted),
      ...barSegments(spendLimit.percentUsed, limitTone(spendLimit), size.barWidth),
      ...(hasAmounts ? [segment(GAP), segment(`${formatUsd(spendLimit.usedUsd)}/${formatUsd(spendLimit.limitUsd)}`, TONE.muted)] : []),
      ...(countdown === DASH ? [] : [segment(GAP), segment(`↻ ${countdown}${clockText === DASH ? '' : ` ${clockText}`}`, TONE.muted)]),
    ];
  };
  const full = draw(true);
  return [width === null || lineText(full).length <= width ? full : draw(false)];
}

const projectionText = (percent) => (Math.round(percent) > PROJECTION_CAP ? `>${PROJECTION_CAP}%` : formatPercent(percent));

function barSegments(percent, tone, width, percentWidth = PERCENT_WIDTH) {
  const { filled, empty } = progressBar(percent, width);
  return [
    segment(filled, tone),
    segment(empty, TONE.muted),
    segment(' '),
    segment(formatPercent(percent).padStart(percentWidth), tone),
  ];
}
