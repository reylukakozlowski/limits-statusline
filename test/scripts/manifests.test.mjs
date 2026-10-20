// The repository's own contract: identity, versions, and Anthropic directory requirements
// (https://claude.com/docs/plugins/pre-submission-checklist).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { extractReleaseNotes } from '../../scripts/lib/release-lib.mjs';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const read = (path) => readFileSync(join(ROOT, path), 'utf8');
const json = (path) => JSON.parse(read(path));

const AUTHOR = { name: 'Luka Kozlowski', email: 'lukakozlowski@outlook.com' };
const OWNER = { name: 'SeaLoop', email: 'lukakozlowski@outlook.com' };

const pkg = json('package.json');
const plugin = json('.claude-plugin/plugin.json');
const marketplace = json('.claude-plugin/marketplace.json');

test('the three manifests carry the same version', () => {
  assert.equal(plugin.version, pkg.version);
  assert.equal(marketplace.plugins[0].version, pkg.version);
});

test('identity is exactly Luka Kozlowski, his email and SeaLoop', () => {
  assert.deepEqual(plugin.author, AUTHOR);
  assert.deepEqual(marketplace.owner, OWNER);
  assert.equal(marketplace.name, 'sealoop');
  for (const entry of marketplace.plugins) {
    if (entry.author) assert.deepEqual(entry.author, AUTHOR);
  }
  assert.match(read('LICENSE'), /Copyright \(c\) 2026 Luka Kozlowski \(SeaLoop\)/);
});

test('the plugin name is permanent-safe and matches its marketplace entry', () => {
  assert.equal(plugin.name, 'limits-statusline');
  assert.match(plugin.name, /^[a-z0-9]+(-[a-z0-9]+)*$/);
  assert.doesNotMatch(plugin.name, /^(claude|anthropic)/);
  assert.equal(marketplace.plugins.length, 1);
  assert.equal(marketplace.plugins[0].name, plugin.name);
  assert.equal(marketplace.plugins[0].source, './');
});

test('directory rules: README of 40+ words, license, no top-level bin, no lockfile', () => {
  const prose = read('README.md').replace(/```[\s\S]*?```/g, '');
  assert.ok(prose.split(/\s+/).filter(Boolean).length >= 40);
  assert.equal(plugin.license, 'MIT');
  assert.equal(existsSync(join(ROOT, 'bin')), false);
  for (const lockfile of ['package-lock.json', 'npm-shrinkwrap.json', 'bun.lock', 'bun.lockb', 'yarn.lock', 'pnpm-lock.yaml']) {
    assert.equal(existsSync(join(ROOT, lockfile)), false, lockfile);
  }
});

test('directory rules: every shipped file is under 256 KiB and none is an OS artefact', () => {
  const listed = spawnSync('git', ['ls-files', '--cached', '--others', '--exclude-standard'], { cwd: ROOT, encoding: 'utf8' });
  assert.equal(listed.status, 0);
  const files = listed.stdout.split('\n').filter(Boolean);
  assert.ok(files.length > 10);
  for (const file of files) {
    assert.ok(statSync(join(ROOT, file)).size < 256 * 1024, file);
    assert.doesNotMatch(file, /(^|\/)(\.DS_Store|Thumbs\.db|desktop\.ini)$/);
  }
});

test('userConfig stays loadable on Claude Code before 2.1.271 (no options pickers)', () => {
  for (const [key, field] of Object.entries(plugin.userConfig ?? {})) {
    assert.equal('options' in field, false, key);
  }
});

test('hook commands reach plugin files only through ${CLAUDE_PLUGIN_ROOT}', () => {
  const commands = JSON.stringify(json('hooks/hooks.json').hooks);
  for (const [path] of commands.matchAll(/[\w.-]+\/[\w./-]+\.mjs/g)) {
    assert.ok(commands.includes(`\${CLAUDE_PLUGIN_ROOT}/${path}`), path);
  }
});

test('no source file hides an invisible byte-order mark (write \\uFEFF instead)', () => {
  const listed = spawnSync('git', ['ls-files', '--cached', '--others', '--exclude-standard'], { cwd: ROOT, encoding: 'utf8' });
  for (const file of listed.stdout.split('\n').filter((name) => /\.(mjs|ts|json|md|yml)$/.test(name))) {
    assert.ok(!read(file).includes('\uFEFF'), file);
  }
});

test('no .gitattributes rewrites file contents (the directory validator stops on those)', () => {
  assert.equal(existsSync(join(ROOT, '.gitattributes')), false);
});

test('the mod tests have their own npm script', () => {
  assert.equal(pkg.scripts['test:mod'], 'claude plugin test .');
});

test('the changelog has release notes for the current version', () => {
  assert.ok(extractReleaseNotes(read('CHANGELOG.md'), pkg.version).length > 0);
});

test('the release workflow only publishes: no test job', () => {
  const workflow = read('.github/workflows/release.yml');
  assert.match(workflow, /tags:\s*\n\s*- 'v\*\.\*\.\*'/);
  assert.match(workflow, /gh release create/);
  assert.doesNotMatch(workflow, /npm (test|ci|install)/);
});
