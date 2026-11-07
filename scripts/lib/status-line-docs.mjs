// Anthropic's status line page → the input it documents. Two parts of the page describe that
// input: the example under "Full JSON schema", whose leaves give every field's path and the type of
// its example value, and the field tables, whose descriptions state the units ("from 0 to 100",
// "Unix epoch seconds"). This module knows the page's layout and nothing of the plugin;
// status-line-contract.mjs compares the result with what the plugin reads.

/** The page, as markdown; the Compatibility workflow downloads it from here. */
export const STATUS_LINE_PAGE = 'https://code.claude.com/docs/en/statusline.md';

/** @typedef {'string' | 'number' | 'boolean' | 'array' | 'object' | 'null'} JsonType */
/**
 * @typedef {{ types: Map<string, JsonType>, descriptions: Map<string, string> }} DocumentedInput
 * types: each leaf of the example (a dotted path such as `rate_limits.five_hour.resets_at`) and the
 * type of its example value; descriptions: each field a table row names, with the row's description.
 */

// The example's title on a line of its own: `> [accordion] Full JSON schema`, or as a heading.
const EXAMPLE_TITLE = /^\s*(?:>\s*)*(?:\[[\w-]+\]\s*|#{1,6}\s+)?full json schema\s*$/i;
const QUOTE_MARKS = /^\s*(?:>\s?)+/;
const FENCE = /^\s*```/;
const FENCE_OPEN = /^```json\b/;
const FENCE_CLOSE = /^```\s*$/;
const FIELD_NAME = /`([A-Za-z_][\w.]*)`/g;
// "### Prompt cache fields": a table under such a heading names the fields of one object
// (`prompt_cache`) by their bare names (`hit_ratio`).
const OBJECT_SECTION = /^#{2,6}\s+(.+?)\s+fields\s*$/i;
const HEADING = /^#{1,6}\s/;

/**
 * @param {string} markdown the page as markdown
 * @returns {DocumentedInput | null} null when the layout is not the page's: no example that parses
 *   as a JSON object with fields, or no field table
 */
export function parseStatusLineDocs(markdown) {
  const lines = String(markdown).replace(/\r\n?/g, '\n').split('\n');
  const example = exampleObject(lines);
  if (example === null || Object.keys(example).length === 0) return null;
  const types = new Map();
  collectLeaves(example, '', types);
  const descriptions = tableDescriptions(lines, types);
  return descriptions.size === 0 ? null : { types, descriptions };
}

/**
 * The JSON code block under the "Full JSON schema" title, read through any blockquote. The page has
 * other JSON blocks (settings examples), so the block has to come before the next heading.
 */
function exampleObject(lines) {
  const title = lines.findIndex((line) => EXAMPLE_TITLE.test(line));
  if (title === -1) return null;
  const body = [];
  let inside = false;
  for (const line of lines.slice(title + 1).map((text) => text.replace(QUOTE_MARKS, ''))) {
    if (!inside) {
      if (HEADING.test(line)) return null;
      inside = FENCE_OPEN.test(line);
      continue;
    }
    if (FENCE_CLOSE.test(line)) return parseObject(body.join('\n'));
    body.push(line);
  }
  return null;
}

function parseObject(text) {
  try {
    const value = JSON.parse(text);
    return jsonType(value) === 'object' ? value : null;
  } catch {
    return null;
  }
}

/** @returns {JsonType} */
function jsonType(value) {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'array';
  return /** @type {JsonType} */ (typeof value);
}

function collectLeaves(value, path, types) {
  if (jsonType(value) === 'object' && Object.keys(value).length > 0) {
    for (const [key, child] of Object.entries(value)) collectLeaves(child, path ? `${path}.${key}` : key, types);
    return;
  }
  types.set(path, jsonType(value));
}

/**
 * Rows of two-cell tables whose first cell names fields in backticks; code blocks are skipped. A
 * table with more cells (the subagent status line's `Field | Type | Description`) describes another
 * input and is left out. A field named twice keeps its first row: the field table comes first.
 */
function tableDescriptions(lines, types) {
  const descriptions = new Map();
  let object = null;
  let inCode = false;
  for (const line of lines) {
    if (FENCE.test(line.replace(QUOTE_MARKS, ''))) inCode = !inCode;
    if (inCode) continue;
    if (HEADING.test(line)) {
      object = sectionObject(line, types);
      continue;
    }
    const cells = tableCells(line);
    if (cells === null || cells.length !== 2) continue;
    const [names, description] = cells;
    for (const [, name] of names.matchAll(FIELD_NAME)) {
      const path = object && !name.includes('.') ? `${object}.${name}` : name;
      if (!descriptions.has(path)) descriptions.set(path, description);
    }
  }
  return descriptions;
}

/** `prompt_cache` for "### Prompt cache fields" when the example has that object, otherwise null. */
function sectionObject(heading, types) {
  const match = OBJECT_SECTION.exec(heading);
  if (!match) return null;
  const object = match[1].trim().toLowerCase().replace(/\s+/g, '_');
  return [...types.keys()].some((path) => path.startsWith(`${object}.`)) ? object : null;
}

/** The cells of a markdown table row, or null for any other line (separator rows included). */
function tableCells(line) {
  const row = line.trim();
  if (!row.startsWith('|') || !row.endsWith('|') || /^\|[\s|:-]+\|$/.test(row)) return null;
  return row.slice(1, -1).split(/(?<!\\)\|/).map((cell) => cell.trim());
}
