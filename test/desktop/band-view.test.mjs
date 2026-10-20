import { test } from 'node:test';
import assert from 'node:assert/strict';
import { TONE_COLOR, renderBand } from '../../src/desktop/band-view.mjs';
import { shouldDraw, supportsTypography } from '../../src/desktop/policy.mjs';
import { TONE } from '../../src/core/thresholds.mjs';

const Box = 'Box';
const Text = 'Text';
const h = (tag, props, ...children) => ({ tag, props: props ?? {}, children });

test('every tone maps to a theme colour key except plain', () => {
  for (const tone of Object.values(TONE).filter((tone) => tone !== TONE.plain)) {
    assert.equal(typeof TONE_COLOR[tone], 'string', tone);
  }
  assert.equal(TONE_COLOR.alert, 'error');
  assert.equal(TONE_COLOR.ok, 'success');
});

test('renderBand draws one truncating Text row per line, one coloured Text per segment', () => {
  const lines = [
    [{ text: '7d  ', tone: TONE.muted }, { text: '39%', tone: TONE.ok }],
    [{ text: 'plain', tone: TONE.plain }],
  ];
  const tree = renderBand(lines, { Box, Text }, h);
  assert.equal(tree.tag, 'Box');
  assert.equal(tree.props.flexDirection, 'column');
  assert.equal(tree.children.length, 2);
  const [first, second] = tree.children;
  assert.deepEqual(first.props, { wrap: 'truncate-end' });
  assert.deepEqual(first.children.map((child) => [child.props.color, child.children[0]]),
    [['subtle', '7d  '], ['success', '39%']]);
  assert.deepEqual(second.children[0].props, {});
});

test('renderBand makes accent and alert bold and drops empty segments', () => {
  const tree = renderBand([[{ text: '', tone: TONE.ok }, { text: 'x', tone: TONE.alert }]], { Box, Text }, h);
  const [segment] = tree.children[0].children;
  assert.deepEqual(segment.props, { color: 'error', bold: true });
  assert.equal(tree.children[0].children.length, 1);
});

test('shouldDraw: desktop by default, all adds the terminal, off draws nowhere', () => {
  assert.equal(shouldDraw('desktop', 'desktop'), true);
  assert.equal(shouldDraw('desktop', 'terminal'), false);
  assert.equal(shouldDraw('all', 'terminal'), true);
  assert.equal(shouldDraw('all', 'desktop'), true);
  assert.equal(shouldDraw('all', 'mobile'), false);
  assert.equal(shouldDraw('off', 'desktop'), false);
  assert.equal(shouldDraw(undefined, 'desktop'), true);
  assert.equal(shouldDraw('nonsense', 'terminal'), false);
});

test('supportsTypography: mono and tabular text only from Claude Code 2.1.299', () => {
  for (const version of ['2.1.299', '2.1.300', '2.2.0', '3.0.0', '2.1.299-dev']) assert.equal(supportsTypography(version), true, version);
  for (const version of ['2.1.298', '2.0.999', '1.9.0', 'garbage', undefined]) assert.equal(supportsTypography(version), false, String(version));
});

test('renderBand asks for the monospaced face with equal-width digits when the app supports it', () => {
  const tree = renderBand([[{ text: 'x', tone: TONE.plain }]], { Box, Text }, h, { typography: true });
  assert.deepEqual(tree.children[0].props, { wrap: 'truncate-end', mono: true, tabular: true });
});

const CONTEXT_LINE = [
  { text: 'ctx ', tone: TONE.muted },
  { text: '  ', tone: TONE.plain },
  { text: '⣀⡠', tone: TONE.spark, series: [0, 0.5, 1] },
];

test('renderBand draws a line chart as SVG next to the row text where the surface has Svg', () => {
  const tree = renderBand([CONTEXT_LINE], { Box, Text, Svg: 'Svg' }, h, { typography: true });
  const row = tree.children[0];
  assert.equal(row.tag, 'Box');
  assert.equal(row.props.flexDirection, 'row');
  const [text, chart] = row.children;
  assert.equal(text.tag, 'Text');
  assert.deepEqual(text.children.map((child) => child.children[0]), ['ctx ', '  ']);
  assert.equal(chart.tag, 'Svg');
  assert.match(chart.props.source, /^<svg .*<polyline .*points="[^"]+"\/><\/svg>$/);
  assert.equal(chart.props.alt, 'Context window fill over the session');
});

test('renderBand keeps the braille line where the surface has no Svg', () => {
  const row = renderBand([CONTEXT_LINE], { Box, Text }, h).children[0];
  assert.equal(row.tag, 'Text');
  assert.equal(row.children.at(-1).children[0], '⣀⡠');
});
