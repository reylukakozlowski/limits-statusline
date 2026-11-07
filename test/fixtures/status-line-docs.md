<!--
A stand-in for https://code.claude.com/docs/en/statusline.md in its layout of 2026-11-07: the field
table, the "Full JSON schema" example inside a blockquote, the prompt cache table that names its
fields by their bare names, and the subagent table with its Type column. The descriptions are this
repository's own words; they keep the units the page states for the fields the plugin reads.
-->

# Customize your status line

## Available data

Claude Code sends these fields to your script on stdin:

| Field | Description |
| - | - |
| `model.id`, `model.display_name` | The model's id and its display name |
| `cwd`, `workspace.current_dir` | The working directory; both fields hold the same path |
| `workspace.project_dir` | The directory the session started in |
| `workspace.repo.host`, `workspace.repo.owner`, `workspace.repo.name` | Host, owner and name of the `origin` remote |
| `cost.total_cost_usd` | The session's estimated cost in USD |
| `cost.total_duration_ms` | How long the session has run, in milliseconds |
| `cost.total_lines_added`, `cost.total_lines_removed` | Lines changed |
| `context_window.total_input_tokens`, `context_window.total_output_tokens` | Tokens in the context window |
| `context_window.context_window_size` | The window's size in tokens |
| `context_window.used_percentage` | The percentage of the window in use |
| `context_window.current_usage` | Token counts of the last call |
| `effort.level` | The session's effort level |
| `rate_limits.five_hour.used_percentage`, `rate_limits.seven_day.used_percentage` | How much of the window is used, from 0 to 100 |
| `rate_limits.five_hour.resets_at`, `rate_limits.seven_day.resets_at` | When the window resets, in Unix epoch seconds |
| `prompt_cache` | Cache statistics, described below |
| `session_id` | The session's id |
| `transcript_path` | The transcript file |
| `version` | Claude Code's version |

> [accordion] Full JSON schema
>
> Your status line command receives this JSON on stdin:
>
> ```json theme={null}
> {
>   "cwd": "/work/project",
>   "session_id": "abc123",
>   "transcript_path": "/work/transcript.jsonl",
>   "model": { "id": "claude-opus-5-5", "display_name": "Opus" },
>   "workspace": {
>     "current_dir": "/work/project",
>     "project_dir": "/work/project",
>     "repo": { "host": "github.com", "owner": "someone", "name": "project" }
>   },
>   "version": "2.1.319",
>   "cost": { "total_cost_usd": 0.5, "total_duration_ms": 1000, "total_lines_added": 3, "total_lines_removed": 1 },
>   "context_window": {
>     "total_input_tokens": 1500,
>     "total_output_tokens": 20,
>     "context_window_size": 1000000,
>     "used_percentage": 1,
>     "current_usage": { "input_tokens": 100, "output_tokens": 20, "cache_creation_input_tokens": 400, "cache_read_input_tokens": 1000 }
>   },
>   "prompt_cache": { "warm": true, "ttl": "1h", "expires_at": 1800003120, "hit_ratio": 0.6 },
>   "effort": { "level": "high" },
>   "rate_limits": {
>     "five_hour": { "used_percentage": 12, "resets_at": 1800015000 },
>     "seven_day": { "used_percentage": 39, "resets_at": 1800274200 }
>   }
> }
> ```

### Prompt cache fields

The timestamps below are in epoch seconds.

| Field | Description |
| - | - |
| `warm` | Whether the cache is warm |
| `ttl` | The cache lifetime, `"5m"` or `"1h"` |
| `expires_at` | When the cache goes cold, in epoch seconds |
| `hit_ratio` | Cache reads as a share of all input, from 0 to 1. |

## Subagent status lines

| Field | Type | Description |
| - | - | - |
| `cwd` | string | The subagent's own directory |
| `id` | string | The task's id |
