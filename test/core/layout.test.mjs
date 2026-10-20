import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildLines, lineText } from '../../src/core/layout.mjs';
import { TONE } from '../../src/core/thresholds.mjs';
import { MOCKUP, MOCKUP_LINES, EMPTY, NOW } from '../fixtures/snapshots.mjs';

const plain = (lines) => lines.map(lineText);
const segmentWith = (line, text) => line.find((segment) => segment.text.includes(text));

test('buildLines reproduces the approved mockup at 120 columns', () => {
  assert.deepEqual(plain(buildLines(MOCKUP, { columns: 120 })), [...MOCKUP_LINES]);
});

test('buildLines colours by meaning: limit ok, context warn, cost and model', () => {
  const [header, context, session, sevenDay] = buildLines(MOCKUP, { columns: 120 });
  assert.equal(segmentWith(sevenDay, '39%').tone, TONE.ok);
  assert.equal(segmentWith(context, '54%').tone, TONE.warn);
  assert.equal(segmentWith(session, '$20.33').tone, TONE.cost);
  assert.equal(segmentWith(header, 'Opus 5.5').tone, TONE.model);
});

test('layout renders placeholders without limits', () => {
  const lines = buildLines({ ...MOCKUP, limits: { sevenDay: null, fiveHour: null } }, { columns: 120 });
  assert.equal(lineText(lines[3]), '7d  —');
  assert.equal(lineText(lines[4]), '5h  —');
  assert.ok(lines[3].every((segment) => segment.tone === TONE.muted));
});

test('layout narrow: 10-cell bars and no line below the full line width', () => {
  const [, context, , sevenDay] = buildLines(MOCKUP, { columns: 40 });
  assert.equal(lineText(context), 'ctx ■■■■■□□□□□ 54%  543k/1.0M');
  assert.ok(lineText(sevenDay).startsWith('7d  ■■■■□□□□□□ 39%'));
});

test('layout drops missing session items without doubled separators', () => {
  const lines = buildLines({ ...MOCKUP, costUsd: null, effort: null }, { columns: 120 });
  assert.equal(lineText(lines[2]), '    5h40m · cache 99%');
});

test('layout shows the branch and a dirty marker for a repository', () => {
  const lines = buildLines({ ...MOCKUP, git: { isRepo: true, branch: 'develop', isDirty: true } }, { columns: 120 });
  assert.equal(lineText(lines[0]), 'daily-claude | git develop* | ✦ Opus 5.5');
});

test('layout turns the whole limit red when the projection passes 100%', () => {
  // 52% after 2.5h of a 5h window → 20.8%/h → 104% at reset.
  const limits = { ...MOCKUP.limits, fiveHour: { percentUsed: 52, resetsAtMs: NOW + 9_000_000 } };
  const fiveHour = buildLines({ ...MOCKUP, limits }, { columns: 120 })[4];
  assert.equal(segmentWith(fiveHour, '■').tone, TONE.alert);
  assert.equal(segmentWith(fiveHour, '%/h').tone, TONE.alert);
});

test('layout of an empty snapshot is readable and never prints undefined or NaN', () => {
  const text = plain(buildLines(EMPTY, { columns: undefined })).join('\n');
  assert.doesNotMatch(text, /undefined|NaN|null/);
  assert.deepEqual(plain(buildLines(EMPTY, { columns: 120 })), [
    '— | no git | ✦ —',
    'ctx □□□□□□□□□□□□□□□□   —  —/—',
    '    —',
    '7d  —',
    '5h  —',
  ]);
});

test('the context line carries its history as a min→max series for drawing a real line', () => {
  const [, context] = buildLines(MOCKUP, { columns: 120 });
  const line = context.find((segment) => segment.series);
  assert.equal(line.text, '⣀⡠⠔⠊');
  assert.equal(line.tone, TONE.spark);
  assert.equal(line.series.length, 8);
  assert.equal(line.series[0], 0);
  assert.equal(line.series.at(-1), 1);
});

test('the full mockup line fits from 52 columns', () => {
  const [, context] = buildLines(MOCKUP, { columns: 52 });
  assert.equal(lineText(context), 'ctx ■■■■■■■■■□□□□□□□ 54%  543k/1.0M  ⣀⡠⠔⠊');
});
