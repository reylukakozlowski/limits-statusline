// SessionStart hook: refresh the status line runtime after a plugin update. Silent and always
// exit 0, because SessionStart output becomes session context and a failure must not block it.
// The command in hooks/hooks.json ends with `; exit 0` (read the same by sh, Git Bash and
// PowerShell), so a computer without Node.js, where this file cannot run, starts sessions without
// a hook error too.
import { syncFromHook } from './lib/runtime-sync.mjs';

try {
  // The two variables Claude Code sets for a plugin's hook, and nothing else from the environment.
  syncFromHook({ pluginRoot: process.env.CLAUDE_PLUGIN_ROOT, dataDir: process.env.CLAUDE_PLUGIN_DATA });
} catch {
  // The previous runtime keeps working; the next session start tries again.
}
