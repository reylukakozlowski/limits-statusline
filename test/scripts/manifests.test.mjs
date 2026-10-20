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

const shippedFiles = () => {
  const listed = spawnSync('git', ['ls-files', '--cached', '--others', '--exclude-standard'], { cwd: ROOT, encoding: 'utf8' });
  assert.equal(listed.status, 0);
  return listed.stdout.split('\n').filter((file) => file && existsSync(join(ROOT, file)));
};

const WINDOWS_DEVICE = /^(con|prn|aux|nul|com[0-9]|lpt[0-9])(\..*)?$/i;

test('directory rules: names work on Windows and macOS, and the plugin stays under 512 files', () => {
  const files = shippedFiles();
  assert.ok(files.length <= 512, `${files.length} files`);
  const seen = new Map();
  for (const file of files) {
    for (const part of file.split('/')) {
      assert.doesNotMatch(part, /[:<>"|?*\\]|[. ]$/, file);
      assert.doesNotMatch(part, WINDOWS_DEVICE, file);
    }
    const folded = file.toLowerCase();
    assert.equal(seen.get(folded) ?? file, file, `${file} differs from ${seen.get(folded)} only by case`);
    seen.set(folded, file);
  }
});

const IMAGE = /\.(png|jpe?g|gif|webp)$/i;
const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const PNG_END = Buffer.from([0x49, 0x45, 0x4e, 0x44, 0xae, 0x42, 0x60, 0x82]);

test('directory rules: only text files and complete PNG images ship (anything else is held)', () => {
  for (const file of shippedFiles()) {
    const bytes = readFileSync(join(ROOT, file));
    if (IMAGE.test(file)) {
      assert.match(file, /\.png$/, `${file}: keep images PNG`);
      assert.ok(bytes.subarray(0, 8).equals(PNG_SIGNATURE) && bytes.subarray(-8).equals(PNG_END), `${file} is not a complete PNG`);
    } else {
      assert.equal(bytes.includes(0), false, `${file} looks binary`);
    }
  }
});

test('the directory listing has a PNG icon and https links into this repository', () => {
  assert.match(plugin.icon, /^\.\/assets\/[\w.-]+\.png$/);
  const icon = readFileSync(join(ROOT, plugin.icon));
  const [width, height] = [icon.readUInt32BE(16), icon.readUInt32BE(20)];
  assert.ok(width === height && width >= 256, `icon is ${width}x${height}`);
  const repository = 'https://github.com/reylukakozlowski/limits-statusline';
  assert.equal(plugin.repository, repository);
  for (const key of ['homepage', 'documentationUrl', 'supportUrl', 'privacyPolicyUrl']) {
    assert.ok(plugin[key].startsWith(`${repository}`), `${key}: ${plugin[key]}`);
  }
  assert.equal(plugin.supportUrl, `${repository}/issues`);
  assert.equal(plugin.privacyPolicyUrl, `${repository}/blob/develop/PRIVACY.md`);
  assert.ok(existsSync(join(ROOT, 'PRIVACY.md')));
});

test('the description says the plugin is for Claude Code (chat and Cowork have no status line)', () => {
  assert.match(plugin.description, /^Status line for Claude Code\b/);
  assert.ok(plugin.description.length <= 300, `${plugin.description.length} characters`);
});

test('setup runs only when the user types it, and may run only its own script', () => {
  const setup = read('commands/setup.md');
  const frontmatter = setup.split(/^---$/m)[1];
  assert.match(frontmatter, /^disable-model-invocation: true$/m);
  assert.doesNotMatch(frontmatter, /Bash\(node:\*\)/);
  assert.match(frontmatter, /^ {2}- Bash\(node "\$\{CLAUDE_PLUGIN_ROOT\}\/scripts\/setup\.mjs" \*\)$/m);
  assert.match(setup, /^node "\$\{CLAUDE_PLUGIN_ROOT\}\/scripts\/setup\.mjs" --data "\$\{CLAUDE_PLUGIN_DATA\}" \$ARGUMENTS$/m);
});

test('directory policy: README has three or more use cases, support, privacy and security links', () => {
  const readme = read('README.md');
  const useCases = readme.split(/^## Use cases$/m)[1]?.split(/^## /m)[0] ?? '';
  assert.ok((useCases.match(/^\d+\. \*\*/gm) ?? []).length >= 3);
  assert.match(readme, /^## Support$/m);
  assert.match(readme, /\(PRIVACY\.md\)/);
  assert.match(readme, /\(SECURITY\.md\)/);
  assert.match(read('SECURITY.md'), /lukakozlowski@outlook\.com/);
  for (const doc of ['README.md', 'PRIVACY.md']) {
    assert.doesNotMatch(read(doc), /plugins\/data\/limits-statusline-sealoop/, `${doc} names one install source only`);
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
  assert.ok(!read('.gitignore').split('\n').some((line) => /^(src|scripts|hooks|commands|types|test)\/?$/.test(line.trim())));
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
