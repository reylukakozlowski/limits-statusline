import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MASTER_RULES, preflightProblems, runPreflight } from '../../scripts/lib/release-preflight.mjs';

const REPO = 'owner/repo';
const STANDARD_RULES = MASTER_RULES.map((type) => ({ type, ruleset_id: 1 }));
const PRODUCTION = {
  name: 'production',
  deployment_branch_policy: { protected_branches: false, custom_branch_policies: true },
  protection_rules: [
    { type: 'required_reviewers', prevent_self_review: false, reviewers: [{ type: 'User', reviewer: { login: 'Owner' } }] },
    { type: 'branch_policy' },
  ],
};
const DEVELOP_ONLY = [{ id: 7, name: 'develop', type: 'branch' }];

const ready = (overrides = {}) => ({
  masterRules: STANDARD_RULES, environment: PRODUCTION, branchPolicies: DEVELOP_ONLY, masterBehindHead: true, owner: 'owner', ...overrides,
});

test('a repository set up to the production standard, with master behind develop\'s head, is ready', () => {
  assert.deepEqual(preflightProblems(ready()), []);
});

test('the first release, before master exists, is ready too', () => {
  assert.deepEqual(preflightProblems(ready({ masterBehindHead: null })), []);
});

test('a master with commits develop\'s head lacks stops the release before its tag', () => {
  const [problem, ...rest] = preflightProblems(ready({ masterBehindHead: false }));
  assert.deepEqual(rest, []);
  assert.match(problem, /^master has commits that develop's head lacks/);
});

test('a rule besides the two rulesets, such as a required status check, would refuse the deploy key\'s push', () => {
  const masterRules = [...STANDARD_RULES, { type: 'required_status_checks', parameters: { required_status_checks: [{ context: 'x' }] } }];
  const [problem] = preflightProblems(ready({ masterRules }));
  assert.match(problem, /^master's rules are \[creation, deletion, non_fast_forward, required_linear_history, required_status_checks, update\]/);
});

test('missing rulesets count as well: without them anyone with write access could move master', () => {
  for (const masterRules of [[], STANDARD_RULES.filter((rule) => rule.type !== 'update')]) {
    assert.equal(preflightProblems(ready({ masterRules })).length, 1, JSON.stringify(masterRules));
  }
});

test('without the environment production nothing holds the deploy key', () => {
  const problems = preflightProblems(ready({ environment: null, branchPolicies: [] }));
  assert.equal(problems.length, 1);
  assert.match(problems[0], /environment production is missing/);
});

test('production has to deploy from develop alone', () => {
  const cases = [
    [{ ...PRODUCTION, deployment_branch_policy: null }, [], /from any branch/],
    [{ ...PRODUCTION, deployment_branch_policy: { protected_branches: true, custom_branch_policies: false } }, [], /from no branch/],
    [PRODUCTION, [...DEVELOP_ONLY, { id: 8, name: 'feature/*', type: 'branch' }], /from branch:develop, branch:feature\/\*/],
    [PRODUCTION, [{ id: 9, name: 'develop', type: 'tag' }], /from tag:develop/],
  ];
  for (const [environment, branchPolicies, pattern] of cases) {
    const problems = preflightProblems(ready({ environment, branchPolicies }));
    assert.equal(problems.length, 1, String(pattern));
    assert.match(problems[0], pattern);
  }
});

test('production has to wait for the owner\'s approval; the login is compared without case', () => {
  const someoneElse = { ...PRODUCTION, protection_rules: [{ type: 'required_reviewers', reviewers: [{ type: 'User', reviewer: { login: 'other' } }] }] };
  for (const environment of [{ ...PRODUCTION, protection_rules: [] }, someoneElse]) {
    const problems = preflightProblems(ready({ environment }));
    assert.deepEqual(problems, ["the environment production does not wait for owner's approval (CONTRIBUTING.md, master)."]);
  }
});

test('every problem is reported at once', () => {
  assert.equal(preflightProblems(ready({ masterBehindHead: false, masterRules: [], environment: null })).length, 3);
});

// --- runPreflight, against stand-ins for gh and git -----------------------------------------------

/** gh answers from `responses` (path → JSON, or null for a 404); git from the two flags. */
function fakeExec({ responses = {}, hasMaster = true, behind = true, ghFailure = null } = {}) {
  const calls = [];
  const exec = (command, args) => {
    calls.push([command, ...args].join(' '));
    if (command === 'gh') {
      if (ghFailure) return { status: 1, stdout: '', stderr: ghFailure };
      const body = responses[args[1]];
      return body === null || body === undefined
        ? { status: 1, stdout: '', stderr: 'gh: Not Found (HTTP 404)\n' }
        : { status: 0, stdout: JSON.stringify(body), stderr: '' };
    }
    if (args[0] === 'rev-parse') return { status: hasMaster ? 0 : 1, stdout: '', stderr: '' };
    if (args[0] === 'merge-base') return { status: behind ? 0 : 1, stdout: '', stderr: '' };
    return { status: 64, stdout: '', stderr: 'unexpected' };
  };
  return { exec, calls };
}

const STANDARD_RESPONSES = {
  [`repos/${REPO}/rules/branches/master?per_page=100`]: STANDARD_RULES,
  [`repos/${REPO}/environments/production`]: PRODUCTION,
  [`repos/${REPO}/environments/production/deployment-branch-policies?per_page=100`]: { total_count: 1, branch_policies: DEVELOP_ONLY },
};

const preflight = (fake, env = { GITHUB_REPOSITORY: REPO, GITHUB_REPOSITORY_OWNER: 'owner' }) => {
  const out = [];
  const code = runPreflight({ env, exec: fake.exec, stdout: { write: (text) => out.push(text) } });
  return { code, text: out.join('') };
};

test('runPreflight reads master\'s rules, production and the history, and passes a ready repository', () => {
  const fake = fakeExec({ responses: STANDARD_RESPONSES });
  const result = preflight(fake);
  assert.equal(result.code, 0, result.text);
  assert.match(result.text, /master can move forward/);
  assert.deepEqual(fake.calls, [
    `gh api repos/${REPO}/rules/branches/master?per_page=100`,
    `gh api repos/${REPO}/environments/production`,
    `gh api repos/${REPO}/environments/production/deployment-branch-policies?per_page=100`,
    'git rev-parse --quiet --verify refs/remotes/origin/master',
    'git merge-base --is-ancestor refs/remotes/origin/master HEAD',
  ]);
});

test('runPreflight prints each problem as a workflow error and exits 1', () => {
  const responses = { ...STANDARD_RESPONSES, [`repos/${REPO}/environments/production`]: null };
  const fake = fakeExec({ responses, behind: false });
  const result = preflight(fake);
  assert.equal(result.code, 1);
  assert.equal(result.text.match(/^::error::/gm).length, 2, result.text);
  assert.match(result.text, /nothing was tagged/);
  assert.ok(!fake.calls.some((call) => call.includes('deployment-branch-policies')), 'no branch policies without the environment');
});

test('runPreflight skips the history check while origin has no master', () => {
  const fake = fakeExec({ responses: STANDARD_RESPONSES, hasMaster: false });
  assert.equal(preflight(fake).code, 0);
  assert.ok(!fake.calls.some((call) => call.startsWith('git merge-base')));
});

test('runPreflight exits 2 when GitHub cannot be read, or the repository is not named', () => {
  const unreadable = preflight(fakeExec({ ghFailure: 'HTTP 403: Resource not accessible by integration' }));
  assert.equal(unreadable.code, 2);
  assert.match(unreadable.text, /^::error::release preflight: gh api .* failed: HTTP 403/m);
  const unnamed = preflight(fakeExec({ responses: STANDARD_RESPONSES }), {});
  assert.equal(unnamed.code, 2);
  assert.match(unnamed.text, /GITHUB_REPOSITORY and GITHUB_REPOSITORY_OWNER must be set/);
});
