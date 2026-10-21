// Entry point: node scripts/release-preflight.mjs, run by the Release workflow before it tags. From
// a clone with gh signed in:
//   GITHUB_REPOSITORY=<owner>/<repo> GITHUB_REPOSITORY_OWNER=<owner> node scripts/release-preflight.mjs
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { runPreflight } from './lib/release-preflight.mjs';

const cwd = fileURLToPath(new URL('..', import.meta.url));

const exec = (command, args) => {
  const result = spawnSync(command, args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  return { status: result.status ?? 1, stdout: result.stdout ?? '', stderr: result.stderr || result.error?.message || '' };
};

process.exitCode = runPreflight({ env: process.env, exec, stdout: process.stdout });
