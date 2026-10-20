// SessionStart hook: refresh the status line runtime after a plugin update. Silent and always
// exit 0, because SessionStart output becomes session context and a failure must not block it.
import { syncFromHookEnv } from './lib/runtime-sync.mjs';

try {
  syncFromHookEnv(process.env);
} catch {
  // The previous runtime keeps working; the next session start tries again.
}
