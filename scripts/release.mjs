// Entry point: npm run release -- <patch|minor|major|X.Y.Z> [--push] [--dry-run]
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { runRelease } from './lib/release-cli.mjs';

const cwd = fileURLToPath(new URL('..', import.meta.url));

const exec = (command, args, { inherit = false } = {}) => {
  const result = spawnSync(command, args, {
    cwd,
    encoding: 'utf8',
    stdio: inherit ? 'inherit' : 'pipe',
    shell: process.platform === 'win32' && command === 'npm', // npm is npm.cmd on Windows
  });
  return { status: result.status ?? 1, stdout: result.stdout ?? '' };
};

process.exitCode = runRelease({
  argv: process.argv.slice(2),
  cwd,
  exec,
  today: new Date().toISOString().slice(0, 10),
  stdout: process.stdout,
  stderr: process.stderr,
});
