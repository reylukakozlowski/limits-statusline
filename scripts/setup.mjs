// Entry point for /limits-statusline:setup: node setup.mjs --data <dir> [--settings <file>] [--uninstall] [--dry-run]
import { fileURLToPath } from 'node:url';
import { runSetup } from './lib/setup-cli.mjs';

process.exitCode = runSetup({
  argv: process.argv.slice(2),
  pluginRoot: fileURLToPath(new URL('..', import.meta.url)),
  // The one variable setup uses, by name: where Claude Code keeps its configuration.
  env: { CLAUDE_CONFIG_DIR: process.env.CLAUDE_CONFIG_DIR },
  stdout: process.stdout,
  stderr: process.stderr,
});
