import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sparklineSvg } from '../../src/desktop/sparkline-svg.mjs';

test('sparklineSvg draws the series as one polyline, bottom-left to top-right', () => {
  const svg = sparklineSvg([0, 1], { width: 100, height: 20, color: '#5fafaf' });
  assert.match(svg, /^<svg xmlns="http:\/\/www\.w3\.org\/2000\/svg" width="100" height="20" viewBox="0 0 100 20">/);
  assert.match(svg, /<polyline fill="none" stroke="#5fafaf" stroke-width="1\.5"[^>]* points="1,19 99,1"\/>/);
  assert.match(svg, /<\/svg>$/);
});

test('sparklineSvg fills the area under the line with a see-through shade of the stroke, behind it', () => {
  const svg = sparklineSvg([0, 1], { width: 100, height: 20, color: '#5fafaf' });
  assert.match(svg, /<polygon fill="#5fafaf" fill-opacity="0\.2" stroke="none" points="1,19 1,19 99,1 99,19"\/>/);
  assert.ok(svg.indexOf('<polygon') < svg.indexOf('<polyline'), 'the line is drawn over its fill');
});

test('sparklineSvg spaces points evenly and clamps values into the box', () => {
  const svg = sparklineSvg([0, 0.5, 2], { width: 100, height: 20, color: '#000' });
  assert.match(svg, /points="1,19 50,10 99,1"/);
});

test('sparklineSvg draws a single point as a flat line and nothing for no points', () => {
  assert.match(sparklineSvg([0.5], { width: 100, height: 20, color: '#000' }), /points="1,10 99,10"/);
  assert.equal(sparklineSvg([], { width: 100, height: 20, color: '#000' }), '');
});

test('sparklineSvg refuses a colour that could break out of the attribute', () => {
  assert.throws(() => sparklineSvg([0, 1], { width: 10, height: 10, color: '"/><script>' }), /colour/);
});
