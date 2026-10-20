import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runRelease, runTagRelease } from '../../scripts/lib/release-cli.mjs';

const CHANGELOG = '# Changelog\n\n## [Unreleased]\n\n### Fixed\n- A bug.\n\n## [0.1.0] - 2026-10-20\n\n### Added\n- First.\n';
const WRITES = ['git switch', 'git add', 'git commit', 'git tag', 'git push', 'gh '];
const QUERIES = ['git rev-parse', 'git status', 'git log', 'git ls-remote'];

function project(t, changelog = CHANGELOG, version = '0.1.0') {
  const dir = mkdtempSync(join(tmpdir(), 'ls-release-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  mkdirSync(join(dir, '.claude-plugin'));
  const json = (path, value) => writeFileSync(join(dir, path), `${JSON.stringify(value, null, 2)}\n`);
  json('package.json', { name: 'limits-statusline', version });
  json('.claude-plugin/plugin.json', { name: 'limits-statusline', version });
  json('.claude-plugin/marketplace.json', { name: 'sealoop', plugins: [{ name: 'limits-statusline', source: './', version }] });
  writeFileSync(join(dir, 'CHANGELOG.md'), changelog);
  return dir;
}

function fakeGit({
  branch = 'develop', status = '', log = 'LS-1 feat: first\nLS-4_fix: x', tags = [], remoteBranches = [],
  testStatus = 0, pushStatus = 0, ghStatus = 0,
} = {}) {
  const calls = [];
  const exec = (command, args) => {
    calls.push([command, ...args].join(' '));
    if (command === 'npm') return { status: testStatus, stdout: '' };
    if (command === 'gh') return { status: ghStatus, stdout: '' };
    if (args[0] === 'rev-parse' && args.includes('--verify')) return { status: tags.some((tag) => args.at(-1) === `refs/tags/${tag}`) ? 0 : 1, stdout: '' };
    if (args[0] === 'rev-parse') return { status: 0, stdout: `${branch}\n` };
    if (args[0] === 'status') return { status: 0, stdout: status };
    if (args[0] === 'log') return { status: 0, stdout: log };
    if (args[0] === 'ls-remote') return { status: remoteBranches.includes(args.at(-1)) ? 0 : 2, stdout: '' };
    if (args[0] === 'push') return { status: pushStatus, stdout: '' };
    return { status: 0, stdout: '' };
  };
  const writes = () => calls.filter((call) => !QUERIES.some((query) => call.startsWith(query)));
  return { exec, calls, writes, wrote: () => calls.some((call) => WRITES.some((write) => call.startsWith(write))) };
}

const io = () => {
  const out = [];
  const err = [];
  return {
    stdout: { write: (text) => out.push(text) },
    stderr: { write: (text) => err.push(text) },
    out: () => out.join(''),
    text: () => [...out, ...err].join(''),
  };
};

const readJson = (dir, path) => JSON.parse(readFileSync(join(dir, path), 'utf8'));
const release = (dir, git, argv) => {
  const streams = io();
  const code = runRelease({ argv, cwd: dir, exec: git.exec, today: '2026-10-21', ...streams });
  return { code, text: streams.text() };
};
const tagRelease = (dir, git) => {
  const streams = io();
  const code = runTagRelease({ cwd: dir, exec: git.exec, ...streams });
  return { code, out: streams.out(), text: streams.text() };
};

test('release bumps every manifest, stamps the changelog, tests and commits on a release branch', (t) => {
  const dir = project(t);
  const git = fakeGit();
  const result = release(dir, git, ['patch']);
  assert.equal(result.code, 0, result.text);
  assert.equal(readJson(dir, 'package.json').version, '0.1.1');
  assert.equal(readJson(dir, '.claude-plugin/plugin.json').version, '0.1.1');
  assert.equal(readJson(dir, '.claude-plugin/marketplace.json').plugins[0].version, '0.1.1');
  assert.match(readFileSync(join(dir, 'CHANGELOG.md'), 'utf8'), /## \[0\.1\.1\] - 2026-10-21/);
  assert.deepEqual(git.writes(), [
    'npm test',
    'git switch --create release/v0.1.1',
    'git add package.json .claude-plugin/plugin.json .claude-plugin/marketplace.json CHANGELOG.md',
    'git commit -m LS-5_chore(release): v0.1.1',
  ]);
  assert.match(result.text, /git push origin release\/v0\.1\.1/);
  assert.match(result.text, /gh pr create --base develop --head release\/v0\.1\.1/);
});

test('release --push pushes the release branch and opens its pull request into develop, and tags nothing', (t) => {
  const git = fakeGit();
  const result = release(project(t), git, ['minor', '--push']);
  assert.equal(result.code, 0, result.text);
  const [push, pr] = git.writes().slice(-2);
  assert.equal(push, 'git push --set-upstream origin release/v0.2.0');
  assert.match(pr, /^gh pr create --base develop --head release\/v0\.2\.0 --title LS-5_chore\(release\): v0\.2\.0 --body /);
  assert.match(pr, /- A bug\./);
  assert.match(pr, /Rebase and merge/);
  assert.ok(!git.calls.some((call) => call.startsWith('git tag')));
  assert.match(result.text, /tags v0\.2\.0 and publishes/);
});

test('release takes an exact version X.Y.Z', (t) => {
  const dir = project(t);
  const git = fakeGit();
  assert.equal(release(dir, git, ['0.3.0', '--push']).code, 0);
  assert.equal(readJson(dir, 'package.json').version, '0.3.0');
  assert.ok(git.calls.includes('git push --set-upstream origin release/v0.3.0'));
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
  assert.ok(!git.wrote());
  assert.equal(readFileSync(join(dir, 'CHANGELOG.md'), 'utf8'), CHANGELOG);
});

test('release --push refuses when origin already has the release branch, before the tests', (t) => {
  const dir = project(t);
  const git = fakeGit({ remoteBranches: ['release/v0.1.1'] });
  const result = release(dir, git, ['patch', '--push']);
  assert.equal(result.code, 2);
  assert.match(result.text, /origin already has release\/v0\.1\.1/);
  assert.ok(!git.wrote());
  assert.equal(readJson(dir, 'package.json').version, '0.1.0');
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
  assert.deepEqual(git.writes(), ['npm test']);
});

test('release --dry-run runs the checks and the tests and writes nothing', (t) => {
  const dir = project(t);
  const git = fakeGit();
  const result = release(dir, git, ['major', '--dry-run', '--push']);
  assert.equal(result.code, 0, result.text);
  assert.match(result.text, /0\.1\.0 → 1\.0\.0, commit "LS-5_chore\(release\): v1\.0\.0" on release\/v1\.0\.0, pull request into develop/);
  assert.match(result.text, /- A bug\./);
  assert.ok(git.calls.includes('git ls-remote --exit-code --heads origin release/v1.0.0'));
  assert.deepEqual(git.writes(), ['npm test']);
  assert.equal(readJson(dir, 'package.json').version, '0.1.0');
  assert.equal(readFileSync(join(dir, 'CHANGELOG.md'), 'utf8'), CHANGELOG);
});

test('release --dry-run fails like a release when the tests fail', (t) => {
  const result = release(project(t), fakeGit({ testStatus: 1 }), ['patch', '--dry-run']);
  assert.equal(result.code, 2);
  assert.match(result.text, /tests failed/);
});

test('release reports a refused push: the release commit stays on its branch in this clone', (t) => {
  const git = fakeGit({ pushStatus: 1 });
  const result = release(project(t), git, ['patch', '--push']);
  assert.equal(result.code, 2);
  assert.match(result.text, /origin refused release\/v0\.1\.1/);
  assert.ok(!git.calls.some((call) => call.startsWith('gh ')));
});

test('release reports a pull request gh could not open, with the command to open it by hand', (t) => {
  const result = release(project(t), fakeGit({ ghStatus: 1 }), ['patch', '--push']);
  assert.equal(result.code, 2);
  assert.match(result.text, /release\/v0\.1\.1 is on origin, but gh could not open its pull request/);
  assert.match(result.text, /Allow GitHub Actions to create and approve pull requests/);
  assert.match(result.text, /gh pr create --base develop --head release\/v0\.1\.1/);
});

test('release without a bump kind, or with an unknown option, is a usage error', (t) => {
  assert.equal(release(project(t), fakeGit(), []).code, 1);
  assert.equal(release(project(t), fakeGit(), ['patch', '--force']).code, 1);
});

const MERGED_LOG = 'abc1234\tLS-6_chore(release): v0.1.1\nfff0000\tLS-5 feat: x\n';

test('tag-release tags the merged release commit, pushes the tag and prints only the tag', (t) => {
  const git = fakeGit({ log: MERGED_LOG });
  const result = tagRelease(project(t, CHANGELOG, '0.1.1'), git);
  assert.equal(result.code, 0, result.text);
  assert.equal(result.out, 'v0.1.1\n');
  assert.deepEqual(git.writes(), ['git tag -a v0.1.1 -m v0.1.1 abc1234', 'git push origin refs/tags/v0.1.1']);
  assert.ok(git.calls.includes('git log --first-parent --format=%H%x09%s HEAD'));
});

test('tag-release prints a version that is already tagged and writes nothing', (t) => {
  const git = fakeGit({ log: MERGED_LOG, tags: ['v0.1.1'] });
  const result = tagRelease(project(t, CHANGELOG, '0.1.1'), git);
  assert.equal(result.code, 0, result.text);
  assert.equal(result.out, 'v0.1.1\n');
  assert.ok(!git.wrote());
});

test('tag-release refuses a version no release commit on the branch set, printing no tag', (t) => {
  const git = fakeGit({ log: MERGED_LOG });
  const result = tagRelease(project(t, CHANGELOG, '0.1.2'), git);
  assert.equal(result.code, 2);
  assert.equal(result.out, '');
  assert.match(result.text, /no "chore\(release\): v0\.1\.2" commit/);
  assert.ok(!git.wrote());
});

test('tag-release reports a tag origin refused, printing no tag', (t) => {
  const git = fakeGit({ log: MERGED_LOG, pushStatus: 1 });
  const result = tagRelease(project(t, CHANGELOG, '0.1.1'), git);
  assert.equal(result.code, 2);
  assert.equal(result.out, '');
  assert.match(result.text, /origin refused v0\.1\.1/);
});
