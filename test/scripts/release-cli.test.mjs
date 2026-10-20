import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runRelease } from '../../scripts/lib/release-cli.mjs';

const CHANGELOG = '# Changelog\n\n## [Unreleased]\n\n### Fixed\n- A bug.\n\n## [0.1.0] - 2026-10-20\n\n### Added\n- First.\n';
const WRITES = ['git add', 'git commit', 'git tag', 'git push'];

function project(t, changelog = CHANGELOG) {
  const dir = mkdtempSync(join(tmpdir(), 'ls-release-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  mkdirSync(join(dir, '.claude-plugin'));
  const json = (path, value) => writeFileSync(join(dir, path), `${JSON.stringify(value, null, 2)}\n`);
  json('package.json', { name: 'limits-statusline', version: '0.1.0' });
  json('.claude-plugin/plugin.json', { name: 'limits-statusline', version: '0.1.0' });
  json('.claude-plugin/marketplace.json', { name: 'sealoop', plugins: [{ name: 'limits-statusline', source: './', version: '0.1.0' }] });
  writeFileSync(join(dir, 'CHANGELOG.md'), changelog);
  return dir;
}

function fakeGit({ branch = 'develop', status = '', log = 'LS-1 feat: first\nLS-4 fix: x', tags = [], testStatus = 0, pushStatus = 0 } = {}) {
  const calls = [];
  const exec = (command, args) => {
    calls.push([command, ...args].join(' '));
    if (command === 'npm') return { status: testStatus, stdout: '' };
    if (args[0] === 'rev-parse' && args.includes('--verify')) return { status: tags.some((tag) => args.at(-1) === `refs/tags/${tag}`) ? 0 : 1, stdout: '' };
    if (args[0] === 'rev-parse') return { status: 0, stdout: `${branch}\n` };
    if (args[0] === 'status') return { status: 0, stdout: status };
    if (args[0] === 'log') return { status: 0, stdout: log };
    if (args[0] === 'push') return { status: pushStatus, stdout: '' };
    return { status: 0, stdout: '' };
  };
  return { exec, calls, wrote: () => calls.some((call) => WRITES.some((write) => call.startsWith(write))) };
}

const io = () => {
  const out = [];
  return { stdout: { write: (text) => out.push(text) }, stderr: { write: (text) => out.push(text) }, text: () => out.join('') };
};

const readJson = (dir, path) => JSON.parse(readFileSync(join(dir, path), 'utf8'));
const release = (dir, git, argv) => {
  const streams = io();
  const code = runRelease({ argv, cwd: dir, exec: git.exec, today: '2026-10-21', ...streams });
  return { code, text: streams.text() };
};

test('release bumps every manifest, stamps the changelog, tests, commits and tags', (t) => {
  const dir = project(t);
  const git = fakeGit();
  const result = release(dir, git, ['patch']);
  assert.equal(result.code, 0, result.text);
  assert.equal(readJson(dir, 'package.json').version, '0.1.1');
  assert.equal(readJson(dir, '.claude-plugin/plugin.json').version, '0.1.1');
  assert.equal(readJson(dir, '.claude-plugin/marketplace.json').plugins[0].version, '0.1.1');
  assert.match(readFileSync(join(dir, 'CHANGELOG.md'), 'utf8'), /## \[0\.1\.1\] - 2026-10-21/);
  assert.deepEqual(git.calls.filter((call) => !call.startsWith('git rev-parse') && !call.startsWith('git status') && !call.startsWith('git log')), [
    'npm test',
    'git add package.json .claude-plugin/plugin.json .claude-plugin/marketplace.json CHANGELOG.md',
    'git commit -m LS-5 chore(release): v0.1.1',
    'git tag -a v0.1.1 -m v0.1.1',
  ]);
  assert.match(result.text, /git push --atomic origin develop refs\/tags\/v0\.1\.1/);
});

test('release --push sends the branch and its tag in one atomic push', (t) => {
  const git = fakeGit();
  const result = release(project(t), git, ['minor', '--push']);
  assert.equal(result.code, 0, result.text);
  assert.equal(git.calls.at(-1), 'git push --atomic origin develop refs/tags/v0.2.0');
});

test('release takes an exact version X.Y.Z', (t) => {
  const dir = project(t);
  const git = fakeGit();
  assert.equal(release(dir, git, ['0.3.0', '--push']).code, 0);
  assert.equal(readJson(dir, 'package.json').version, '0.3.0');
  assert.equal(git.calls.at(-1), 'git push --atomic origin develop refs/tags/v0.3.0');
});

test('release refuses outside develop or with a dirty tree, touching nothing', (t) => {
  for (const options of [{ branch: 'main' }, { status: ' M README.md\n' }]) {
    const dir = project(t);
    const git = fakeGit(options);
    assert.equal(release(dir, git, ['patch']).code, 2);
    assert.equal(readJson(dir, 'package.json').version, '0.1.0');
    assert.ok(!git.calls.includes('npm test'));
  }
});

test('release refuses a version whose tag already exists, before the tests and without writing', (t) => {
  const dir = project(t);
  const git = fakeGit({ tags: ['v0.1.1'] });
  const result = release(dir, git, ['patch', '--push']);
  assert.equal(result.code, 2);
  assert.match(result.text, /tag v0\.1\.1 already exists/);
  assert.ok(!git.calls.includes('npm test'));
  assert.ok(!git.wrote());
  assert.equal(readFileSync(join(dir, 'CHANGELOG.md'), 'utf8'), CHANGELOG);
});

test('release refuses a version that is not higher, or that is not a version, without running the tests', (t) => {
  for (const kind of ['0.1.0', '0.0.9', 'latest']) {
    const git = fakeGit();
    const result = release(project(t), git, [kind]);
    assert.equal(result.code, 2, kind);
    assert.ok(!git.calls.includes('npm test'), kind);
  }
});

test('release refuses an empty [Unreleased] section, before the tests', (t) => {
  const git = fakeGit();
  const result = release(project(t, '# Changelog\n\n## [Unreleased]\n\n## [0.1.0] - 2026-10-20\n\n- First.\n'), git, ['patch', '--push']);
  assert.equal(result.code, 2);
  assert.match(result.text, /describe the release first/);
  assert.ok(!git.calls.includes('npm test'));
});

test('release stops before writing when the tests fail', (t) => {
  const dir = project(t);
  const git = fakeGit({ testStatus: 1 });
  const result = release(dir, git, ['patch', '--push']);
  assert.equal(result.code, 2);
  assert.match(result.text, /tests failed/);
  assert.equal(readJson(dir, 'package.json').version, '0.1.0');
  assert.ok(!git.wrote());
});

test('release --dry-run runs the checks and the tests and writes nothing', (t) => {
  const dir = project(t);
  const git = fakeGit();
  const result = release(dir, git, ['major', '--dry-run', '--push']);
  assert.equal(result.code, 0, result.text);
  assert.match(result.text, /0\.1\.0 → 1\.0\.0, commit "LS-5 chore\(release\): v1\.0\.0", tag v1\.0\.0, push/);
  assert.match(result.text, /- A bug\./);
  assert.ok(git.calls.includes('npm test'));
  assert.ok(!git.wrote());
  assert.equal(readJson(dir, 'package.json').version, '0.1.0');
  assert.equal(readFileSync(join(dir, 'CHANGELOG.md'), 'utf8'), CHANGELOG);
});

test('release --dry-run fails like a release when the tests fail', (t) => {
  const result = release(project(t), fakeGit({ testStatus: 1 }), ['patch', '--dry-run']);
  assert.equal(result.code, 2);
  assert.match(result.text, /tests failed/);
});

test('release reports a refused push: origin got neither the branch nor the tag', (t) => {
  const git = fakeGit({ pushStatus: 1 });
  const result = release(project(t), git, ['patch', '--push']);
  assert.equal(result.code, 2);
  assert.match(result.text, /neither develop nor v0\.1\.1/);
  assert.match(result.text, /exist only in this clone/);
});

test('release without a bump kind, or with an unknown option, is a usage error', (t) => {
  assert.equal(release(project(t), fakeGit(), []).code, 1);
  assert.equal(release(project(t), fakeGit(), ['patch', '--force']).code, 1);
});
