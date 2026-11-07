// Entry point: node scripts/release-preflight.mjs, the Release workflow's first check. From
// a clone with gh signed in:
//   GITHUB_REPOSITORY=<owner>/<repo> node scripts/release-preflight.mjs
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { runPreflight } from './lib/release-preflight.mjs';

const cwd = fileURLToPath(new URL('..', import.meta.url));

const exec = (command, args) => {
  const result = spawnSync(command, args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  return { status: result.status ?? 1, stdout: result.stdout ?? '', stderr: result.stderr || result.error?.message || '' };
};

process.exitCode = runPreflight({
  env: { GITHUB_REPOSITORY: process.env.GITHUB_REPOSITORY, GITHUB_REF_NAME: process.env.GITHUB_REF_NAME },
  exec,
  stdout: process.stdout,
});
