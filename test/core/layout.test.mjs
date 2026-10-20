import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildLines, lineText } from '../../src/core/layout.mjs';
import { TONE } from '../../src/core/thresholds.mjs';
import { MOCKUP, MOCKUP_LINES, EMPTY, NOW } from '../fixtures/snapshots.mjs';

const plain = (lines) => lines.map(lineText);
const segmentWith = (line, text) => line.find((segment) => segment.text.includes(text));
// Lines by what they show, top to bottom, so the order lives here and in the order test only.
const ROLES = Object.freeze(['header', 'session', 'context', 'sevenDay', 'fiveHour']);
const byRole = (lines) => Object.fromEntries(ROLES.map((role, index) => [role, lines[index]]));

test('buildLines reproduces the mockup at 120 columns', () => {
  assert.deepEqual(plain(buildLines(MOCKUP, { columns: 120 })), [...MOCKUP_LINES]);
});

test('the session line sits under the header, above the context line', () => {
  const lines = plain(buildLines(MOCKUP, { columns: 120 }));
  assert.equal(lines.length, ROLES.length);
  assert.match(lines[0], /^daily-claude \|/);
  assert.match(lines[1], /^ {4}\$20\.33 · 5h40m/);
  assert.match(lines[2], /^ctx /);
  assert.match(lines[3], /^7d /);
  assert.match(lines[4], /^5h /);
});

test('buildLines colours by meaning: limit ok, context warn, cost and model', () => {
  const { header, session, context, sevenDay } = byRole(buildLines(MOCKUP, { columns: 120 }));
  assert.equal(segmentWith(sevenDay, '39%').tone, TONE.ok);
  assert.equal(segmentWith(context, '54%').tone, TONE.warn);
  assert.equal(segmentWith(session, '$20.33').tone, TONE.cost);
  assert.equal(segmentWith(header, 'Opus 5.5').tone, TONE.model);
});

test('layout renders placeholders without limits', () => {
  const { sevenDay, fiveHour } = byRole(buildLines({ ...MOCKUP, limits: { sevenDay: null, fiveHour: null } }, { columns: 120 }));
  assert.equal(lineText(sevenDay), '7d  —');
  assert.equal(lineText(fiveHour), '5h  —');
  assert.ok(sevenDay.every((segment) => segment.tone === TONE.muted));
});

test('layout narrow: 10-cell bars and no line below the full line width', () => {
  const { context, sevenDay } = byRole(buildLines(MOCKUP, { columns: 40 }));
  assert.equal(lineText(context), 'ctx ■■■■■□□□□□ 54%  543k/1.0M');
  assert.ok(lineText(sevenDay).startsWith('7d  ■■■■□□□□□□ 39%'));
});

test('layout drops missing session items without doubled separators', () => {
  const { session } = byRole(buildLines({ ...MOCKUP, costUsd: null, effort: null }, { columns: 120 }));
  assert.equal(lineText(session), '    5h40m · cache 99% 52m · +156 -23');
});

test('layout keeps an empty session line in its place as a dash', () => {
  const noSession = {
    ...MOCKUP, costUsd: null, durationMs: null, cacheHitRatio: null, effort: null, linesChanged: null,
  };
  const { session, context } = byRole(buildLines(noSession, { columns: 120 }));
  assert.equal(lineText(session), '    —');
  assert.match(lineText(context), /^ctx /);
});

test('layout shows the branch and a dirty marker for a repository', () => {
  const { header } = byRole(buildLines({ ...MOCKUP, git: { isRepo: true, branch: 'develop', isDirty: true } }, { columns: 120 }));
  assert.equal(lineText(header), 'daily-claude | git develop* | ✦ Opus 5.5');
});

test('layout turns the whole limit red when the projection passes 100%', () => {
  // 52% after 2.5h of a 5h window → 20.8%/h → 104% at reset.
  const limits = { ...MOCKUP.limits, fiveHour: { percentUsed: 52, resetsAtMs: NOW + 9_000_000 } };
  const { fiveHour } = byRole(buildLines({ ...MOCKUP, limits }, { columns: 120 }));
  assert.equal(segmentWith(fiveHour, '■').tone, TONE.alert);
  assert.equal(segmentWith(fiveHour, '104%').tone, TONE.alert);
  assert.equal(segmentWith(fiveHour, '%/h').tone, TONE.alert);
});

// 70% three hours into the 5-hour window: 23.3%/h, 117% at the reset, 100% in 1h17m.
const RUNNING_OUT = { ...MOCKUP, limits: { ...MOCKUP.limits, fiveHour: { percentUsed: 70, resetsAtMs: NOW + 7_200_000 } } };

test('a limit that runs out before its reset says when, in the alert colour', () => {
  const { fiveHour } = byRole(buildLines(RUNNING_OUT, { columns: 120 }));
  assert.equal(lineText(fiveHour), '5h  ■■■■■■■■■■■□□□□□ 70% → 117%  ↻ 2h00m 10:00      ↗ 23.3%/h  ⚠ 100% in 1h17m');
  assert.equal(segmentWith(fiveHour, '⚠').tone, TONE.alert);
  const { sevenDay } = byRole(buildLines(RUNNING_OUT, { columns: 120 }));
  assert.equal(segmentWith(sevenDay, '⚠'), undefined);
});

test('narrower lines drop the clock time first, then the time to 100%, on both limit lines alike', () => {
  const at = (columns) => plain(buildLines(RUNNING_OUT, { columns })).slice(3);
  assert.ok(at(80).every((line) => line.length <= 80));
  assert.match(at(80)[0], /Mon 12:10/);
  assert.deepEqual(at(70), [
    '7d  ■■■■■■□□□□□□□□□□ 39% →  71%  ↻ 3d04h  ↗ 10.2%/d',
    '5h  ■■■■■■■■■■■□□□□□ 70% → 117%  ↻ 2h00m  ↗ 23.3%/h  ⚠ 100% in 1h17m',
  ]);
  assert.deepEqual(at(60)[1], '5h  ■■■■■■■■■■■□□□□□ 70% → 117%  ↻ 2h00m  ↗ 23.3%/h');
  assert.deepEqual(at(45), [
    '7d  ■■■■□□□□□□ 39% →  71%  ↻ 3d04h  ↗ 10.2%/d',
    '5h  ■■■■■■■□□□ 70% → 117%  ↻ 2h00m  ↗ 23.3%/h',
  ]);
});

test('without a known width or time zone the limit lines keep everything they can show', () => {
  const { fiveHour } = byRole(buildLines(RUNNING_OUT, { columns: undefined }));
  assert.match(lineText(fiveHour), /10:00 .* ⚠ 100% in 1h17m$/);
  const { sevenDay } = byRole(buildLines({ ...MOCKUP, timeZone: null }, { columns: 120 }));
  assert.equal(lineText(sevenDay), '7d  ■■■■■■□□□□□□□□□□ 39% →  71%  ↻ 3d04h  ↗ 10.2%/d');
});

test('in the first 15 minutes of a window there is no projection yet, shown as a muted dash', () => {
  const limits = { ...MOCKUP.limits, fiveHour: { percentUsed: 2, resetsAtMs: NOW + 17_400_000 } };
  const { fiveHour } = byRole(buildLines({ ...MOCKUP, limits }, { columns: 120 }));
  assert.equal(lineText(fiveHour), '5h  □□□□□□□□□□□□□□□□  2% →    —  ↻ 4h50m 12:50      ↗ —');
  assert.equal(segmentWith(fiveHour, ' —').tone, TONE.muted);
});

test('the limit lines read the shared history: the freshest figure and the pace of the last 30 minutes', () => {
  const reset = NOW + 3 * 3_600_000;
  const limitReadings = {
    fiveHour: [[NOW - 3_600_000, 20, reset], [NOW - 1_800_000, 30, reset], [NOW - 60_000, 45, reset]],
    sevenDay: [],
  };
  const limits = { ...MOCKUP.limits, fiveHour: { percentUsed: 40, resetsAtMs: reset } };
  const { fiveHour } = byRole(buildLines({ ...MOCKUP, limits, limitReadings }, { columns: 120 }));
  // 45% (another session's newer figure), 15 points in half an hour → 30%/h → 135% at the reset.
  assert.match(lineText(fiveHour), /^5h {2}\S+ 45% → 135% .* ↗ 30\.0%\/h {2}⚠ 100% in 1h50m$/);
});

test('the cache shows how long it stays warm, warns in its last five minutes and says when it went cold', () => {
  const sessionWith = (promptCache) => byRole(buildLines({ ...MOCKUP, promptCache }, { columns: 120 })).session;
  assert.equal(segmentWith(sessionWith({ warm: true, expiresAtMs: NOW + 3_120_000 }), ' 52m').tone, TONE.muted);
  assert.equal(segmentWith(sessionWith({ warm: true, expiresAtMs: NOW + 240_000 }), ' 4m').tone, TONE.warn);
  assert.equal(segmentWith(sessionWith({ warm: true, expiresAtMs: NOW - 1 }), ' cold').tone, TONE.muted);
  assert.equal(segmentWith(sessionWith({ warm: false, expiresAtMs: null }), ' cold').tone, TONE.muted);
  assert.match(lineText(sessionWith({ warm: true, expiresAtMs: null })), /cache 99% · xhigh/);
  assert.match(lineText(sessionWith(null)), /cache 99% · xhigh/);
});

test('the columns after the reset stay aligned when the 7-day countdown is longer (its last day)', () => {
  const limits = { ...MOCKUP.limits, sevenDay: { percentUsed: 95, resetsAtMs: NOW + 13 * 3_600_000 + 20 * 60_000 } };
  const [sevenDay, fiveHour] = plain(buildLines({ ...MOCKUP, limits }, { columns: 120 })).slice(3);
  assert.match(sevenDay, /↻ 13h20m 21:20 {2}↗/);
  assert.match(fiveHour, /↻ 4h10m {2}12:10 {2}↗/);
  assert.equal(sevenDay.indexOf('↗'), fiveHour.indexOf('↗'));
});

test('a limit without a reset time shows its usage with dashes and keeps the other line aligned', () => {
  const limits = { ...MOCKUP.limits, sevenDay: { percentUsed: 39, resetsAtMs: null } };
  const [sevenDay, fiveHour] = plain(buildLines({ ...MOCKUP, limits }, { columns: 120 })).slice(3);
  assert.equal(sevenDay, '7d  ■■■■■■□□□□□□□□□□ 39% →    —  ↻ —            ↗ —');
  assert.equal(sevenDay.indexOf('↗'), fiveHour.indexOf('↗'));
});

test('the pace takes the warning colour when the projection lands between 80% and 100%', () => {
  // 45% after 2.5h of the 5-hour window: 18%/h, 90% at the reset.
  const limits = { ...MOCKUP.limits, fiveHour: { percentUsed: 45, resetsAtMs: NOW + 9_000_000 } };
  const { fiveHour } = byRole(buildLines({ ...MOCKUP, limits }, { columns: 120 }));
  assert.equal(segmentWith(fiveHour, ' 90%').tone, TONE.warn);
  assert.equal(segmentWith(fiveHour, '%/h').tone, TONE.warn);
  assert.equal(segmentWith(fiveHour, '⚠'), undefined);
});

test('the cache countdown needs the cache ratio and a clock', () => {
  const { session } = byRole(buildLines({ ...MOCKUP, cacheHitRatio: null }, { columns: 120 }));
  assert.doesNotMatch(lineText(session), /cache|52m/);
  const noClock = byRole(buildLines({ ...MOCKUP, nowMs: NaN }, { columns: 120 })).session;
  assert.match(lineText(noClock), /cache 99% · xhigh/);
});

test('changed lines show as +added -removed in their own colours, and not at all while nothing changed', () => {
  const sessionOf = (linesChanged) => byRole(buildLines({ ...MOCKUP, linesChanged }, { columns: 120 })).session;
  const session = sessionOf({ added: 156, removed: 23 });
  assert.equal(segmentWith(session, '+156').tone, TONE.added);
  assert.equal(segmentWith(session, '-23').tone, TONE.removed);
  assert.equal(lineText(sessionOf({ added: 0, removed: 4 })), '    $20.33 · 5h40m · cache 99% 52m · xhigh · +0 -4');
  assert.doesNotMatch(lineText(sessionOf({ added: 0, removed: 0 })), /\+/);
  assert.doesNotMatch(lineText(sessionOf(null)), /\+/);
});

test('layout of an empty snapshot is readable and never prints undefined or NaN', () => {
  const text = plain(buildLines(EMPTY, { columns: undefined })).join('\n');
  assert.doesNotMatch(text, /undefined|NaN|null/);
  assert.deepEqual(plain(buildLines(EMPTY, { columns: 120 })), [
    '— | no git | ✦ —',
    '    —',
    'ctx □□□□□□□□□□□□□□□□   —  —/—',
    '7d  —',
    '5h  —',
  ]);
});

test('the context line carries its history as a min→max series for drawing a real line', () => {
  const { context } = byRole(buildLines(MOCKUP, { columns: 120 }));
  const line = context.find((segment) => segment.series);
  assert.equal(line.text, '⣀⡠⠔⠊');
  assert.equal(line.tone, TONE.spark);
  assert.equal(line.series.length, 8);
  assert.equal(line.series[0], 0);
  assert.equal(line.series.at(-1), 1);
});

test('the full mockup line fits from 52 columns', () => {
  const { context } = byRole(buildLines(MOCKUP, { columns: 52 }));
  assert.equal(lineText(context), 'ctx ■■■■■■■■■□□□□□□□ 54%  543k/1.0M  ⣀⡠⠔⠊');
});
