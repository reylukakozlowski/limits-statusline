# Privacy

Effective 20 October 2026. This statement covers the Limits Status Line plugin for Claude Code
(`limits-statusline`), wherever you install it from: Anthropic's directory or GitHub.

Limits Status Line runs entirely on your computer.

## What it collects and sends

Nothing. It makes no network requests, sends no telemetry or analytics, and shares nothing with
the author or anyone else. It reads no credentials, tokens or API keys.

## What it reads

- What Claude Code gives every status line and mod: session cost and duration, context window
  fill and size, prompt-cache counts, effort, model, plan limit usage and reset times, and the
  working folder. It does not read prompts, responses, the conversation history or Claude's
  memory.
- From local `git`, the current branch and whether tracked files changed (in the desktop app it
  may read `.git/HEAD` instead).
- Your `settings.json`, only when you run `/limits-statusline:setup`.

## What it writes, and for how long

Everything stays on your computer, under `~/.claude` (or `CLAUDE_CONFIG_DIR` when you set one):

| What | Where | Kept |
|---|---|---|
| Context fill history: one list of percentages per session | `plugins/data/limits-statusline-<source>/history/` | Pruned after 7 days |
| A copy of the plugin's status line code, and a setup marker | `plugins/data/limits-statusline-<source>/` | Until you uninstall the plugin |
| The desktop band's figures (effort, cache counts, context history, git state) | The state Claude Code keeps for the plugin's mod | As Claude Code keeps session state |
| The `statusLine` entry | `settings.json` | Until `/limits-statusline:setup --uninstall` |
| Your previous status line and a copy of the previous `settings.json` | `limits-statusline/` | Until you delete them; `--uninstall` uses the previous status line and removes it |

`<source>` is `synced` when you added the plugin from Anthropic's directory and `sealoop` when you
added it from GitHub. Uninstalling the plugin deletes its data folder.

## Children

The plugin is a developer tool for Claude Code and is not directed at children.

## Contact

Questions about this statement: Luka Kozlowski (SeaLoop), lukakozlowski@outlook.com, or a
[GitHub issue](https://github.com/reylukakozlowski/limits-statusline/issues).
