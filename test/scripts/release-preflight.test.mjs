import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MASTER_RULES, preflightProblems, runPreflight } from '../../scripts/lib/release-preflight.mjs';

const REPO = 'owner/repo';
const STANDARD_RULES = MASTER_RULES.map((type) => ({ type, ruleset_id: 1 }));
const PRODUCTION = {
  name: 'production',
  deployment_branch_policy: { protected_branches: false, custom_branch_policies: true },
  protection_rules: [{ type: 'branch_policy' }],
};
const DEVELOP_ONLY = [{ id: 7, name: 'develop', type: 'branch' }];

const ready = (overrides = {}) => ({
  masterRules: STANDARD_RULES, environment: PRODUCTION, branchPolicies: DEVELOP_ONLY, ...overrides,
});

test('a repository set up to the production standard is ready', () => {
  assert.deepEqual(preflightProblems(ready()), []);
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

// One click per release and nothing to approve: production needs no reviewer.
test('production needs no reviewer, and one set there changes nothing', () => {
  const reviewer = { type: 'required_reviewers', prevent_self_review: false, reviewers: [{ type: 'User', reviewer: { login: 'someone' } }] };
  for (const protection_rules of [undefined, [], [{ type: 'branch_policy' }], [reviewer, { type: 'branch_policy' }], [{ type: 'wait_timer', wait_timer: 5 }]]) {
    assert.deepEqual(preflightProblems(ready({ environment: { ...PRODUCTION, protection_rules } })), [], JSON.stringify(protection_rules));
  }
});

test('every problem is reported at once', () => {
  assert.equal(preflightProblems(ready({ masterRules: [], environment: null })).length, 2);
});

// --- runPreflight, against stand-ins for gh and git -----------------------------------------------

/** gh answers from `responses` (path → JSON, or null for a 404). */
function fakeExec({ responses = {}, ghFailure = null } = {}) {
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
    return { status: 64, stdout: '', stderr: 'unexpected' };
  };
  return { exec, calls };
}

const STANDARD_RESPONSES = {
  [`repos/${REPO}/rules/branches/master?per_page=100`]: STANDARD_RULES,
  [`repos/${REPO}/environments/production`]: PRODUCTION,
  [`repos/${REPO}/environments/production/deployment-branch-policies?per_page=100`]: { total_count: 1, branch_policies: DEVELOP_ONLY },
};

const preflight = (fake, env = { GITHUB_REPOSITORY: REPO }) => {
  const out = [];
  const code = runPreflight({ env, exec: fake.exec, stdout: { write: (text) => out.push(text) } });
  return { code, text: out.join('') };
};

test('runPreflight reads master\'s rules and production, and passes a ready repository', () => {
  const fake = fakeExec({ responses: STANDARD_RESPONSES });
  const result = preflight(fake);
  assert.equal(result.code, 0, result.text);
  assert.match(result.text, /can move master to the release commit/);
  assert.deepEqual(fake.calls, [
    `gh api repos/${REPO}/rules/branches/master?per_page=100`,
    `gh api repos/${REPO}/environments/production`,
    `gh api repos/${REPO}/environments/production/deployment-branch-policies?per_page=100`,
  ]);
});

test('runPreflight prints each problem as a workflow error and exits 1', () => {
  const responses = { ...STANDARD_RESPONSES, [`repos/${REPO}/environments/production`]: null };
  const fake = fakeExec({ responses });
  const result = preflight(fake);
  assert.equal(result.code, 1);
  assert.equal(result.text.match(/^::error::/gm).length, 1, result.text);
  assert.match(result.text, /nothing was tagged/);
  assert.ok(!fake.calls.some((call) => call.includes('deployment-branch-policies')), 'no branch policies without the environment');
});

test('runPreflight exits 2 when GitHub cannot be read', () => {
  const unreadable = preflight(fakeExec({ ghFailure: 'HTTP 403: Resource not accessible by integration' }));
  assert.equal(unreadable.code, 2);
  assert.match(unreadable.text, /^::error::release preflight: gh api .* failed: HTTP 403/m);
});

test('runPreflight exits 2 and asks nothing of GitHub without a repository named <owner>/<repo>', () => {
  for (const env of [{}, { GITHUB_REPOSITORY: '' }, { GITHUB_REPOSITORY: 'repo' }, { GITHUB_REPOSITORY: 'owner/repo/extra' }]) {
    const fake = fakeExec({ responses: STANDARD_RESPONSES });
    const result = preflight(fake, env);
    assert.equal(result.code, 2, JSON.stringify(env));
    assert.match(result.text, /GITHUB_REPOSITORY must be set as <owner>\/<repo>/);
    assert.deepEqual(fake.calls, [], JSON.stringify(env));
  }
});
