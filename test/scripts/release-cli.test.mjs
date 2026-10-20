import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runRelease } from '../../scripts/lib/release-cli.mjs';

const CHANGELOG = '# Changelog\n\n## [Unreleased]\n\n### Fixed\n- A bug.\n\n## [0.1.0] - 2026-10-20\n\n### Added\n- First.\n';

function project(t) {
  const dir = mkdtempSync(join(tmpdir(), 'ls-release-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  mkdirSync(join(dir, '.claude-plugin'));
  const json = (path, value) => writeFileSync(join(dir, path), `${JSON.stringify(value, null, 2)}\n`);
  json('package.json', { name: 'limits-statusline', version: '0.1.0' });
  json('.claude-plugin/plugin.json', { name: 'limits-statusline', version: '0.1.0' });
  json('.claude-plugin/marketplace.json', { name: 'sealoop', plugins: [{ name: 'limits-statusline', source: './', version: '0.1.0' }] });
  writeFileSync(join(dir, 'CHANGELOG.md'), CHANGELOG);
  return dir;
}

function fakeGit({ branch = 'develop', status = '', log = 'LS-1 feat: first\nLS-4 fix: x' } = {}) {
  const calls = [];
  const exec = (command, args) => {
    calls.push([command, ...args].join(' '));
    if (args[0] === 'rev-parse') return { status: 0, stdout: `${branch}\n` };
    if (args[0] === 'status') return { status: 0, stdout: status };
    if (args[0] === 'log') return { status: 0, stdout: log };
    return { status: 0, stdout: '' };
  };
  return { exec, calls };
}

const io = () => {
  const out = [];
  return { stdout: { write: (text) => out.push(text) }, stderr: { write: (text) => out.push(text) }, text: () => out.join('') };
};

const readJson = (dir, path) => JSON.parse(readFileSync(join(dir, path), 'utf8'));

test('release bumps every manifest, stamps the changelog, tests, commits and tags', (t) => {
  const dir = project(t);
  const git = fakeGit();
  const streams = io();
  const code = runRelease({ argv: ['patch'], cwd: dir, exec: git.exec, today: '2026-10-21', ...streams });
  assert.equal(code, 0, streams.text());
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
});

test('release --push pushes the branch with its tag', (t) => {
  const git = fakeGit();
  runRelease({ argv: ['minor', '--push'], cwd: project(t), exec: git.exec, today: '2026-10-21', ...io() });
  assert.equal(git.calls.at(-1), 'git push origin develop --follow-tags');
});

test('release refuses outside develop or with a dirty tree, touching nothing', (t) => {
  for (const options of [{ branch: 'main' }, { status: ' M README.md\n' }]) {
    const dir = project(t);
    const git = fakeGit(options);
    const streams = io();
    assert.equal(runRelease({ argv: ['patch'], cwd: dir, exec: git.exec, today: '2026-10-21', ...streams }), 2);
    assert.equal(readJson(dir, 'package.json').version, '0.1.0');
    assert.ok(!git.calls.includes('npm test'));
  }
});

test('release stops before writing when the tests fail', (t) => {
  const dir = project(t);
  const git = fakeGit();
  const exec = (command, args) => (command === 'npm' ? { status: 1, stdout: '' } : git.exec(command, args));
  assert.equal(runRelease({ argv: ['patch'], cwd: dir, exec, today: '2026-10-21', ...io() }), 2);
  assert.equal(readJson(dir, 'package.json').version, '0.1.0');
});

test('release --dry-run only reports', (t) => {
  const dir = project(t);
  const git = fakeGit();
  const streams = io();
  assert.equal(runRelease({ argv: ['major', '--dry-run'], cwd: dir, exec: git.exec, today: '2026-10-21', ...streams }), 0);
  assert.match(streams.text(), /1\.0\.0/);
  assert.equal(readJson(dir, 'package.json').version, '0.1.0');
  assert.ok(!git.calls.some((call) => call.startsWith('git commit')));
});

test('release without a bump kind is a usage error', (t) => {
  assert.equal(runRelease({ argv: [], cwd: project(t), exec: fakeGit().exec, today: '2026-10-21', ...io() }), 1);
});
