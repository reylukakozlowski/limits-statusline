import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runRelease } from '../../scripts/lib/release-cli.mjs';

const HEAD = 'a'.repeat(40);
const PREVIOUS = 'b'.repeat(40);
const MASTER = 'c'.repeat(40);
const TREE = 'd'.repeat(40);
const RELEASED = 'e'.repeat(40);
const LOG = 'LS-5_feat: a\nLS-6_fix: b\n';
const NOTES = '- LS-5_feat: a\n- LS-6_fix: b';
const MANIFEST = '{\n  "name": "demo"\n}\n';
const WRITES = ['git add', 'git write-tree', 'git commit-tree', 'git tag -a', 'git push', 'npm '];

function fakeGit({
  branch = 'develop', status = '', tags = ['v0.0.9', 'v0.1.0'], previousMessage = 'LS-4_docs: released the old way',
  log = LOG, tagExists = false, master = MASTER, masterHasPrevious = true, testStatus = 0, writeTreeStatus = 0, pushStatus = {},
} = {}) {
  const calls = [];
  const manifests = [];
  const exec = (command, args) => {
    const call = [command, ...args].join(' ');
    calls.push(call);
    if (command === 'npm') return { status: testStatus, stdout: '' };
    if (call === 'git rev-parse --abbrev-ref HEAD') return { status: 0, stdout: `${branch}\n` };
    if (call === 'git status --porcelain') return { status: 0, stdout: status };
    if (call === 'git rev-parse HEAD') return { status: 0, stdout: `${HEAD}\n` };
    if (call === 'git tag --list v*.*.*') return { status: 0, stdout: tags.map((tag) => `${tag}\n`).join('') };
    if (call === 'git rev-parse v0.1.0^{commit}') return { status: 0, stdout: `${PREVIOUS}\n` };
    if (call === `git log -1 --format=%B ${PREVIOUS}`) return { status: 0, stdout: `${previousMessage}\n` };
    if (call.startsWith('git rev-parse --quiet --verify refs/tags/')) return { status: tagExists ? 0 : 1, stdout: '' };
    if (call === `git merge-base --is-ancestor ${PREVIOUS} ${MASTER}`) return { status: masterHasPrevious ? 0 : 1, stdout: '' };
    if (call.startsWith('git merge-base --is-ancestor')) return { status: 0, stdout: '' };
    if (args[0] === 'log' && args.includes('--reverse')) return { status: 0, stdout: log };
    if (call === 'git rev-parse --quiet --verify refs/remotes/origin/master') return { status: master ? 0 : 1, stdout: master ? `${master}\n` : '' };
    if (args[0] === 'add') return { status: 0, stdout: '' };
    if (args[0] === 'write-tree') return { status: writeTreeStatus, stdout: `${TREE}\n` };
    if (args[0] === 'commit-tree') return { status: 0, stdout: `${RELEASED}\n` };
    if (args[0] === 'tag') return { status: 0, stdout: '' };
    if (args[0] === 'push') return { status: pushStatus[args[2]] ?? 0, stdout: '' };
    return { status: 64, stdout: '' };
  };
  const writes = () => calls.filter((call) => WRITES.some((write) => call.startsWith(write)));
  return { exec, calls, writes, manifests, readManifest: () => MANIFEST, writeManifest: (text) => manifests.push(text) };
}

const release = (git, argv) => {
  const out = [];
  const err = [];
  const code = runRelease({
    argv, exec: git.exec, readManifest: git.readManifest, writeManifest: git.writeManifest,
    stdout: { write: (text) => out.push(text) }, stderr: { write: (text) => err.push(text) },
  });
  return { code, out: out.join(''), text: [...out, ...err].join('') };
};

test('a release builds one commit on master with develop\'s tree and the version, and tags it', () => {
  const git = fakeGit();
  const result = release(git, ['patch']);
  assert.equal(result.code, 0, result.text);
  assert.equal(result.out, 'v0.1.1\n');
  assert.deepEqual(git.writes(), [
    'npm test',
    'git add .claude-plugin/plugin.json',
    'git write-tree',
    'git add .claude-plugin/plugin.json',
    `git commit-tree ${TREE} -p ${MASTER} -m Release v0.1.1 -m ${NOTES} -m Source: develop@${HEAD}`,
    `git tag -a v0.1.1 ${RELEASED} -m v0.1.1 -m ${NOTES}`,
  ]);
  // The manifest gets the version for the tree, then goes back as it was.
  assert.deepEqual(git.manifests, ['{\n  "name": "demo",\n  "version": "0.1.1"\n}\n', MANIFEST]);
  assert.ok(git.calls.includes(`git log --reverse --format=%s ${PREVIOUS}..HEAD`));
});

test('release --push pushes the tag first, then master to the release commit, and makes no branch or pull request', () => {
  const git = fakeGit();
  const result = release(git, ['minor', '--push']);
  assert.equal(result.code, 0, result.text);
  assert.equal(result.out, 'v0.2.0\n');
  assert.deepEqual(git.writes().filter((call) => call.startsWith('git push')), [
    'git push origin refs/tags/v0.2.0', `git push origin ${RELEASED}:refs/heads/master`,
  ]);
  assert.ok(!git.calls.some((call) => /^git (commit |switch|branch|checkout)|^gh /.test(call)));
});

test('the notes start after the develop commit the last release names in its message', () => {
  const source = 'f'.repeat(40);
  const git = fakeGit({ previousMessage: `Release v0.1.0\n\n- LS-3_feat: x\n\nSource: develop@${source}` });
  assert.equal(release(git, ['patch']).code, 0);
  assert.ok(git.calls.includes(`git log --reverse --format=%s ${source}..HEAD`));
});

test('the first release, with no version tag and no master, is a commit of its own and counts every commit', () => {
  const git = fakeGit({ tags: [], master: null });
  const result = release(git, ['patch']);
  assert.equal(result.code, 0, result.text);
  assert.equal(result.out, 'v0.0.1\n');
  assert.ok(git.calls.includes('git log --reverse --format=%s HEAD'));
  assert.ok(git.calls.some((call) => call.startsWith(`git commit-tree ${TREE} -m Release v0.0.1`)));
});

test('a develop head the latest release was made from is that release, finished: no new commit, tag and master pushed again', () => {
  const git = fakeGit({ previousMessage: `Release v0.1.0\n\nSource: develop@${HEAD}` });
  const result = release(git, ['patch', '--push']);
  assert.equal(result.code, 0, result.text);
  assert.equal(result.out, 'v0.1.0\n');
  assert.match(result.text, /finishing v0\.1\.0 .*: develop has nothing new since it/);
  assert.deepEqual(git.writes(), ['npm test', 'git push origin refs/tags/v0.1.0', `git push origin ${PREVIOUS}:refs/heads/master`]);
});

test('a latest release that master lacks is finished before a new one, even after develop moved on', () => {
  const git = fakeGit({ masterHasPrevious: false });
  const result = release(git, ['minor', '--push']);
  assert.equal(result.code, 0, result.text);
  assert.equal(result.out, 'v0.1.0\n');
  assert.match(result.text, /finishing v0\.1\.0 .*: master lacks it/);
  assert.deepEqual(git.writes(), ['npm test', 'git push origin refs/tags/v0.1.0', `git push origin ${PREVIOUS}:refs/heads/master`]);
  const dry = fakeGit({ masterHasPrevious: false });
  assert.equal(release(dry, ['patch', '--dry-run']).code, 0);
  assert.deepEqual(dry.writes(), ['npm test']);
});

test('release refuses off develop, with a dirty tree, or with a taken tag, before the tests and without writing', () => {
  for (const options of [{ branch: 'master' }, { status: ' M README.md\n' }, { tagExists: true }]) {
    const git = fakeGit(options);
    const result = release(git, ['patch', '--push']);
    assert.equal(result.code, 2, JSON.stringify(options));
    assert.equal(result.out, '');
    assert.deepEqual(git.writes(), [], JSON.stringify(options));
  }
});

test('release stops before writing when the tests fail, and a dry run writes nothing either way', () => {
  const failing = fakeGit({ testStatus: 1 });
  assert.equal(release(failing, ['patch', '--push']).code, 2);
  assert.deepEqual(failing.writes(), ['npm test']);
  const dry = fakeGit();
  const result = release(dry, ['major', '--dry-run', '--push']);
  assert.equal(result.code, 0, result.text);
  assert.equal(result.out, '');
  assert.match(result.text, /0\.1\.0 → 1\.0\.0/);
  assert.match(result.text, /- LS-6_fix: b/);
  assert.deepEqual(dry.writes(), ['npm test']);
  assert.deepEqual(dry.manifests, []);
});

test('a failure while building the tree puts the manifest back as it was', () => {
  const git = fakeGit({ writeTreeStatus: 1 });
  const result = release(git, ['patch']);
  assert.equal(result.code, 2);
  assert.deepEqual(git.manifests.at(-1), MANIFEST);
  assert.ok(!git.calls.some((call) => call.startsWith('git commit-tree') || call.startsWith('git tag -a')));
});

test('release reports a tag or master that origin refused, printing no tag', () => {
  for (const [refspec, pattern] of [['refs/tags/v0.1.1', /origin refused v0\.1\.1/], [`${RELEASED}:refs/heads/master`, /refused to move master/]]) {
    const result = release(fakeGit({ pushStatus: { [refspec]: 1 } }), ['patch', '--push']);
    assert.equal(result.code, 2, refspec);
    assert.equal(result.out, '', refspec);
    assert.match(result.text, pattern, refspec);
  }
});

test('release without a part to raise, with another word, or with an unknown option is a usage error that runs nothing', () => {
  for (const argv of [[], ['bump'], ['0.1.1'], ['patch', 'minor'], ['patch', '--force']]) {
    const git = fakeGit();
    assert.equal(release(git, argv).code, 1, argv.join(' '));
    assert.deepEqual(git.calls, [], argv.join(' '));
  }
});
