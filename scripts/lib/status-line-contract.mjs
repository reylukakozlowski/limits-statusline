// The status line input the plugin depends on, and the check of Anthropic's page against it. The
// contract lists every stdin field the terminal status line reads (src/terminal/snapshot.mjs and
// src/terminal/run.mjs), with the type and, where the plugin relies on one, the unit the page
// states for it; test/scripts/status-line-contract-drift.test.mjs fails when the code reads a
// field the contract does not list. A field the page stops documenting, or documents with another
// type or unit, breaks the contract; a field the page newly documents is only news.

/** @typedef {import('./status-line-docs.mjs').JsonType} JsonType */
/** @typedef {import('./status-line-docs.mjs').DocumentedInput} DocumentedInput */
/** @typedef {{ expectation: string, pattern: RegExp }} Unit what the field's description has to say */
/** @typedef {{ path: string, type: JsonType, unit: Unit | null }} ContractField */
/**
 * @typedef {{
 *   ok: boolean,
 *   checked: number,
 *   missing: string[],
 *   retyped: { path: string, expected: JsonType, documented: JsonType }[],
 *   unitChanged: { path: string, expected: string, documented: string | null }[],
 *   newFields: string[],
 * }} ContractReport
 * ok: no field the plugin reads went missing or changed type or unit; newFields never affect it.
 */

const escapeRegExp = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * The unit as a whole phrase: "from 0 to 1" is found in "from 0 to 1." and not in "from 0 to 100"
 * or "from 0 to 1.5".
 */
const unit = (expectation) => Object.freeze({
  expectation,
  pattern: new RegExp(`(?<!\\w)${escapeRegExp(expectation)}(?!\\w|\\.\\d)`, 'i'),
});

/** @returns {ContractField} */
const field = (path, type, expectedUnit = null) => Object.freeze({ path, type, unit: expectedUnit });

// The units are those the page stated on 2026-11-07 for the fields whose unit the code relies on:
// seconds it multiplies by 1000, percentages it draws against 100, a ratio from 0 to 1. For the
// context's `used_percentage` the page states no range, only that it is a percentage.
/** @type {readonly ContractField[]} */
export const STATUS_LINE_CONTRACT = Object.freeze([
  // The project name and the git folder (snapshot.mjs project and workingDirectory).
  field('cwd', 'string'),
  field('workspace.current_dir', 'string'),
  field('workspace.project_dir', 'string'),
  field('workspace.repo.name', 'string'),
  field('model.id', 'string'),
  field('model.display_name', 'string'),
  field('cost.total_cost_usd', 'number', unit('USD')),
  field('cost.total_duration_ms', 'number', unit('milliseconds')),
  field('cost.total_lines_added', 'number'),
  field('cost.total_lines_removed', 'number'),
  field('context_window.total_input_tokens', 'number'),
  field('context_window.context_window_size', 'number', unit('tokens')),
  field('context_window.used_percentage', 'number', unit('percentage')),
  // The cache ratio when `prompt_cache.hit_ratio` is absent (snapshot.mjs cacheFromUsage).
  field('context_window.current_usage.input_tokens', 'number'),
  field('context_window.current_usage.cache_creation_input_tokens', 'number'),
  field('context_window.current_usage.cache_read_input_tokens', 'number'),
  field('prompt_cache.warm', 'boolean'),
  field('prompt_cache.expires_at', 'number', unit('epoch seconds')),
  field('prompt_cache.hit_ratio', 'number', unit('from 0 to 1')),
  field('effort.level', 'string'),
  field('rate_limits.five_hour.used_percentage', 'number', unit('from 0 to 100')),
  field('rate_limits.five_hour.resets_at', 'number', unit('Unix epoch seconds')),
  field('rate_limits.seven_day.used_percentage', 'number', unit('from 0 to 100')),
  field('rate_limits.seven_day.resets_at', 'number', unit('Unix epoch seconds')),
  // The keys of the context and limit histories (run.mjs).
  field('session_id', 'string'),
  field('transcript_path', 'string'),
]);

// Everything else the page documented on 2026-11-07, which the plugin leaves unread. Only the
// Compatibility workflow checks this list against the real page: a field it lacks is reported as
// newly documented.
/** @type {readonly string[]} */
export const UNREAD_FIELDS = Object.freeze([
  'agent.name',
  'context_window.current_usage.output_tokens',
  'context_window.remaining_percentage',
  'context_window.total_output_tokens',
  'cost.total_api_duration_ms',
  'exceeds_200k_tokens',
  'fast_mode',
  'output_style.name',
  'pr.kind',
  'pr.number',
  'pr.review_state',
  'pr.url',
  'prompt_cache.cache_write_tokens',
  'prompt_cache.caching_observed',
  'prompt_cache.expected_rebuilds',
  'prompt_cache.last_miss_at',
  'prompt_cache.last_miss_cause.causes',
  'prompt_cache.last_miss_cause.tools_added',
  'prompt_cache.last_miss_cause.tools_removed',
  'prompt_cache.miss_causes.tools_changed',
  'prompt_cache.miss_recache_tokens',
  'prompt_cache.misses',
  'prompt_cache.recache_tokens_if_cold',
  'prompt_cache.requests',
  'prompt_cache.ttl',
  'prompt_id',
  'rate_limits.spend_limit.limit_usd',
  'rate_limits.spend_limit.period',
  'rate_limits.spend_limit.resets_at',
  'rate_limits.spend_limit.used_percentage',
  'rate_limits.spend_limit.used_usd',
  'session_name',
  'thinking.enabled',
  'version',
  'vim.mode',
  'workspace.added_dirs',
  'workspace.git_worktree',
  'workspace.repo.host',
  'workspace.repo.owner',
  'worktree.branch',
  'worktree.name',
  'worktree.original_branch',
  'worktree.original_cwd',
  'worktree.path',
]);

/**
 * A field counts as documented when the example or a table names it; its type is checked where
 * the example has it, its unit against the description of its table row.
 * @param {DocumentedInput} documented
 * @param {{ unread?: readonly string[] }} [options] the fields not to report as new
 * @returns {ContractReport}
 */
export function checkContract({ types, descriptions }, { unread = UNREAD_FIELDS } = {}) {
  const missing = [];
  const retyped = [];
  const unitChanged = [];
  for (const { path, type, unit: expected } of STATUS_LINE_CONTRACT) {
    if (!types.has(path) && !descriptions.has(path)) {
      missing.push(path);
      continue;
    }
    if (types.has(path) && types.get(path) !== type) retyped.push({ path, expected: type, documented: types.get(path) });
    const description = descriptions.get(path) ?? null;
    if (expected && !statesUnit(description, expected)) {
      unitChanged.push({ path, expected: expected.expectation, documented: description });
    }
  }
  const known = new Set([...STATUS_LINE_CONTRACT.map((entry) => entry.path), ...unread]);
  const newFields = documentedFields(types, descriptions).filter((path) => !known.has(path));
  return {
    ok: missing.length === 0 && retyped.length === 0 && unitChanged.length === 0,
    checked: STATUS_LINE_CONTRACT.length,
    missing,
    retyped,
    unitChanged,
    newFields,
  };
}

/** @param {string | null} description @param {Unit} expected */
const statesUnit = (description, expected) => description !== null && expected.pattern.test(description);

/**
 * The example's leaves and the fields a table names, sorted; a table row for an object whose
 * fields the example lists (`prompt_cache`) is not a field of its own.
 */
function documentedFields(types, descriptions) {
  const leaves = [...types.keys()];
  const objects = (path) => leaves.some((leaf) => leaf.startsWith(`${path}.`));
  const tableOnly = [...descriptions.keys()].filter((path) => !types.has(path) && !objects(path));
  return [...leaves, ...tableOnly].sort();
}
