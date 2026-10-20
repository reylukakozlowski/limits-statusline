# limits-statusline — design

Date: 2026-10-20 · Author: Luka Kozlowski (SeaLoop) · Status: approved

## Goal

A Claude Code status line that shows the session's cost, runtime, prompt-cache hit ratio, effort,
project/git/model, context fill, and the claude.ai 7-day and 5-hour plan limits with reset countdown,
burn rate and a red warning when the projected usage at reset exceeds 100%. Shipped as the plugin
`limits-statusline` in the marketplace `sealoop` (repo `Reywedian/limits-statusline`, public), ready
for submission to Anthropic's plugin directory.

## Target output (5 lines, from the approved mockup)

```
daily-claude | no git | ✦ Opus 5.5
ctx ■■■■■■■■■■■□□□□□□□□□ 54%  543k/1.0M  ▃▃▃▄▄▄▅▅
$20.33 · 5h40m · cache 99% · xhigh
7d  ■■■■■■■■□□□□□□□□□□□□ 39%  ↻ 76h10m  ↗ 0.4%/h
5h  ■■□□□□□□□□□□□□□□□□□□ 12%  ↻ 4h10m   ↗ 14.4%/h
```

## Decisions (user-approved)

| Topic | Decision |
|---|---|
| Surfaces | Both: terminal (classic `statusLine`, bottom) and desktop Code tab (mod band above the prompt) |
| Architecture | A. Hybrid: pure `core` shared by a Node terminal adapter and a mod desktop adapter |
| Terminal enablement | `/limits-statusline:setup` writes `statusLine` into `~/.claude/settings.json` (backup, atomic, `--uninstall`) |
| Distribution | Public GitHub repo + own marketplace `sealoop` + prepared for Anthropic's directory (user submits) |
| Identity | Only "Luka Kozlowski", "lukakozlowski@outlook.com", "SeaLoop" — manifests, commit author, LICENSE; no Claude co-author trailer |
| Name | `limits-statusline` (permanent) |
| Burn rate | Average since window start: `rate = used% / elapsedHours`, `elapsed = window − (resetsAt − now)` (matches mockup: 12%/50min = 14.4%/h). **Superseded by LS-20:** the recent pace over the last 30 min (5h, %/h) or 24 h across the weekly reset (7d, %/h since LS-22; LS-20 showed it per day), from a plan-limit history shared by all sessions; the average since window start remains the fallback without history |
| Red rule | `projected = used + rate × remainingHours`; red when > 100. LS-20 shows it (`→ 117%`) with `⚠ 100% in 1h17m` when the limit runs out before the reset |
| Limit colours | projected < 80 green · 80–100 yellow · > 100 red; `used ≥ 100` is red |
| Context colours | < 50 green · 50–80 orange · > 80 red |
| Early window | No rate until 15 min elapsed: shows `↗ —` |
| Git | `git <branch>` with `*` when dirty (tracked files), `no git` outside a repo |
| Release | GitHub workflow **Release**, run by hand by the owner only, after approval of the `release` environment: tests, bump, changelog, commit on `release/vX.Y.Z` and its pull request into the protected `develop`, merged by the workflow (Rebase and merge; the approval is the decision to merge), tag `vX.Y.Z` on the merged commit and GitHub Release. Anthropic's directory follows `develop`. `npm run release <patch|minor|major>` is the local equivalent; no test workflow on pull requests |
| Repo | `Reywedian/limits-statusline` (public, read-only for others), default branch `develop`, commits `LS-<N> <type>: <subject>` |

## Data sources (verified, docs as of 2026-10-20)

Terminal — statusLine stdin JSON (https://code.claude.com/docs/en/statusline):
`cost.total_cost_usd`, `cost.total_duration_ms`, `prompt_cache.hit_ratio` (≥ v2.1.251; fallback
`context_window.current_usage`), `effort.level`, `model.display_name`, `workspace.current_dir`,
`workspace.project_dir`, `workspace.repo.name`, `context_window.{used_percentage,total_input_tokens,
context_window_size}`, `rate_limits.{five_hour,seven_day}.{used_percentage,resets_at (epoch s)}`
(Pro/Max only, after first response; a window is dropped once reset), `session_id`. Env `COLUMNS`.

Desktop — mods API (types written by Claude Code 2.1.299; https://code.claude.com/docs/en/plugins/mods/reference):
`$.session.usage()` → `{ startedAt, context{tokens,window,percent}, rateLimits[{kind,percentUsed,resetsAt ISO}], cost{usd} }`,
`$.session.model()`, `$.session.cwd()`, `$.process.run(argv,{cwd,timeoutMs})`, events `turn.step`
(`effort`, async generator), `turn.complete` (`usage` with cache tokens), `session.measure`,
`ui.render` on `AbovePrompt` (Terminal + Desktop). Theme colour keys `success/warning/error/merged/subtle/suggestion/claude`.

## Constraints

- A plugin cannot set `statusLine` (plugin `settings` only applies `agent`, `subagentStatusLine`).
- `${CLAUDE_PLUGIN_ROOT}` changes on update → runtime is copied to `${CLAUDE_PLUGIN_DATA}/runtime`
  by setup and refreshed by a SessionStart hook.
- No top-level `bin/` (claude.ai/Cowork refuse such plugins). Plugin at repo root, README ≥ 40 words,
  LICENSE, files < 256 KiB, no lockfile, hook paths only from `${CLAUDE_PLUGIN_ROOT}`.
- Windows: statusLine runs via Git Bash → forward slashes in the command.
- No tokens, no network, no unofficial usage API.

## Out of scope

CI tests, Linux/macOS manual runs (code stays cross-platform), VS Code surface, the Anthropic
directory submission itself (the user submits at claude.ai/directory/manage).
