import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runRelease } from '../../scripts/lib/release-cli.mjs';

const HEAD = 'a'.repeat(40);
const MASTER = 'c'.repeat(40);
const TREE = 'd'.repeat(40);
const RELEASED = 'e'.repeat(40);
const OLD_MASTER = 'f'.repeat(40);
// The develop commit the release on master's head was made from: its second parent.
const RELEASED_SOURCE = '1'.repeat(40);
const LOG = 'LS-5_feat: a\nLS-6_fix: b\n';
const NOTES = '- LS-5_feat: a\n- LS-6_fix: b';
const MANIFEST = '{\n  "name": "demo"\n}\n';
const WRITES = ['git add', 'git write-tree', 'git commit-tree', 'git checkout', 'git tag -a', 'git push', 'npm '];

function fakeGit({
  branch = 'develop', status = '', tags = ['v0.0.9', 'v0.1.0'], log = LOG, tagExists = false, master = MASTER,
  masterParents = [OLD_MASTER, RELEASED_SOURCE], inMaster = false, holdsReleasedSource = true, onDevelop = true,
  testStatus = 0, releaseTestStatus = testStatus, writeTreeStatus = 0,
} = {}) {
  const calls = [];
  const manifests = [];
  let checkedOut = null; // the commit checked out to test, while it is
  const exec = (command, args) => {
    const call = [command, ...args].join(' ');
    calls.push(call);
    if (command === 'npm') return { status: checkedOut === RELEASED ? releaseTestStatus : testStatus, stdout: '' };
    if (args[0] === 'checkout') {
      checkedOut = args.at(-1);
      return { status: 0, stdout: '' };
    }
    if (call === 'git rev-parse --abbrev-ref HEAD') return { status: 0, stdout: `${branch}\n` };
    if (call === 'git status --porcelain') return { status: 0, stdout: status };
    if (call === 'git rev-parse HEAD') return { status: 0, stdout: `${HEAD}\n` };
    if (call === 'git tag --list v*.*.*') return { status: 0, stdout: tags.map((tag) => `${tag}\n`).join('') };
    if (call.startsWith('git rev-parse --quiet --verify refs/tags/')) return { status: tagExists ? 0 : 1, stdout: '' };
    if (call === 'git merge-base --is-ancestor HEAD refs/remotes/origin/develop') return { status: onDevelop ? 0 : 1, stdout: '' };
    if (call === `git merge-base --is-ancestor HEAD ${MASTER}`) return { status: inMaster ? 0 : 1, stdout: '' };
    if (call === `git merge-base --is-ancestor ${RELEASED_SOURCE} HEAD`) return { status: holdsReleasedSource ? 0 : 1, stdout: '' };
    if (call === `git rev-list --parents -n 1 ${MASTER}`) return { status: 0, stdout: `${[MASTER, ...masterParents].join(' ')}\n` };
    if (args[0] === 'log' && args.includes('--reverse')) return { status: 0, stdout: log };
    if (call === 'git rev-parse --quiet --verify refs/remotes/origin/master') return { status: master ? 0 : 1, stdout: master ? `${master}\n` : '' };
    if (args[0] === 'add') return { status: 0, stdout: '' };
    if (args[0] === 'write-tree') return { status: writeTreeStatus, stdout: `${TREE}\n` };
    if (args[0] === 'commit-tree') return { status: 0, stdout: `${RELEASED}\n` };
    if (args[0] === 'tag') return { status: 0, stdout: '' };
    return { status: 64, stdout: '' };
  };
  const writes = () => calls.filter((call) => WRITES.some((write) => call.startsWith(write)));
  return { exec, calls, writes, manifests, readManifest: () => MANIFEST, writeManifest: (text) => manifests.push(text) };
}

const release = (git, argv, { note } = {}) => {
  const out = [];
  const err = [];
  const code = runRelease({
    argv, note, exec: git.exec, readManifest: git.readManifest, writeManifest: git.writeManifest,
    stdout: { write: (text) => out.push(text) }, stderr: { write: (text) => err.push(text) },
  });
  return { code, out: out.join(''), text: [...out, ...err].join('') };
};

test('a release merges develop into master: develop\'s tree and the version, on master\'s head and develop\'s commit, tested, then tagged', () => {
  const git = fakeGit();
  const result = release(git, ['patch']);
  assert.equal(result.code, 0, result.text);
  assert.equal(result.out, 'v0.1.1\n');
  assert.deepEqual(git.writes(), [
    'git add .claude-plugin/plugin.json',
    'git write-tree',
    'git add .claude-plugin/plugin.json',
    // No trailer: the second parent is the develop commit.
    `git commit-tree ${TREE} -p ${MASTER} -p ${HEAD} -m Release v0.1.1 -m ${NOTES}`,
    // The tests run on the release commit itself, the files master gets, before it is tagged.
    `git checkout --quiet --detach ${RELEASED}`,
    'npm test',
    'git checkout --quiet develop',
    // verbatim: git tag's default cleanup would drop a note line that starts with '#'.
    `git tag -a --cleanup=verbatim v0.1.1 ${RELEASED} -m v0.1.1 -m ${NOTES}`,
  ]);
  // The manifest gets the version for the tree, then goes back as it was.
  assert.deepEqual(git.manifests, ['{\n  "name": "demo",\n  "version": "0.1.1"\n}\n', MANIFEST]);
  // The notes are what master lacks: develop's commits since the release on master's head.
  assert.ok(git.calls.includes(`git log --reverse --no-merges --format=%s ${MASTER}..HEAD`), git.calls.join('\n'));
});

test('the owner\'s note leads the notes, in the release commit\'s message and in the tag', () => {
  const git = fakeGit();
  const result = release(git, ['patch'], { note: 'Faster start-up.' });
  assert.equal(result.code, 0, result.text);
  const notes = `Faster start-up.\n\n${NOTES}`;
  assert.ok(git.calls.includes(`git commit-tree ${TREE} -p ${MASTER} -p ${HEAD} -m Release v0.1.1 -m ${notes}`), git.calls.join('\n'));
  assert.ok(git.calls.includes(`git tag -a --cleanup=verbatim v0.1.1 ${RELEASED} -m v0.1.1 -m ${notes}`), git.calls.join('\n'));
});

// The Release workflow's promote job checks the release commit and pushes it with the deploy key.
test('release pushes nothing and makes no branch or pull request; it checks out only the release commit, and back', () => {
  const git = fakeGit();
  const result = release(git, ['minor']);
  assert.equal(result.code, 0, result.text);
  assert.equal(result.out, 'v0.2.0\n');
  assert.ok(!git.calls.some((call) => /^git (push|commit |switch|branch)|^gh /.test(call)), git.calls.join('\n'));
  assert.deepEqual(git.calls.filter((call) => call.startsWith('git checkout')), [
    `git checkout --quiet --detach ${RELEASED}`,
    'git checkout --quiet develop',
  ]);
});

// The Release workflow checks out the run's commit, so HEAD is detached there.
test('from a detached develop commit the release goes back to that commit after its tests', () => {
  const git = fakeGit({ branch: 'HEAD' });
  assert.equal(release(git, ['patch']).code, 0);
  assert.equal(git.calls.filter((call) => call.startsWith('git checkout')).at(-1), `git checkout --quiet ${HEAD}`);
});

test('tests failing on the release commit stop the release: no tag, and the clone goes back to develop', () => {
  const git = fakeGit({ releaseTestStatus: 1 });
  const result = release(git, ['patch']);
  assert.equal(result.code, 2);
  assert.equal(result.out, '');
  assert.match(result.text, /tests failed on the release commit eeeeeee; nothing was tagged/);
  assert.ok(!git.calls.some((call) => call.startsWith('git tag -a')), git.calls.join('\n'));
  assert.equal(git.calls.at(-1), 'git checkout --quiet develop');
});

test('the first release, with no version tag and no master, sits on develop\'s commit alone and counts every commit', () => {
  const git = fakeGit({ tags: [], master: null });
  const result = release(git, ['patch']);
  assert.equal(result.code, 0, result.text);
  assert.equal(result.out, 'v0.0.1\n');
  assert.ok(git.calls.includes('git log --reverse --no-merges --format=%s HEAD'));
  assert.ok(git.calls.some((call) => call.startsWith(`git commit-tree ${TREE} -p ${HEAD} -m Release v0.0.1`)), git.calls.join('\n'));
});

// Nothing is released twice: master holds every develop commit a release brought.
test('a develop commit master already holds is refused: nothing new since the last release, nothing written', () => {
  const git = fakeGit({ inMaster: true });
  const result = release(git, ['patch']);
  assert.equal(result.code, 2);
  assert.equal(result.out, '');
  assert.match(result.text, /develop at aaaaaaa is in master already: nothing new since the last release/);
  assert.deepEqual(git.writes(), []);
});

// develop only moves forward: a develop without the commit the last release was made from would
// put older files on master under a new version.
test('a develop commit that lacks the one the release on master was made from is refused', () => {
  const git = fakeGit({ holdsReleasedSource: false });
  const result = release(git, ['patch']);
  assert.equal(result.code, 2);
  assert.match(result.text, new RegExp(`develop at aaaaaaa lacks ${RELEASED_SOURCE.slice(0, 7)}, the develop commit of the release on master`));
  assert.deepEqual(git.writes(), []);
});

// v1.0.11 to v1.0.14 were one-parent commits on master; a head like that names no develop commit.
test('a one-parent release on master\'s head has no develop commit to compare, and the release goes on', () => {
  const git = fakeGit({ masterParents: [OLD_MASTER], holdsReleasedSource: false });
  assert.equal(release(git, ['patch']).code, 0);
  assert.ok(!git.calls.some((call) => call.startsWith('git merge-base --is-ancestor 1')), git.calls.join('\n'));
});

test('release refuses a commit origin\'s develop lacks, a dirty tree or a taken tag, before the tests and without writing', () => {
  for (const options of [{ onDevelop: false, branch: 'feature/x' }, { status: ' M README.md\n' }, { tagExists: true }]) {
    const git = fakeGit(options);
    const result = release(git, ['patch']);
    assert.equal(result.code, 2, JSON.stringify(options));
    assert.equal(result.out, '');
    assert.deepEqual(git.writes(), [], JSON.stringify(options));
  }
  assert.match(release(fakeGit({ onDevelop: false, branch: 'feature/x' }), ['patch']).text, /feature\/x is not on origin\/develop/);
});

test('a dry run tests develop\'s commit and writes nothing, whether the tests pass or fail', () => {
  const failing = fakeGit({ testStatus: 1 });
  assert.equal(release(failing, ['patch', '--dry-run']).code, 2);
  assert.deepEqual(failing.writes(), ['npm test']);
  const dry = fakeGit();
  const result = release(dry, ['major', '--dry-run'], { note: 'Faster start-up.' });
  assert.equal(result.code, 0, result.text);
  assert.equal(result.out, '');
  assert.match(result.text, /0\.1\.0 → 1\.0\.0/);
  assert.match(result.text, /Faster start-up\.\n\n- LS-5_feat: a\n- LS-6_fix: b/);
  assert.deepEqual(dry.writes(), ['npm test']);
  assert.deepEqual(dry.manifests, []);
});

test('a dry run refuses what the release refuses: a develop commit master already holds', () => {
  const git = fakeGit({ inMaster: true });
  assert.equal(release(git, ['patch', '--dry-run']).code, 2);
  assert.deepEqual(git.writes(), []);
});

test('a failure while building the tree puts the manifest back as it was', () => {
  const git = fakeGit({ writeTreeStatus: 1 });
  const result = release(git, ['patch']);
  assert.equal(result.code, 2);
  assert.deepEqual(git.manifests.at(-1), MANIFEST);
  assert.ok(!git.calls.some((call) => call.startsWith('git commit-tree') || call.startsWith('git tag -a')));
});

test('release without a part to raise, with another word, or with an unknown option is a usage error that runs nothing', () => {
  for (const argv of [[], ['bump'], ['0.1.1'], ['patch', 'minor'], ['patch', '--force'], ['patch', '--push']]) {
    const git = fakeGit();
    assert.equal(release(git, argv).code, 1, argv.join(' '));
    assert.deepEqual(git.calls, [], argv.join(' '));
  }
});
