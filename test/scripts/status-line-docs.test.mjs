// The parser of Anthropic's status line page, against test/fixtures/status-line-docs.md, a stand-in
// in the page's layout of 2026-11-07. Expected values are the fixture's own rows and example.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseStatusLineDocs } from '../../scripts/lib/status-line-docs.mjs';
import { edited, PAGE, withExample } from '../fixtures/status-line-page.mjs';

const parsed = (markdown = PAGE) => {
  const documented = parseStatusLineDocs(markdown);
  assert.ok(documented, 'the page parses');
  return documented;
};
const SETTINGS = '```json\n{ "statusLine": { "type": "command", "command": "~/.claude/statusline.sh" } }\n```\n';

test('the example gives each leaf by its dotted path with the type of its example value', () => {
  const { types } = parsed();
  assert.equal(types.get('rate_limits.five_hour.resets_at'), 'number');
  assert.equal(types.get('model.display_name'), 'string');
  assert.equal(types.get('prompt_cache.warm'), 'boolean');
  assert.equal(types.get('context_window.current_usage.cache_read_input_tokens'), 'number');
  // Objects are not fields of their own: only their leaves are.
  assert.equal(types.has('rate_limits'), false);
  assert.equal(types.has('rate_limits.five_hour'), false);
  assert.equal(types.size, 32); // the leaves of the fixture's example, counted by hand
});

test('the example\'s arrays, nulls and empty objects keep their own types', () => {
  const { types } = parsed(withExample('{ "a": [1], "b": null, "c": {}, "d": { "e": false } }'));
  assert.deepEqual(Object.fromEntries(types), { a: 'array', b: 'null', c: 'object', 'd.e': 'boolean' });
});

test('the example may sit in a nested blockquote, or under a heading of that title without one', () => {
  const nested = PAGE.split('\n').map((line) => (line.startsWith('>') ? `> ${line}` : line)).join('\n');
  assert.equal(parsed(nested).types.get('rate_limits.five_hour.resets_at'), 'number');
  const heading = edited(['> [accordion] Full JSON schema', '### Full JSON schema'])
    .split('\n').map((line) => line.replace(/^> ?/, '')).join('\n');
  assert.equal(parsed(heading).types.get('rate_limits.five_hour.resets_at'), 'number');
});

test('only the JSON block under the example\'s own title is the example, not another JSON block', () => {
  const before = edited(['## Available data\n', `See the Full JSON schema below.\n\n${SETTINGS}\n## Available data\n`]);
  assert.equal(parsed(before).types.get('rate_limits.five_hour.resets_at'), 'number');
  assert.equal(parsed(before).types.has('statusLine.type'), false);
  // A title whose block went away does not borrow a JSON block from a later section.
  const exampleBlock = /> ```json[^\n]*\n[\s\S]*?\n> ```\n/;
  assert.match(PAGE, exampleBlock);
  const withoutBlock = edited(['## Subagent status lines\n', `## Subagent status lines\n\n${SETTINGS}`]).replace(exampleBlock, '');
  assert.equal(parseStatusLineDocs(withoutBlock), null);
});

test('every field a two-cell row names gets that row\'s description, and nothing else is a field', () => {
  const { descriptions } = parsed();
  assert.equal(descriptions.get('rate_limits.five_hour.used_percentage'), 'How much of the window is used, from 0 to 100');
  assert.equal(descriptions.get('rate_limits.seven_day.used_percentage'), 'How much of the window is used, from 0 to 100');
  assert.equal(descriptions.get('workspace.repo.name'), 'Host, owner and name of the `origin` remote');
  assert.deepEqual([...descriptions.keys()].sort(), [
    'context_window.context_window_size', 'context_window.current_usage', 'context_window.total_input_tokens',
    'context_window.total_output_tokens', 'context_window.used_percentage', 'cost.total_cost_usd',
    'cost.total_duration_ms', 'cost.total_lines_added', 'cost.total_lines_removed', 'cwd', 'effort.level',
    'model.display_name', 'model.id', 'prompt_cache', 'prompt_cache.expires_at', 'prompt_cache.hit_ratio',
    'prompt_cache.ttl', 'prompt_cache.warm', 'rate_limits.five_hour.resets_at',
    'rate_limits.five_hour.used_percentage', 'rate_limits.seven_day.resets_at',
    'rate_limits.seven_day.used_percentage', 'session_id', 'transcript_path', 'version',
    'workspace.current_dir', 'workspace.project_dir', 'workspace.repo.host', 'workspace.repo.name',
    'workspace.repo.owner',
  ]);
});

test('the bare names under "Prompt cache fields" are the fields of prompt_cache', () => {
  const { descriptions } = parsed();
  assert.equal(descriptions.get('prompt_cache.hit_ratio'), 'Cache reads as a share of all input, from 0 to 1.');
  assert.equal(descriptions.get('prompt_cache.expires_at'), 'When the cache goes cold, in epoch seconds');
  assert.equal(descriptions.has('hit_ratio'), false);
});

test('a bare name under a "… fields" heading stays bare when the example has no such object', () => {
  const page = `${PAGE}\n### Spend limit fields\n\n| Field | Description |\n| - | - |\n| \`period\` | daily, weekly or monthly |\n`;
  const { descriptions } = parsed(page);
  assert.equal(descriptions.get('period'), 'daily, weekly or monthly');
  assert.equal(descriptions.has('spend_limit.period'), false);
});

test('the subagent table, with its Type column, describes another input and leaves the main fields alone', () => {
  const { descriptions } = parsed();
  assert.equal(descriptions.get('cwd'), 'The working directory; both fields hold the same path');
  assert.equal(descriptions.has('id'), false);
});

// The field table comes first; a later example or table that names a field again (a script's
// sample output, a troubleshooting table) must not replace its description.
test('a field keeps the description of its first row, and rows inside code blocks are not rows', () => {
  const later = `${PAGE}\n## Troubleshooting\n\n| Symptom | Fix |\n| - | - |\n| \`cost.total_duration_ms\` | shows 0 at start |\n`;
  assert.equal(parsed(later).descriptions.get('cost.total_duration_ms'), 'How long the session has run, in milliseconds');
  const sample = edited(['## Available data\n', '```text\n| `version` | a sample line a script prints |\n```\n\n## Available data\n']);
  assert.equal(parsed(sample).descriptions.get('version'), 'Claude Code\'s version');
});

test('an escaped pipe stays inside its cell', () => {
  const page = edited(['| `version` | Claude Code\'s version |', '| `version` | major \\| minor \\| patch |']);
  assert.equal(parsed(page).descriptions.get('version'), 'major \\| minor \\| patch');
});

test('a page with CRLF line endings parses the same', () => {
  assert.deepEqual(parsed(PAGE.replace(/\n/g, '\r\n')), parsed());
});

test('a page without its example, or without a field table, is not the page: null', () => {
  const pages = {
    empty: '',
    'an HTML error page': '<!doctype html><title>502 Bad Gateway</title><h1>502</h1>',
    'no example title': edited(['> [accordion] Full JSON schema', '> [accordion] Schema']),
    'no closing fence': edited(['\n> ```\n', '\n']),
    'broken JSON': withExample('{ "cwd": '),
    'an array': withExample('[{ "cwd": "/" }]'),
    'an empty object': withExample('{}'),
    'no field table': PAGE.split('\n').filter((line) => !line.startsWith('|')).join('\n'),
  };
  for (const [name, page] of Object.entries(pages)) assert.equal(parseStatusLineDocs(page), null, name);
});
