// Entry point: npm run release -- <patch|minor|major> [--push] [--dry-run]
// Prints the tag on stdout for the Release workflow; the tests' and git's own output goes to stderr.
import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runRelease } from './lib/release-cli.mjs';

const cwd = fileURLToPath(new URL('..', import.meta.url));
const manifestPath = join(cwd, '.claude-plugin', 'plugin.json');

const exec = (command, args, { inherit = false } = {}) => {
  const result = spawnSync(command, args, {
    cwd,
    encoding: 'utf8',
    // Shown output goes to stderr (fd 2): stdout carries the tag alone.
    stdio: inherit ? ['ignore', 2, 2] : ['ignore', 'pipe', 'inherit'],
    shell: process.platform === 'win32' && command === 'npm', // npm is npm.cmd on Windows
  });
  return { status: result.status ?? 1, stdout: result.stdout ?? '' };
};

process.exitCode = runRelease({
  argv: process.argv.slice(2),
  exec,
  readManifest: () => readFileSync(manifestPath, 'utf8'),
  writeManifest: (text) => writeFileSync(manifestPath, text),
  stdout: process.stdout,
  stderr: process.stderr,
});
