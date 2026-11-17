import { test } from 'node:test';
import assert from 'node:assert/strict';
import { TONE_SGR, renderAnsi } from '../../src/terminal/ansi.mjs';
import { buildLines } from '../../src/core/layout.mjs';
import { TONE } from '../../src/core/thresholds.mjs';
import { MOCKUP, MOCKUP_LINES } from '../fixtures/snapshots.mjs';

const ESC = '\u001b';
const SGR = new RegExp(`${ESC}\\[[0-9;]*m`, 'g');
const lines = buildLines(MOCKUP, { columns: 120 });

test('every tone has an SGR code, so none prints uncoloured by accident', () => {
  for (const tone of Object.values(TONE).filter((tone) => tone !== TONE.plain)) {
    assert.match(TONE_SGR[tone] ?? '', /^[0-9;]+$/, tone);
  }
  assert.equal(TONE_SGR.added, '38;5;71');
  assert.equal(TONE_SGR.removed, '38;5;203');
});

test('renderAnsi without colour is exactly the plain text', () => {
  assert.equal(renderAnsi(lines, { color: false }), MOCKUP_LINES.join('\n'));
});

test('renderAnsi with colour changes nothing but the escape codes', () => {
  const out = renderAnsi(lines, { color: true });
  assert.ok(out.includes(`${ESC}[38;5;`));
  assert.equal(out.replace(SGR, ''), MOCKUP_LINES.join('\n'));
});

test('renderAnsi resets after every coloured segment', () => {
  const out = renderAnsi([[{ text: 'a', tone: 'ok' }, { text: 'b', tone: 'plain' }, { text: 'c', tone: 'alert' }]], { color: true });
  assert.equal(out, `${ESC}[38;5;71ma${ESC}[0mb${ESC}[1;38;5;203mc${ESC}[0m`);
});

// A folder or a branch can be named with an escape sequence in it; the terminal would act on it.
test('renderAnsi prints no control character of a text, only its own colour codes', () => {
  const hostile = [[{ text: `proj${ESC}[2J${ESC}]0;title\u0007\r\nect\u009b1m`, tone: 'accent' }, { text: `${ESC}\u0000`, tone: 'ok' }]];
  assert.equal(renderAnsi(hostile, { color: false }), 'proj[2J]0;titleect1m');
  assert.equal(renderAnsi(hostile, { color: true }), `${ESC}[1;38;5;75mproj[2J]0;titleect1m${ESC}[0m`);
});

test('renderAnsi skips empty segments instead of emitting bare escape codes', () => {
  assert.equal(renderAnsi([[{ text: '', tone: 'ok' }, { text: 'x', tone: 'plain' }]], { color: true }), 'x');
});

test('renderAnsi prints an unknown tone as plain text', () => {
  assert.equal(renderAnsi([[{ text: 'x', tone: 'nope' }]], { color: true }), 'x');
});
