// The stand-in for Anthropic's status line page (status-line-docs.md) and the edits the tests make
// to it, as Anthropic could. Each edit has to find its text: an edit that silently changed nothing
// would let a test pass for the wrong reason.

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

// CRLF from a clone with core.autocrlf would otherwise defeat the edits below.
export const PAGE = readFileSync(new URL('./status-line-docs.md', import.meta.url), 'utf8').replace(/\r\n/g, '\n');

/** The page with each [from, to] replaced once. */
export const edited = (...edits) => edits.reduce((page, [from, to]) => {
  assert.ok(page.includes(from), `the page has ${JSON.stringify(from)}`);
  return page.replace(from, to);
}, PAGE);

/** The page with its "Full JSON schema" example replaced by `json`, still inside the blockquote. */
export function withExample(json) {
  const example = /(> ```json[^\n]*\n)[\s\S]*?(\n> ```)/;
  assert.match(PAGE, example);
  return PAGE.replace(example, (_, open, close) => `${open}${json.split('\n').map((line) => `> ${line}`).join('\n')}${close}`);
}

/** The page's line for a table row that names `name` in backticks first. */
export function rowOf(name) {
  const row = PAGE.split('\n').find((line) => line.startsWith(`| \`${name}\``));
  assert.ok(row, `the page has a row for ${name}`);
  return row;
}
