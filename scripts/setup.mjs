// Entry point for /limits-statusline:setup: node setup.mjs --data <dir> [--settings <file>] [--uninstall] [--dry-run]
import { fileURLToPath } from 'node:url';
import { runSetup } from './lib/setup-cli.mjs';

process.exitCode = runSetup({
  argv: process.argv.slice(2),
  pluginRoot: fileURLToPath(new URL('..', import.meta.url)),
  stdout: process.stdout,
  stderr: process.stderr,
});
