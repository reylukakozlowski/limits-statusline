# Privacy

Effective 20 October 2026. This statement covers the Limits Status Line plugin for Claude Code
(`limits-statusline`), wherever you install it from: Anthropic's directory or GitHub.

Limits Status Line runs entirely on your computer.

## What it collects and sends

Nothing. It makes no network requests, sends no telemetry or analytics, and shares nothing with
the author or anyone else. It uses no credentials, tokens or API keys. Your `settings.json` can
hold some (in `env`, for example), and the plugin reads that file whole in the two places listed
below, uses only the fields named there, and sends none of it anywhere.

## Personal data

The plugin is not built to collect personal data, but some of what it reads and keeps can contain
it:

- Folder paths (the working folder, the configuration folder and the transcript's path) usually
  contain your user folder's name, such as `C:\Users\<name>` or `/home/<name>`, and a repository
  or branch name can contain a name too. The plugin shows the folder and branch names on your
  screen.
- The setup marker stores the path of the `settings.json` it changed, and setup keeps an exact
  copy of your previous `settings.json`, with whatever you put in it.
- Claude Code also passes the session's name to every status line; the plugin ignores it.

All of it stays on your computer, as the next two sections describe.

## What it reads

- What Claude Code gives every status line and mod: session cost and duration, lines changed,
  context window fill and size, prompt-cache counts and expiry, effort, model, plan limit usage
  and reset times, and the working folder. It does not read prompts, responses, the conversation
  history or Claude's memory.
- The time the session's transcript file was last written (its modification time only, never
  its contents), to stamp a plan limit reading with when it arrived.
- From local `git`, the current branch and whether tracked files changed (in the desktop app it
  may read `.git/HEAD` instead).
- Your `settings.json` file itself, whole, only when you run `/limits-statusline:setup` (only
  `statusLine` is changed).
- In the desktop app, on every redraw, the settings as Claude Code has them, whole (only
  `promptCacheTtl` is used), the session's repository (only its folder is used) and the variables `FORCE_PROMPT_CACHING_5M`,
  `CLAUDE_CODE_PROMPT_CACHE_TTL` and `ENABLE_PROMPT_CACHING_1H`, to know how long the prompt
  cache stays warm, and `CLAUDE_CONFIG_DIR`, `USERPROFILE` and `HOME`, to find the limit history
  file.

## What it writes, and for how long

Everything stays on your computer, under `~/.claude` (or `CLAUDE_CONFIG_DIR` when you set one):

| What | Where | Kept |
|---|---|---|
| Context fill history: one list of percentages per session | `plugins/data/limits-statusline-<source>/history/` | Pruned after 7 days |
| Plan limit history: the 5-hour and 7-day usage percentages with their time and reset time, and each session's id with the last figures it reported, shared by the status line and the desktop band | `limits-statusline/limit-history.json` | Whenever a reading is added, readings older than 1 hour (5-hour) or 48 hours (7-day) are pruned except the newest of them, and sessions not seen for 48 hours or beyond the 64 most recent; the file stays until you delete it |
| A copy of the plugin's status line code with a fingerprint of that code, and a setup marker with the path of the `settings.json` setup changed | `plugins/data/limits-statusline-<source>/` | Until you uninstall the plugin |
| The desktop band's figures (effort, cache counts, context history, git state with the branch name) | The session state Claude Code holds for the plugin's mod | For the session; the plugin keeps none of it beyond the session |
| The `statusLine` entry | `settings.json` | Until `/limits-statusline:setup --uninstall` |
| Your previous status line and an exact copy of the previous `settings.json` | `limits-statusline/` | Until you delete them; `--uninstall` uses the previous status line and removes it |

`<source>` is `synced` when you added the plugin from Anthropic's directory and `sealoop` when you
added it from GitHub. Uninstalling the plugin deletes its data folder; the `limits-statusline/`
folder stays until you delete it.

## Children

The plugin is a developer tool for Claude Code and is not directed at children.

## Contact

Questions about this statement: Luka Kozlowski (SeaLoop), lukakozlowski@outlook.com, or a
[GitHub issue](https://github.com/reylukakozlowski/limits-statusline/issues).
