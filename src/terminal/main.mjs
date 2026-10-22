// Entry point for the `statusLine` command: node main.mjs [--data <dir>]
import { run } from './run.mjs';

process.exitCode = await run({
  stdin: process.stdin,
  stdout: process.stdout,
  // The variables the status line uses, by name; nothing else from the environment.
  env: { NO_COLOR: process.env.NO_COLOR, CLAUDE_CONFIG_DIR: process.env.CLAUDE_CONFIG_DIR, COLUMNS: process.env.COLUMNS },
  argv: process.argv.slice(2),
  nowMs: Date.now(),
});
