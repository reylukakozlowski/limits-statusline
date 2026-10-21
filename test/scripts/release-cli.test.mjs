import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runRelease } from '../../scripts/lib/release-cli.mjs';

const LOG = 'LS-5_feat: a\nLS-6_fix: b\n';
const NOTES = '- LS-5_feat: a\n- LS-6_fix: b';
const WRITES = ['git tag -a', 'git push', 'npm '];

function fakeGit({
  branch = 'develop', status = '', mergedTags = ['v0.0.9', 'v0.1.0'], headTags = [], otherTags = [], log = LOG,
  testStatus = 0, pushStatus = 0,
} = {}) {
  const calls = [];
  const exec = (command, args) => {
    const call = [command, ...args].join(' ');
    calls.push(call);
    if (command === 'npm') return { status: testStatus, stdout: '' };
    if (call === 'git rev-parse --abbrev-ref HEAD') return { status: 0, stdout: `${branch}\n` };
    if (call === 'git status --porcelain') return { status: 0, stdout: status };
    if (call === 'git tag --list v*.*.* --points-at HEAD') return { status: 0, stdout: headTags.map((tag) => `${tag}\n`).join('') };
    if (call === 'git tag --list v*.*.* --merged HEAD') {
      return { status: 0, stdout: [...mergedTags, ...headTags].map((tag) => `${tag}\n`).join('') };
    }
    if (args[0] === 'rev-parse' && args.includes('--verify')) {
      const known = [...mergedTags, ...headTags, ...otherTags].some((tag) => args.at(-1) === `refs/tags/${tag}`);
      return { status: known ? 0 : 1, stdout: '' };
    }
    if (args[0] === 'log') return { status: 0, stdout: log };
    if (args[0] === 'push') return { status: pushStatus, stdout: '' };
    if (args[0] === 'tag') return { status: 0, stdout: '' };
    return { status: 64, stdout: '' };
  };
  const writes = () => calls.filter((call) => WRITES.some((write) => call.startsWith(write)));
  return { exec, calls, writes };
}

// plugin.json as a pull request left it on develop: the version the release makes.
const manifest = (version) => JSON.stringify({ name: 'limits-statusline', version });

const release = (git, argv, { manifestText = manifest('0.1.1') } = {}) => {
  const out = [];
  const err = [];
  const code = runRelease({
    argv, exec: git.exec, readManifest: () => manifestText,
    stdout: { write: (text) => out.push(text) }, stderr: { write: (text) => err.push(text) },
  });
  return { code, out: out.join(''), text: [...out, ...err].join('') };
};

test('a release tags develop\'s head with plugin.json\'s version, its message the subjects since the last tag', () => {
  const git = fakeGit();
  const result = release(git, []);
  assert.equal(result.code, 0, result.text);
  assert.equal(result.out, 'v0.1.1\n');
  assert.ok(git.calls.includes('git log --reverse --format=%s v0.1.0..HEAD'));
  assert.deepEqual(git.writes(), ['npm test', `git tag -a v0.1.1 -m v0.1.1 -m ${NOTES}`]);
  assert.match(result.text, /git push origin refs\/tags\/v0\.1\.1/);
  assert.match(result.text, /Release workflow/);
});

test('release --push pushes the tag to origin and makes no commit, branch or pull request', () => {
  const git = fakeGit();
  const result = release(git, ['--push'], { manifestText: manifest('0.2.0') });
  assert.equal(result.code, 0, result.text);
  assert.equal(result.out, 'v0.2.0\n');
  assert.deepEqual(git.writes(), ['npm test', `git tag -a v0.2.0 -m v0.2.0 -m ${NOTES}`, 'git push origin refs/tags/v0.2.0']);
  assert.ok(!git.calls.some((call) => /^git (commit|switch|branch|add)\b|^gh /.test(call)));
});

test('release takes whatever higher version plugin.json carries, a minor or a major too', () => {
  const git = fakeGit();
  const result = release(git, ['--push'], { manifestText: manifest('0.3.0') });
  assert.equal(result.code, 0, result.text);
  assert.equal(result.out, 'v0.3.0\n');
});

test('the first release, with no version tag yet, takes plugin.json\'s version and lists every commit', () => {
  const git = fakeGit({ mergedTags: [] });
  const result = release(git, [], { manifestText: manifest('0.0.1') });
  assert.equal(result.code, 0, result.text);
  assert.equal(result.out, 'v0.0.1\n');
  assert.ok(git.calls.includes('git log --reverse --format=%s HEAD'));
});

test('release refuses outside develop or with a dirty tree, before the tests and without writing', () => {
  for (const options of [{ branch: 'master' }, { status: ' M README.md\n' }]) {
    const git = fakeGit(options);
    const result = release(git, ['--push']);
    assert.equal(result.code, 2, JSON.stringify(options));
    assert.equal(result.out, '');
    assert.deepEqual(git.writes(), []);
  }
});

test('release refuses a version whose tag already exists elsewhere, before the tests', () => {
  const git = fakeGit({ otherTags: ['v0.1.1'] });
  const result = release(git, ['--push']);
  assert.equal(result.code, 2);
  assert.match(result.text, /tag v0\.1\.1 already exists/);
  assert.deepEqual(git.writes(), []);
});

test('release refuses a plugin.json version that is not higher, or that is not a version, without running the tests', () => {
  const manifests = [manifest('0.1.0'), manifest('0.0.9'), manifest('latest'), JSON.stringify({ name: 'x' }), '{ not json'];
  for (const manifestText of manifests) {
    const git = fakeGit();
    const result = release(git, [], { manifestText });
    assert.equal(result.code, 2, manifestText);
    assert.match(result.text, /plugin\.json/, manifestText);
    assert.deepEqual(git.writes(), [], manifestText);
  }
});

test('release refuses when no commit came since the last tag', () => {
  const git = fakeGit({ log: '\n' });
  const result = release(git, []);
  assert.equal(result.code, 2);
  assert.match(result.text, /no commits to release/);
  assert.deepEqual(git.writes(), []);
});

test('release stops before tagging when the tests fail', () => {
  const git = fakeGit({ testStatus: 1 });
  const result = release(git, ['--push']);
  assert.equal(result.code, 2);
  assert.match(result.text, /tests failed/);
  assert.equal(result.out, '');
  assert.deepEqual(git.writes(), ['npm test']);
});

test('release --dry-run runs the checks and the tests, shows the notes, and writes and prints no tag', () => {
  const git = fakeGit();
  const result = release(git, ['--dry-run', '--push'], { manifestText: manifest('1.0.0') });
  assert.equal(result.code, 0, result.text);
  assert.equal(result.out, '');
  assert.match(result.text, /0\.1\.0 → 1\.0\.0/);
  assert.match(result.text, /- LS-6_fix: b/);
  assert.deepEqual(git.writes(), ['npm test']);
});

test('release --dry-run fails like a release when the tests fail', () => {
  const result = release(fakeGit({ testStatus: 1 }), ['--dry-run']);
  assert.equal(result.code, 2);
  assert.match(result.text, /tests failed/);
});

test('a head that already carries a version tag is that release, to finish: no new tag, the tag is pushed again', () => {
  const git = fakeGit({ headTags: ['v0.1.1'] });
  const result = release(git, ['--push'], { manifestText: manifest('0.2.0') });
  assert.equal(result.code, 0, result.text);
  assert.equal(result.out, 'v0.1.1\n');
  assert.match(result.text, /already v0\.1\.1/);
  assert.deepEqual(git.writes(), ['npm test', 'git push origin refs/tags/v0.1.1']);
});

test('release reports a tag origin refused, printing no tag', () => {
  const git = fakeGit({ pushStatus: 1 });
  const result = release(git, ['--push']);
  assert.equal(result.code, 2);
  assert.equal(result.out, '');
  assert.match(result.text, /origin refused v0\.1\.1; the tag exists only in this clone/);
});

test('release with a version argument, or with an unknown option, is a usage error that runs nothing', () => {
  for (const argv of [['patch'], ['0.1.1', '--push'], ['--force']]) {
    const git = fakeGit();
    const result = release(git, argv);
    assert.equal(result.code, 1, argv.join(' '));
    assert.deepEqual(git.calls, [], argv.join(' '));
  }
  assert.match(release(fakeGit(), ['patch']).text, /takes no version: it releases the version in \.claude-plugin\/plugin\.json/);
});
