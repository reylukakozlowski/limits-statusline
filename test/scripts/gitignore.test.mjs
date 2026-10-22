// .gitignore: the repository root is the plugin folder, so what it keeps out never ships.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));

test('.gitignore keeps lockfiles, secrets, OS files and local tool folders out of the repository', () => {
  const samples = [
    'package-lock.json', 'npm-shrinkwrap.json', 'yarn.lock', 'pnpm-lock.yaml', 'bun.lock', 'bun.lockb',
    'node_modules/x.js', 'coverage/x', 'npm-debug.log', 'limits-statusline-0.1.1.tgz',
    '.env', '.env.local', '.npmrc',
    '.DS_Store', 'docs/.DS_Store', '._icon.png', '__MACOSX/x', 'Thumbs.db', 'desktop.ini',
    '.vscode/settings.json', '.idea/x.xml', 'src/core/format.mjs.swp',
    '.claude/worktrees/x/README.md', '.claude/settings.local.json', '.superpowers/x', '.claude-plugin/types/x.d.ts',
  ];
  // Only this repository's rules count: the machine's own global excludes file is left out.
  const checked = spawnSync('git', ['-c', 'core.excludesFile=', 'check-ignore', '--no-index', '--verbose', '--non-matching', ...samples], { cwd: ROOT, encoding: 'utf8' });
  const notIgnored = checked.stdout.split('\n').filter((line) => line.startsWith('::')).map((line) => line.slice(2).trim());
  assert.deepEqual(notIgnored, []);
});

test('.gitignore never keeps the plugin\'s own code, tests or types out', () => {
  const lines = readFileSync(join(ROOT, '.gitignore'), 'utf8').split('\n').map((line) => line.trim());
  assert.ok(!lines.some((line) => /^(src|scripts|hooks|commands|types|test)\/?$/.test(line)));
});
