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
  assert.equal(lineText(session), '    5h40m · cache 99%');
});

test('layout keeps an empty session line in its place as a dash', () => {
  const noSession = { ...MOCKUP, costUsd: null, durationMs: null, cacheHitRatio: null, effort: null };
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
  assert.equal(segmentWith(fiveHour, '%/h').tone, TONE.alert);
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
