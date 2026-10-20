---
description: Turn the limits status line on in ~/.claude/settings.json (or off with --uninstall)
argument-hint: "[--uninstall] [--dry-run]"
allowed-tools: Bash(node:*)
---

Run this exact command with the Bash tool, then show its output to the user and stop. Do not edit
settings.json yourself.

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/setup.mjs" --data "${CLAUDE_PLUGIN_DATA}" $ARGUMENTS
```

Exit code 2 means the script refused and changed nothing (for example, settings.json is not valid
JSON): tell the user what it printed. The status line appears at the bottom of the terminal after the
next message; in the desktop app the plugin draws its own band above the prompt instead.
