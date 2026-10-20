# Privacy

Limits Status Line runs entirely on your computer.

- It collects no data and sends nothing anywhere: it makes no network requests.
- It reads no credentials, tokens or API keys.
- It reads what Claude Code gives every status line (session cost, duration, context and plan
  limit figures, model, working folder) and asks local `git` for the branch and whether tracked
  files changed (in the desktop app it may read `.git/HEAD` instead).
- It writes only on your computer:
  - a per-session context history and a copy of its own runtime in
    `~/.claude/plugins/data/limits-statusline-sealoop/`, which uninstalling the plugin removes;
  - when you run `/limits-statusline:setup`, the `statusLine` entry of your `settings.json`, plus
    your previous status line and a copy of the previous `settings.json` in
    `~/.claude/limits-statusline/` (so `--uninstall` can restore them).

With `CLAUDE_CONFIG_DIR` set, these folders live there instead of `~/.claude`. Questions:
Luka Kozlowski (SeaLoop), lukakozlowski@outlook.com.
