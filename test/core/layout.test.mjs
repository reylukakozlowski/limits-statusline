import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildLines, lineText } from '../../src/core/layout.mjs';
import { TONE } from '../../src/core/thresholds.mjs';
import { MS_PER_DAY as DAY_MS, MS_PER_HOUR as HOUR_MS, MS_PER_MINUTE as MINUTE_MS } from '../../src/core/time.mjs';
import { MOCKUP, MOCKUP_LINES, EMPTY, NOW } from '../fixtures/snapshots.mjs';

const NO_READINGS = MOCKUP.limitHistory.readings;
/** The history with the times the two windows were last reported. */
const seenAt = (seenAtMs) => ({ readings: NO_READINGS, seenAtMs });
/** The history with shared readings. */
const withReadings = (readings) => ({ readings, seenAtMs: MOCKUP.limitHistory.seenAtMs });

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

const NO_FIGURES = { sevenDay: null, fiveHour: null };

// Before a session's first response there are no figures yet, and after a 5-hour window's reset
// none for it until the next response: a window seen within the week keeps its line, as a dash.
test('a window without a figure keeps its line as a dash while the account is known to have it', () => {
  const seen = { ...MOCKUP, limits: NO_FIGURES, limitHistory: seenAt({ sevenDay: NOW - 7 * DAY_MS, fiveHour: NOW - MINUTE_MS }) };
  const { sevenDay, fiveHour } = byRole(buildLines(seen, { columns: 120 }));
  assert.equal(lineText(sevenDay), '7d  —');
  assert.equal(lineText(fiveHour), '5h  —');
  assert.ok(sevenDay.every((segment) => segment.tone === TONE.muted));
});

// A verified Ultra account has no 5-hour window, an API key no plan windows at all: a line for
// a window that never comes would be a dash forever.
test('a window not seen for more than a week, or never, has no line', () => {
  const linesOf = (limits, seenAtMs) => plain(buildLines({ ...MOCKUP, limits, limitHistory: seenAt(seenAtMs) }, { columns: 120 }));
  const weekOnly = linesOf({ ...MOCKUP.limits, fiveHour: null }, { sevenDay: NOW, fiveHour: null });
  assert.deepEqual(weekOnly, [MOCKUP_LINES[0], MOCKUP_LINES[1], MOCKUP_LINES[2], '7d  ■■■■■■□□□□□□□□□□ 39% →  69%  ↻ 3d04h Mon 12:10  ↗ 0.4%/h']);
  assert.deepEqual(linesOf(NO_FIGURES, { sevenDay: null, fiveHour: null }), MOCKUP_LINES.slice(0, 3));
  assert.deepEqual(linesOf(NO_FIGURES, { sevenDay: NOW - 7 * DAY_MS - 1, fiveHour: NOW - 7 * DAY_MS - 1 }), MOCKUP_LINES.slice(0, 3));
  // A figure is drawn whatever the history says.
  assert.deepEqual(linesOf(MOCKUP.limits, { sevenDay: null, fiveHour: null }), [...MOCKUP_LINES]);
});

// rate_limits.spend_limit, behind a Claude apps gateway: the share used (past 100 once exceeded)
// and the reset with every response, the amounts when the gateway has them.
test('a gateway spend limit has a line of its own: bar, share, amounts and reset, no pace', () => {
  const spendLine = (spendLimit, columns = 120) => plain(buildLines({ ...MOCKUP, limits: NO_FIGURES, spendLimit }, { columns })).at(-1);
  const reset = NOW + 12 * DAY_MS + 4 * HOUR_MS + 10 * MINUTE_MS; // Wed 27 Jan 2027 12:10 UTC
  assert.equal(spendLine({ percentUsed: 63, resetsAtMs: reset, usedUsd: 314.12, limitUsd: 500 }),
    'usd ■■■■■■■■■■□□□□□□ 63%  $314.12/$500.00  ↻ 12d04h Wed 12:10');
  assert.equal(spendLine({ percentUsed: 63, resetsAtMs: reset, usedUsd: null, limitUsd: null }),
    'usd ■■■■■■■■■■□□□□□□ 63%  ↻ 12d04h Wed 12:10');
  assert.equal(spendLine({ percentUsed: 63, resetsAtMs: null, usedUsd: 314.12, limitUsd: null }), 'usd ■■■■■■■■■■□□□□□□ 63%');
  // A reset already past is no reset to count down to.
  assert.equal(spendLine({ percentUsed: 63, resetsAtMs: NOW - 1, usedUsd: null, limitUsd: null }), 'usd ■■■■■■■■■■□□□□□□ 63%');
  assert.equal(spendLine({ percentUsed: 137, resetsAtMs: reset, usedUsd: 685, limitUsd: 500 }, 44),
    'usd ■■■■■■■■■■ 137%  $685.00/$500.00  ↻ 12d04h', 'narrow: 10 cells, and the clock time goes first');
});

test('the spend limit takes the limit colours, sits below the plan lines, and is absent without a figure', () => {
  const lines = (spendLimit) => buildLines({ ...MOCKUP, spendLimit }, { columns: 120 });
  const toneOf = (percentUsed) => segmentWith(lines({ percentUsed, resetsAtMs: null, usedUsd: null, limitUsd: null }).at(-1), '%').tone;
  assert.deepEqual([toneOf(79), toneOf(80), toneOf(100), toneOf(137)], [TONE.ok, TONE.warn, TONE.alert, TONE.alert]);
  assert.deepEqual(plain(lines({ percentUsed: 10, resetsAtMs: null, usedUsd: null, limitUsd: null })).slice(0, 5), [...MOCKUP_LINES]);
  for (const none of [null, undefined, { percentUsed: null, resetsAtMs: NOW, usedUsd: 1, limitUsd: 2 }]) {
    assert.deepEqual(plain(lines(none)), [...MOCKUP_LINES]);
  }
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

// Fast mode costs twice the standard price on Fable 5.2 and draws from usage credits
// (https://code.claude.com/docs/en/fast-mode), hence the warning colour.
test('fast mode shows after the effort in the warning colour, and only while it is on', () => {
  const sessionOf = (fastMode) => byRole(buildLines({ ...MOCKUP, fastMode }, { columns: 120 })).session;
  assert.equal(lineText(sessionOf(true)), '    $20.33 · 5h40m · cache 99% 52m · xhigh · fast · +156 -23');
  assert.equal(segmentWith(sessionOf(true), 'fast').tone, TONE.warn);
  for (const off of [false, null, undefined, 'true', 1]) {
    assert.equal(lineText(sessionOf(off)), MOCKUP_LINES[1], String(off));
  }
  const alone = byRole(buildLines({ ...EMPTY, fastMode: true }, { columns: 120 })).session;
  assert.equal(lineText(alone), '    fast');
});

test('layout keeps an empty session line in its place as a dash', () => {
  const noSession = {
    ...MOCKUP, costUsd: null, modelTimeMs: null, cacheHitRatio: null, effort: null, linesChanged: null,
  };
  const { session, context } = byRole(buildLines(noSession, { columns: 120 }));
  assert.equal(lineText(session), '    —');
  assert.match(lineText(context), /^ctx /);
});

test('layout shows the branch and a dirty marker for a repository', () => {
  const { header } = byRole(buildLines({ ...MOCKUP, git: { isRepo: true, branch: 'develop', isDirty: true } }, { columns: 120 }));
  assert.equal(lineText(header), 'daily-claude | git develop* | ✦ Opus 5.5');
});

const LONG_BRANCH = { ...MOCKUP, project: 'limits-statusline', git: { isRepo: true, branch: 'feature/lko/develop/LS-81_posix-test-paths', isDirty: true } };
const headerAt = (snapshot, columns) => lineText(buildLines(snapshot, { columns })[0]);

// The whole header is 80 characters; a surface cuts a line at its end, where the model stands.
test('a header too wide for the surface gives up the start of the branch and keeps the model', () => {
  assert.equal(headerAt(LONG_BRANCH, 80), 'limits-statusline | git feature/lko/develop/LS-81_posix-test-paths* | ✦ Opus 5.5');
  // 10 characters too many: the branch's 42 become 32, the ellipsis among them.
  assert.equal(headerAt(LONG_BRANCH, 70), 'limits-statusline | git …/develop/LS-81_posix-test-paths* | ✦ Opus 5.5');
  assert.equal(headerAt(LONG_BRANCH, 70).length, 70);
  assert.equal(headerAt(LONG_BRANCH, undefined), headerAt(LONG_BRANCH, 80), 'an unknown width cuts nothing');
});

test('once the branch is down to 8 characters the project gives up its end, down to 8 as well', () => {
  assert.equal(headerAt(LONG_BRANCH, 46), 'limits-statusline | git …t-paths* | ✦ Opus 5.5');
  assert.equal(headerAt(LONG_BRANCH, 40), 'limits-sta… | git …t-paths* | ✦ Opus 5.5');
  assert.equal(headerAt(LONG_BRANCH, 40).length, 40);
  // Narrower than the shortest names allow: nothing more is cut here, the surface cuts the rest.
  assert.equal(headerAt(LONG_BRANCH, 20), 'limits-… | git …t-paths* | ✦ Opus 5.5');
});

test('a header outside a repository shortens the project alone, and short names are left whole', () => {
  const noRepo = { ...MOCKUP, project: 'a-project-with-a-very-long-folder-name' };
  // 60 characters at 40 columns: the project's 38 become 18.
  assert.equal(headerAt(noRepo, 40), 'a-project-with-a-… | no git | ✦ Opus 5.5');
  assert.equal(headerAt(MOCKUP, 34), MOCKUP_LINES[0], 'the mockup header is 34 characters');
  assert.equal(headerAt(MOCKUP, 33), 'daily-clau… | no git | ✦ Opus 5.5');
  const shortNames = { ...MOCKUP, project: 'api', git: { isRepo: true, branch: 'main', isDirty: false } };
  assert.equal(headerAt(shortNames, 10), 'api | git main | ✦ Opus 5.5');
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
    '7d  ■■■■■■□□□□□□□□□□ 39% →  69%  ↻ 3d04h  ↗ 0.4%/h',
    '5h  ■■■■■■■■■■■□□□□□ 70% → 117%  ↻ 2h00m  ↗ 23.3%/h  ⚠ 100% in 1h17m',
  ]);
  assert.deepEqual(at(60)[1], '5h  ■■■■■■■■■■■□□□□□ 70% → 117%  ↻ 2h00m  ↗ 23.3%/h');
  assert.deepEqual(at(45), [
    '7d  ■■■■□□□□□□ 39% →  69%  ↻ 3d04h  ↗ 0.4%/h',
    '5h  ■■■■■■■□□□ 70% → 117%  ↻ 2h00m  ↗ 23.3%/h',
  ]);
});

// An empty COLUMNS reads as the number 0: a width nothing fits in, not a narrow terminal.
test('a width of zero or less is an unknown width: the full layout, as without one', () => {
  for (const columns of [0, -1, Number(''), NaN, undefined, null, '80']) {
    assert.deepEqual(plain(buildLines(MOCKUP, { columns })), [...MOCKUP_LINES], String(columns));
  }
});

test('without a known width or time zone the limit lines keep everything they can show', () => {
  const { fiveHour } = byRole(buildLines(RUNNING_OUT, { columns: undefined }));
  assert.match(lineText(fiveHour), /10:00 .* ⚠ 100% in 1h17m$/);
  // Without a zone there is no night to leave out: the projection runs to the reset.
  const { sevenDay } = byRole(buildLines({ ...MOCKUP, timeZone: null }, { columns: 120 }));
  assert.equal(lineText(sevenDay), '7d  ■■■■■■□□□□□□□□□□ 39% →  71%  ↻ 3d04h  ↗ 0.4%/h');
});

// Friday 19:00 UTC, the week resets on Sunday at 07:00: 66% at 1%/h over the last day.
const FRIDAY_19 = NOW + 11 * HOUR_MS;
const SUNDAY_07 = FRIDAY_19 + 36 * HOUR_MS;
const WEEK_ENDING_AT_DAWN = {
  ...MOCKUP,
  nowMs: FRIDAY_19,
  limits: { ...MOCKUP.limits, sevenDay: { percentUsed: 66, resetsAtMs: SUNDAY_07 } },
  limitHistory: withReadings({ fiveHour: [], sevenDay: [[FRIDAY_19 - DAY_MS, 42, SUNDAY_07], [FRIDAY_19, 66, SUNDAY_07]] }),
};

test('the 7-day line runs to 02:00 when the week resets at 07:00: yellow, and no ⚠', () => {
  const { sevenDay } = byRole(buildLines(WEEK_ENDING_AT_DAWN, { columns: 120 }));
  assert.match(lineText(sevenDay), /^7d {2}\S+ 66% → {2}97% {2}↻ 1d12h Sun 07:00 {2}↗ 1\.0%\/h$/);
  assert.equal(segmentWith(sevenDay, '■').tone, TONE.warn);
  assert.equal(segmentWith(sevenDay, ' 97%').tone, TONE.warn);
  assert.equal(segmentWith(sevenDay, '%/h').tone, TONE.warn);
  assert.equal(segmentWith(sevenDay, '⚠'), undefined);
});

test('the same week without a time zone runs to the reset: red, and when it runs out', () => {
  const { sevenDay } = byRole(buildLines({ ...WEEK_ENDING_AT_DAWN, timeZone: null }, { columns: 120 }));
  assert.match(lineText(sevenDay), /66% → 102% {2}↻ 1d12h {2}↗ 1\.0%\/h {2}⚠ 100% in 1d10h$/);
  assert.equal(segmentWith(sevenDay, '102%').tone, TONE.alert);
});

// Friday 20:00 UTC, the week resets on Saturday at 07:00: 92% a day ago, 99% now, 0.29%/h.
const FRIDAY_20 = NOW + 12 * HOUR_MS;
const SATURDAY_07 = FRIDAY_20 + 11 * HOUR_MS;
const LAST_PERCENT = (activity) => ({
  ...MOCKUP,
  nowMs: FRIDAY_20,
  limits: { ...MOCKUP.limits, sevenDay: { percentUsed: 99, resetsAtMs: SATURDAY_07 } },
  limitHistory: {
    ...withReadings({ fiveHour: [], sevenDay: [[FRIDAY_20 - DAY_MS, 92, SATURDAY_07], [FRIDAY_20, 99, SATURDAY_07]] }),
    ...(activity ? { activity } : {}),
  },
});

test('the 7-day line gives the time to 100% in work when the work is on record', () => {
  // Three hours of work in the last day: 7 points in 3 hours, so the last percent is 25m43s.
  const activity = [[FRIDAY_20 - DAY_MS, FRIDAY_20 - 22 * HOUR_MS], [FRIDAY_20 - HOUR_MS, FRIDAY_20]];
  const { sevenDay } = byRole(buildLines(LAST_PERCENT(activity), { columns: 120 }));
  assert.match(lineText(sevenDay), /99% → 101% {2}↻ 11h00m 07:00 {2}↗ 0\.3%\/h {2}⚠ 100% in ~25m of work$/);
  assert.equal(segmentWith(sevenDay, 'of work').tone, TONE.alert);
});

test('without work on record the 7-day line gives the time on the clock, as before', () => {
  // The last percent at 7 points a day: 3h25m43s.
  for (const activity of [undefined, [], [[FRIDAY_20 - 30 * MINUTE_MS, FRIDAY_20]]]) {
    const { sevenDay } = byRole(buildLines(LAST_PERCENT(activity), { columns: 120 }));
    assert.match(lineText(sevenDay), /↗ 0\.3%\/h {2}⚠ 100% in 3h25m$/);
  }
});

test('in the first 15 minutes of a window there is no projection yet, shown as a muted dash', () => {
  const limits = { ...MOCKUP.limits, fiveHour: { percentUsed: 2, resetsAtMs: NOW + 17_400_000 } };
  const { fiveHour } = byRole(buildLines({ ...MOCKUP, limits }, { columns: 120 }));
  assert.equal(lineText(fiveHour), '5h  □□□□□□□□□□□□□□□□  2% →    —  ↻ 4h50m 12:50      ↗ —');
  assert.equal(segmentWith(fiveHour, ' —').tone, TONE.muted);
});

test('the limit lines read the shared history: the freshest figure and the pace of the last 30 minutes', () => {
  const reset = NOW + 3 * HOUR_MS;
  const limitHistory = withReadings({
    fiveHour: [[NOW - HOUR_MS, 20, reset], [NOW - 30 * MINUTE_MS, 30, reset], [NOW - MINUTE_MS, 45, reset]],
    sevenDay: [],
  });
  const limits = { ...MOCKUP.limits, fiveHour: { percentUsed: 40, resetsAtMs: reset } };
  const { fiveHour } = byRole(buildLines({ ...MOCKUP, limits, limitHistory }, { columns: 120 }));
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
  const limits = { ...MOCKUP.limits, sevenDay: { percentUsed: 95, resetsAtMs: NOW + 13 * HOUR_MS + 20 * MINUTE_MS } };
  const [sevenDay, fiveHour] = plain(buildLines({ ...MOCKUP, limits }, { columns: 120 })).slice(3);
  assert.match(sevenDay, /↻ 13h20m 21:20 {2}↗/);
  assert.match(fiveHour, /↻ 4h10m {2}12:10 {2}↗/);
  assert.equal(sevenDay.indexOf('↗'), fiveHour.indexOf('↗'));
});

const column = (line, mark) => lineText(line).indexOf(mark);

// "100%" is a character longer than "12%": the usage column takes the longer one on both lines.
test('a limit at 100% keeps the columns of the two limit lines aligned', () => {
  const limits = { ...MOCKUP.limits, sevenDay: { ...MOCKUP.limits.sevenDay, percentUsed: 100 } };
  const { sevenDay, fiveHour } = byRole(buildLines({ ...MOCKUP, limits }, { columns: 120 }));
  assert.ok(lineText(sevenDay).startsWith('7d  ■■■■■■■■■■■■■■■■ 100% → '), lineText(sevenDay));
  assert.ok(lineText(fiveHour).startsWith('5h  ■■□□□□□□□□□□□□□□  12% → '), lineText(fiveHour));
  for (const mark of ['→', '↻', '↗']) assert.equal(column(sevenDay, mark), column(fiveHour, mark), mark);
});

// 90% used 20 minutes into a 5-hour window is 270%/h: 90 + 270 × 4h40m = 1350% at the reset.
test('a projection past 999% reads >999%, and the other line stays aligned with it', () => {
  const limits = { ...MOCKUP.limits, fiveHour: { percentUsed: 90, resetsAtMs: NOW + 5 * HOUR_MS - 20 * MINUTE_MS } };
  const { sevenDay, fiveHour } = byRole(buildLines({ ...MOCKUP, limits }, { columns: 120 }));
  assert.ok(lineText(fiveHour).startsWith('5h  ■■■■■■■■■■■■■■□□ 90% → >999%  ↻ 4h40m'), lineText(fiveHour));
  assert.ok(lineText(sevenDay).startsWith('7d  ■■■■■■□□□□□□□□□□ 39% →   69%  ↻ '), lineText(sevenDay));
  for (const mark of ['→', '↻', '↗']) assert.equal(column(sevenDay, mark), column(fiveHour, mark), mark);
});

// Without the rule 3% in 20 minutes is 9%/h, 1467% by the reset and a red "100% in 10h46m".
test('a week that opened 20 minutes ago, with no earlier readings, has no projection and no warning', () => {
  const limits = { ...MOCKUP.limits, sevenDay: { percentUsed: 3, resetsAtMs: NOW + 7 * DAY_MS - 20 * MINUTE_MS } };
  const { sevenDay } = byRole(buildLines({ ...MOCKUP, limits }, { columns: 120 }));
  assert.equal(lineText(sevenDay), '7d  □□□□□□□□□□□□□□□□  3% →    —  ↻ 6d23h Fri 07:40  ↗ —');
  assert.deepEqual(sevenDay.filter((part) => part.tone === TONE.alert || part.tone === TONE.warn), []);
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
