import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runPrepare } from '../../scripts/lib/prepare-cli.mjs';

const manifest = (version) => `{\n  "name": "limits-statusline",\n  "version": "${version}"\n}\n`;
const WRITES = ['git switch', 'git add', 'git commit', 'git push', 'gh '];
const PR_URL = 'https://github.com/reylukakozlowski/limits-statusline/pull/77';

function fakeRepo({
  branch = 'develop', status = '', tags = ['v1.0.9', 'v1.0.10'], since = 'LS-55_feat: a\n',
  subjects = 'LS-55_feat: a\nLS-54_chore: b\n', branches = 'develop\norigin/develop\norigin/feature/lko/develop/LS-56_x\n',
  remoteBranch = false, version = '1.0.10', commitStatus = 0, pushStatus = 0, prStatus = 0,
} = {}) {
  const calls = [];
  const written = [];
  const exec = (command, args) => {
    const call = [command, ...args].join(' ');
    calls.push(call);
    if (command === 'gh') return { status: prStatus, stdout: prStatus === 0 ? `${PR_URL}\n` : '' };
    if (call === 'git rev-parse --abbrev-ref HEAD') return { status: 0, stdout: `${branch}\n` };
    if (call === 'git status --porcelain') return { status: 0, stdout: status };
    if (call === 'git tag --list v*.*.* --merged HEAD') return { status: 0, stdout: tags.map((tag) => `${tag}\n`).join('') };
    if (args[0] === 'log' && args.includes('--all')) return { status: 0, stdout: subjects };
    if (args[0] === 'log') return { status: 0, stdout: since };
    if (args[0] === 'for-each-ref') return { status: 0, stdout: branches };
    if (args[0] === 'ls-remote') {
      return { status: 0, stdout: remoteBranch ? 'abc123\trefs/heads/feature/lko/develop/LS-50_version-1.0.11\n' : '' };
    }
    if (args[0] === 'commit') return { status: commitStatus, stdout: '' };
    if (args[0] === 'push') return { status: pushStatus, stdout: '' };
    if (args[0] === 'switch' || args[0] === 'add') return { status: 0, stdout: '' };
    return { status: 64, stdout: '' };
  };
  const writes = () => calls.filter((call) => WRITES.some((write) => call.startsWith(write)));
  return { exec, calls, writes, written, readManifest: () => manifest(version), writeManifest: (text) => written.push(text) };
}

const prepare = (repo, argv) => {
  const out = [];
  const err = [];
  const code = runPrepare({
    argv, exec: repo.exec, readManifest: repo.readManifest, writeManifest: repo.writeManifest,
    stdout: { write: (text) => out.push(text) }, stderr: { write: (text) => err.push(text) },
  });
  return { code, out: out.join(''), text: [...out, ...err].join('') };
};

const BRANCH = 'feature/lko/develop/LS-57_version-1.0.11';
const TITLE = 'LS-57_chore: plugin.json says 1.0.11, the version the next release tags';

test('prepare raises plugin.json from the last release on a new branch, in one commit', () => {
  const repo = fakeRepo();
  const result = prepare(repo, ['patch']);
  assert.equal(result.code, 0, result.text);
  assert.equal(result.out, `${BRANCH}\n`);
  assert.deepEqual(repo.written, [manifest('1.0.11')]);
  const [switched, added, committed, ...rest] = repo.writes();
  assert.deepEqual([switched, added, rest], [`git switch -c ${BRANCH}`, 'git add .claude-plugin/plugin.json', []]);
  assert.ok(committed.startsWith(`git commit -q -m ${TITLE} -m `), committed);
  assert.match(result.text, /git push origin/);
});

test('prepare names the next number after every LS-<n> in commits and branches, open ones too', () => {
  const repo = fakeRepo({ subjects: 'LS-60_fix: c\n', branches: 'origin/develop\n' });
  assert.equal(prepare(repo, ['minor']).out, 'feature/lko/develop/LS-61_version-1.1.0\n');
});

test('prepare --push pushes the branch and opens a draft pull request into develop, printing its address', () => {
  const repo = fakeRepo();
  const result = prepare(repo, ['major', '--push']);
  assert.equal(result.code, 0, result.text);
  assert.equal(result.out, `${PR_URL}\n`);
  const branch = 'feature/lko/develop/LS-57_version-2.0.0';
  assert.ok(repo.calls.includes(`git push origin ${branch}`));
  const pr = repo.calls.find((call) => call.startsWith('gh pr create'));
  assert.match(pr, new RegExp(`^gh pr create --draft --base develop --head ${branch} --title LS-57_chore: plugin\\.json says 2\\.0\\.0`));
});

test('prepare --dry-run shows the plan and writes nothing', () => {
  const repo = fakeRepo();
  const result = prepare(repo, ['patch', '--dry-run', '--push']);
  assert.equal(result.code, 0, result.text);
  assert.equal(result.out, '');
  assert.match(result.text, /1\.0\.10 → 1\.0\.11/);
  assert.match(result.text, new RegExp(BRANCH));
  assert.deepEqual(repo.writes(), []);
  assert.deepEqual(repo.written, []);
});

test('prepare does nothing when plugin.json already says the version the bump gives', () => {
  const repo = fakeRepo({ version: '1.0.11' });
  const result = prepare(repo, ['patch', '--push']);
  assert.equal(result.code, 0, result.text);
  assert.equal(result.out, '');
  assert.match(result.text, /already says 1\.0\.11/);
  assert.deepEqual(repo.writes(), []);
});

test('prepare refuses outside develop, with a dirty tree, or with nothing released since the last tag', () => {
  for (const options of [{ branch: 'master' }, { status: ' M README.md\n' }, { since: '\n' }]) {
    const repo = fakeRepo(options);
    const result = prepare(repo, ['patch', '--push']);
    assert.equal(result.code, 2, JSON.stringify(options));
    assert.deepEqual(repo.writes(), [], JSON.stringify(options));
  }
});

test('prepare refuses a plugin.json raised by hand to another version, and a branch that exists already', () => {
  for (const options of [{ version: '1.2.0' }, { remoteBranch: true }]) {
    const repo = fakeRepo(options);
    const result = prepare(repo, ['patch', '--push']);
    assert.equal(result.code, 2, JSON.stringify(options));
    assert.deepEqual(repo.writes(), [], JSON.stringify(options));
  }
  assert.match(prepare(fakeRepo({ version: '1.2.0' }), ['patch']).text, /says 1\.2\.0/);
  assert.match(prepare(fakeRepo({ remoteBranch: true }), ['patch']).text, /LS-50_version-1\.0\.11 prepares 1\.0\.11 already/);
});

test('prepare looks on origin for any branch preparing the version, whatever its number', () => {
  const repo = fakeRepo();
  prepare(repo, ['patch']);
  assert.ok(repo.calls.includes('git ls-remote --heads origin feature/lko/develop/*_version-1.0.11'));
});

test('prepare reports a commit, push or pull request that fails, and prints no address', () => {
  for (const options of [{ commitStatus: 1 }, { pushStatus: 1 }, { prStatus: 1 }]) {
    const result = prepare(fakeRepo(options), ['patch', '--push']);
    assert.equal(result.code, 2, JSON.stringify(options));
    assert.equal(result.out, '', JSON.stringify(options));
  }
});

test('prepare without a part to raise, with another word, or with an unknown option is a usage error that runs nothing', () => {
  for (const argv of [[], ['bump'], ['1.0.11'], ['patch', 'minor'], ['patch', '--force']]) {
    const repo = fakeRepo();
    assert.equal(prepare(repo, argv).code, 1, argv.join(' '));
    assert.deepEqual(repo.calls, [], argv.join(' '));
  }
});
