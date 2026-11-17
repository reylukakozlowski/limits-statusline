// The limit lines: one for each plan window the account has (7-day, 5-hour) and one for a
// gateway's spend limit.
//   7d  ■■■■■■□□□□□□□□□□ 39% →  69%  ↻ 3d04h Mon 12:10  ↗ 0.4%/h
//   usd ■■■■■■■■■■□□□□□□ 63%  $314.12/$500.00  ↻ 12d04h Wed 12:10

import { DASH, formatClock, formatCountdown, formatPercent, formatRate, formatUsd } from './format.mjs';
import {
  GAP, PERCENT_WIDTH, barSegments, firstThatFits, label, segment, separator, widest,
} from './layout-segments.mjs';
import { LIMIT_WINDOWS, accountHasWindow } from './limit-windows.mjs';
import { analyzeLimit } from './metrics.mjs';
import { TONE, limitTone } from './thresholds.mjs';

const PROJECTION_WIDTH = 4; // "117%"
const PROJECTION_CAP = 999; // beyond it the figure says nothing more: ">999%"

const PLAN_LINES = Object.freeze([
  Object.freeze({ name: '7d', kind: 'sevenDay' }),
  Object.freeze({ name: '5h', kind: 'fiveHour' }),
]);

// What the plan lines give up, in order, until they fit the width: first the reset's clock time,
// then the time to 100%. Both lines drop the same parts, so their columns stay aligned.
const PLAN_DETAILS = Object.freeze([
  Object.freeze({ showClock: true, showLimitIn: true }),
  Object.freeze({ showClock: false, showLimitIn: true }),
  Object.freeze({ showClock: false, showLimitIn: false }),
]);

/**
 * @param {import('./layout.mjs').Snapshot} snapshot
 * @param {{ barWidth: number }} size
 * @param {number | null} width the surface's width in cells, null when unknown
 * @returns {import('./layout-segments.mjs').Line[]}
 */
export function planLimitLines(snapshot, size, width) {
  const rows = planRows(snapshot);
  // Each column is as wide as its longest value on either line, so what follows it lines up.
  const drawn = rows.filter(({ analysis }) => analysis);
  const widths = {
    percent: widest(drawn.map(({ percentText }) => percentText), PERCENT_WIDTH),
    projection: widest(drawn.map(({ projectionText }) => projectionText), PROJECTION_WIDTH),
  };
  return firstThatFits(width, PLAN_DETAILS.map((details) => () => {
    const resets = resetColumn(drawn, details.showClock);
    return rows.map((row) => planLine(row, { size, details, widths, reset: resets.get(row) }));
  }));
}

// A row per window the account has, with its figures as text. A window without a figure keeps
// its row, drawn as a dash, only while the account is known to have it.
function planRows({ limits, limitHistory, nowMs, timeZone }) {
  const clock = { nowMs, timeZone: timeZone ?? null };
  return PLAN_LINES
    .filter(({ kind }) => accountHasWindow(limits?.[kind] ?? null, limitHistory?.seenAtMs?.[kind], nowMs))
    .map(({ name, kind }) => {
      const reading = limits?.[kind] ?? null;
      const analysis = analyzeLimit(reading, LIMIT_WINDOWS[kind], clock, limitHistory?.readings?.[kind] ?? []);
      const clockText = formatClock(reading?.resetsAtMs, clock);
      return {
        name,
        analysis,
        percentText: formatPercent(analysis?.percentUsed),
        projectionText: projectionText(analysis?.projectedPercent),
        countdown: formatCountdown(analysis?.remainingMs),
        clockText: clockText === DASH ? null : clockText,
      };
    });
}

const projectionText = (percent) => (Math.round(percent) > PROJECTION_CAP ? `>${PROJECTION_CAP}%` : formatPercent(percent));

// The reset column of each plan line: `3h50m`, or with the clock time `3h50m 18:10`; the
// countdowns and the clock times are each padded to the longest, so the columns after them line up.
function resetColumn(rows, showClock) {
  const countdownWidth = widest(rows.map(({ countdown }) => countdown));
  const clockWidth = showClock ? widest(rows.map(({ clockText }) => clockText ?? '')) : 0;
  return new Map(rows.map((row) => {
    const countdown = row.countdown.padEnd(countdownWidth);
    return [row, clockWidth > 0 ? `${countdown} ${(row.clockText ?? '').padEnd(clockWidth)}` : countdown];
  }));
}

function planLine({ name, analysis, projectionText: projection }, { size, details, widths, reset }) {
  if (!analysis) return [label(name), segment(DASH, TONE.muted)];
  const tone = limitTone(analysis);
  const hasProjection = Number.isFinite(analysis.projectedPercent);
  // The rate stays quiet while the pace is fine and takes the warning colour when it is not.
  const rateTone = Number.isFinite(analysis.ratePerHour) && tone !== TONE.ok ? tone : TONE.muted;
  return [
    label(name),
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

/**
 * A gateway's spend limit: its share, the amounts when they were sent, and the reset. No pace or
 * projection, since the length of its period is not always sent. The reset's clock time goes
 * first when the line is too wide.
 * @param {import('./layout.mjs').Snapshot} snapshot
 * @param {{ barWidth: number }} size
 * @param {number | null} width
 * @returns {import('./layout-segments.mjs').Line[]} no line without a spend limit
 */
export function spendLimitLines({ spendLimit, nowMs, timeZone }, size, width) {
  if (!spendLimit || !Number.isFinite(spendLimit.percentUsed)) return [];
  const clock = { nowMs, timeZone: timeZone ?? null };
  const amounts = Number.isFinite(spendLimit.usedUsd) && Number.isFinite(spendLimit.limitUsd)
    ? `${formatUsd(spendLimit.usedUsd)}/${formatUsd(spendLimit.limitUsd)}`
    : null;
  const draw = (showClock) => {
    const reset = resetText(spendLimit.resetsAtMs, clock, showClock);
    return [[
      label('usd'),
      ...barSegments(spendLimit.percentUsed, limitTone(spendLimit), size.barWidth),
      ...(amounts ? [segment(GAP), segment(amounts, TONE.muted)] : []),
      ...(reset ? [segment(GAP), segment(`↻ ${reset}`, TONE.muted)] : []),
    ]];
  };
  return firstThatFits(width, [() => draw(true), () => draw(false)]);
}

/** `12d04h Wed 12:10`, without the clock time `12d04h`; null for a reset that is unknown or past. */
function resetText(resetsAtMs, clock, showClock) {
  if (!Number.isFinite(resetsAtMs) || resetsAtMs < clock.nowMs) return null;
  const countdown = formatCountdown(resetsAtMs - clock.nowMs);
  const clockText = showClock ? formatClock(resetsAtMs, clock) : DASH;
  return clockText === DASH ? countdown : `${countdown} ${clockText}`;
}
