// Status-line stdin JSON (https://code.claude.com/docs/en/statusline) → core Snapshot.
// Every field is optional and type-checked: older Claude Code versions send fewer fields.

import { EMPTY_LIMIT_HISTORY } from '../core/limit-history.mjs';
import { cacheHitRatio } from '../core/metrics.mjs';
import { prettyModelName } from '../core/model-name.mjs';
import { folderName } from '../core/paths.mjs';
import { numberOrNull as number, recordOf as record, textOrNull as text } from '../core/values.mjs';

const MS_PER_SECOND = 1000;

/** The directory the session works in, or null. */
export function workingDirectory(input) {
  const data = record(input);
  return text(record(data.workspace).current_dir) ?? text(data.cwd);
}

/**
 * @param {unknown} input parsed stdin JSON
 * @param {{ nowMs: number, git: import('../core/git-status.mjs').GitState | null, contextHistory: number[],
 *           timeZone?: string | null, limitHistory?: import('../core/limit-history.mjs').LimitHistory }} extras
 *   `limitHistory`: the shared history, for the pace and for which windows the account has
 * @returns {import('../core/layout.mjs').Snapshot}
 */
export function snapshotFromStatusInput(input, { nowMs, git, contextHistory, timeZone = null, limitHistory = EMPTY_LIMIT_HISTORY }) {
  const data = record(input);
  const workspace = record(data.workspace);
  const model = record(data.model);
  const cost = record(data.cost);
  const context = record(data.context_window);
  return {
    nowMs,
    timeZone,
    project: text(record(workspace.repo).name)
      ?? folderName(text(workspace.project_dir) ?? workingDirectory(data)),
    git: git ?? null,
    modelName: prettyModelName(text(model.display_name) ?? text(model.id)),
    costUsd: number(cost.total_cost_usd),
    durationMs: number(cost.total_duration_ms),
    cacheHitRatio: number(record(data.prompt_cache).hit_ratio) ?? cacheFromUsage(context.current_usage),
    promptCache: promptCacheState(data.prompt_cache),
    effort: text(record(data.effort).level),
    fastMode: typeof data.fast_mode === 'boolean' ? data.fast_mode : null,
    linesChanged: linesChanged(cost),
    context: {
      usedTokens: number(context.total_input_tokens),
      windowTokens: number(context.context_window_size),
      percent: number(context.used_percentage),
    },
    contextHistory: Array.isArray(contextHistory) ? contextHistory : [],
    limits: limitsFromStatusInput(data),
    limitReadings: limitHistory.readings,
    limitsSeenAtMs: limitHistory.seenAtMs,
    spendLimit: spendLimitFromStatusInput(data),
  };
}

/**
 * `rate_limits.spend_limit`, which a Claude apps gateway sends: the share used and the reset with
 * every response, the amounts in US dollars when it has them.
 * @param {unknown} input parsed stdin JSON
 * @returns {import('../core/layout.mjs').SpendLimit | null}
 */
export function spendLimitFromStatusInput(input) {
  const {
    used_percentage: used, resets_at: resetsAt, used_usd: usedUsd, limit_usd: limitUsd,
  } = record(record(record(input).rate_limits).spend_limit);
  if (number(used) === null) return null;
  return {
    percentUsed: used,
    resetsAtMs: number(resetsAt) === null ? null : resetsAt * MS_PER_SECOND,
    usedUsd: number(usedUsd),
    limitUsd: number(limitUsd),
  };
}

/**
 * The 7-day and 5-hour readings of `rate_limits`.
 * @param {unknown} input parsed stdin JSON
 * @returns {import('../core/limit-history.mjs').Limits}
 */
export function limitsFromStatusInput(input) {
  const limits = record(record(input).rate_limits);
  return { sevenDay: limitReading(limits.seven_day), fiveHour: limitReading(limits.five_hour) };
}

function limitReading(window) {
  const { used_percentage: used, resets_at: resetsAt } = record(window);
  if (!Number.isFinite(used)) return null;
  return { percentUsed: used, resetsAtMs: Number.isFinite(resetsAt) ? resetsAt * MS_PER_SECOND : null };
}

function cacheFromUsage(usage) {
  if (usage === null || typeof usage !== 'object') return null;
  return cacheHitRatio({
    inputTokens: usage.input_tokens,
    cacheCreationTokens: usage.cache_creation_input_tokens,
    cacheReadTokens: usage.cache_read_input_tokens,
  });
}

// `prompt_cache.warm` and `expires_at` (epoch seconds, null once cold), Claude Code 2.1.251+.
function promptCacheState(promptCache) {
  const { warm, expires_at: expiresAt } = record(promptCache);
  const expiresAtSeconds = number(expiresAt);
  const state = {
    warm: typeof warm === 'boolean' ? warm : null,
    expiresAtMs: expiresAtSeconds === null ? null : expiresAtSeconds * MS_PER_SECOND,
  };
  return state.warm === null && state.expiresAtMs === null ? null : state;
}

const count = (value) => (number(value) !== null && value >= 0 ? value : null);

function linesChanged(cost) {
  const added = count(cost.total_lines_added);
  const removed = count(cost.total_lines_removed);
  return added === null && removed === null ? null : { added: added ?? 0, removed: removed ?? 0 };
}
