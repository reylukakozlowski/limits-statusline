// Status-line stdin JSON (https://code.claude.com/docs/en/statusline) → core Snapshot.
// Every field is optional and type-checked: older Claude Code versions send fewer fields.

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
 * @param {{ nowMs: number, git: import('../core/git-status.mjs').GitState | null, contextHistory: number[] }} extras
 * @returns {import('../core/layout.mjs').Snapshot}
 */
export function snapshotFromStatusInput(input, { nowMs, git, contextHistory }) {
  const data = record(input);
  const workspace = record(data.workspace);
  const model = record(data.model);
  const cost = record(data.cost);
  const context = record(data.context_window);
  const limits = record(data.rate_limits);
  return {
    nowMs,
    project: text(record(workspace.repo).name)
      ?? folderName(text(workspace.project_dir) ?? workingDirectory(data)),
    git: git ?? null,
    modelName: prettyModelName(text(model.display_name) ?? text(model.id)),
    costUsd: number(cost.total_cost_usd),
    durationMs: number(cost.total_duration_ms),
    cacheHitRatio: number(record(data.prompt_cache).hit_ratio) ?? cacheFromUsage(context.current_usage),
    effort: text(record(data.effort).level),
    context: {
      usedTokens: number(context.total_input_tokens),
      windowTokens: number(context.context_window_size),
      percent: number(context.used_percentage),
    },
    contextHistory: Array.isArray(contextHistory) ? contextHistory : [],
    limits: {
      sevenDay: limitReading(limits.seven_day),
      fiveHour: limitReading(limits.five_hour),
    },
  };
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
