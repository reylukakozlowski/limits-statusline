// Entry point: node scripts/tag-release.mjs
// Run by the Release workflow after a push to develop: tags the merged release commit and prints
// the tag on stdout for the publish job. Git's own messages go to stderr, so stdout holds the tag only.
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { runTagRelease } from './lib/release-cli.mjs';

const cwd = fileURLToPath(new URL('..', import.meta.url));

const exec = (command, args) => {
  const result = spawnSync(command, args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'] });
  return { status: result.status ?? 1, stdout: result.stdout ?? '' };
};

process.exitCode = runTagRelease({ cwd, exec, stdout: process.stdout, stderr: process.stderr });
