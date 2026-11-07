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
const MASTER_ONLY = [{ id: 7, name: 'master', type: 'branch' }];
const DEVELOP = { id: 8, name: 'develop', type: 'branch' };

const ready = (overrides = {}) => ({
  masterRules: STANDARD_RULES, environment: PRODUCTION, branchPolicies: MASTER_ONLY, ref: 'master', repo: REPO, ...overrides,
});
const POLICIES = `repos/${REPO}/environments/production/deployment-branch-policies`;
/** The command a problem ends with, for the owner to run; null when it names none. */
const fix = (problem) => / Fix \(owner\): (.+)$/.exec(problem)?.[1] ?? null;

test('a repository set up to the production standard is ready for a release run on master', () => {
  assert.deepEqual(MASTER_RULES, ['creation', 'deletion', 'non_fast_forward', 'update']);
  assert.deepEqual(preflightProblems(ready()), []);
});

test('a rule besides the two rulesets, such as a required status check, would refuse the deploy key\'s push', () => {
  const masterRules = [...STANDARD_RULES, { type: 'required_status_checks', parameters: { required_status_checks: [{ context: 'x' }] } }];
  const [problem] = preflightProblems(ready({ masterRules }));
  assert.match(problem, /^master's rules are \[creation, deletion, non_fast_forward, required_status_checks, update\]/);
});

// A release is a merge commit of develop into master, which a required linear history refuses.
test('master: history still asking for a linear history would refuse the release\'s merge commit', () => {
  const [problem, ...rest] = preflightProblems(ready({ masterRules: [...STANDARD_RULES, { type: 'required_linear_history' }] }));
  assert.deepEqual(rest, []);
  assert.match(problem, /required_linear_history/);
  assert.match(problem, /merge commit/);
});

// The first release after the switch to releases on master stopped here (run 42396834207): the
// ruleset on GitHub still had the rule the repository's file no longer has. The problem names the
// command that sends the file, with the ruleset's id from GitHub's answer.
test('a linear history left on master: history comes with the command that sends the repository\'s ruleset file', () => {
  const [problem] = preflightProblems(ready({ masterRules: [...STANDARD_RULES, { type: 'required_linear_history', ruleset_id: 25566952 }] }));
  assert.equal(fix(problem), `gh api --method PUT repos/${REPO}/rulesets/25566952 --input .github/rulesets/master-history.json`);
  const [unknownId] = preflightProblems(ready({ masterRules: [...STANDARD_RULES, { type: 'required_linear_history' }] }));
  assert.equal(fix(unknownId), `gh api --method PUT repos/${REPO}/rulesets/<id> --input .github/rulesets/master-history.json`);
  assert.equal(fix(preflightProblems(ready({ masterRules: [] }))[0]), null, 'missing rulesets: the setup in CONTRIBUTING.md');
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

test('on master, production has to deploy from master alone', () => {
  const cases = [
    [{ ...PRODUCTION, deployment_branch_policy: null }, [], /from any branch, not from master alone/],
    [{ ...PRODUCTION, deployment_branch_policy: { protected_branches: true, custom_branch_policies: false } }, [], /from no branch/],
    [PRODUCTION, [...MASTER_ONLY, { id: 9, name: 'feature/*', type: 'branch' }], /from branch:master, branch:feature\/\*/],
    [PRODUCTION, [{ id: 9, name: 'master', type: 'tag' }], /from tag:master/],
    // Still open to develop after the switch: any run on develop could reach the deploy key.
    [PRODUCTION, [DEVELOP], /from branch:develop, not from master alone/],
    [PRODUCTION, [...MASTER_ONLY, DEVELOP], /from branch:master, branch:develop, not from master alone/],
  ];
  for (const [environment, branchPolicies, pattern] of cases) {
    const problems = preflightProblems(ready({ environment, branchPolicies }));
    assert.equal(problems.length, 1, String(pattern));
    assert.match(problems[0], pattern);
  }
});

// The run that brings a new Release workflow to master starts on develop: master still has the old
// one. The owner lets production deploy from develop for it (repo-standard.mjs production --bootstrap).
test('on develop, the run that brings a new workflow to master needs production open to develop, and to nothing else but master', () => {
  for (const branchPolicies of [[DEVELOP], [...MASTER_ONLY, DEVELOP]]) {
    assert.deepEqual(preflightProblems(ready({ ref: 'develop', branchPolicies })), [], JSON.stringify(branchPolicies));
  }
  for (const branchPolicies of [MASTER_ONLY, [DEVELOP, { id: 9, name: 'feature/*', type: 'branch' }], []]) {
    const problems = preflightProblems(ready({ ref: 'develop', branchPolicies }));
    assert.equal(problems.length, 1, JSON.stringify(branchPolicies));
    assert.match(problems[0], /^this run is on develop, but production deploys from /);
    assert.match(problems[0], /a release runs on master \(Actions → Release → Run workflow → Use workflow from: master\)/);
    assert.match(problems[0], /--bootstrap/);
  }
});

// After the run on develop the owner closes production to master; the problem names the calls.
test('on master, the branch policies to add and to delete come as commands, by their ids', () => {
  const POST_MASTER = `gh api --method POST ${POLICIES} -f name=master -f type=branch`;
  const cases = [
    [[...MASTER_ONLY, DEVELOP], `gh api --method DELETE ${POLICIES}/8`],
    [[DEVELOP], `${POST_MASTER} && gh api --method DELETE ${POLICIES}/8`],
    [[...MASTER_ONLY, { id: 9, name: 'feature/*', type: 'branch' }], `gh api --method DELETE ${POLICIES}/9`],
    [[{ id: 9, name: 'master', type: 'tag' }], `${POST_MASTER} && gh api --method DELETE ${POLICIES}/9`],
    [[], POST_MASTER],
  ];
  for (const [branchPolicies, command] of cases) {
    assert.equal(fix(preflightProblems(ready({ branchPolicies }))[0]), command, JSON.stringify(branchPolicies));
  }
  // Without selected branches the environment itself needs changing: the setup in CONTRIBUTING.md.
  assert.equal(fix(preflightProblems(ready({ environment: { ...PRODUCTION, deployment_branch_policy: null }, branchPolicies: [] }))[0]), null);
});

test('on develop, production not open to develop comes with the command that opens it', () => {
  const POST_DEVELOP = `gh api --method POST ${POLICIES} -f name=develop -f type=branch`;
  assert.equal(fix(preflightProblems(ready({ ref: 'develop', branchPolicies: MASTER_ONLY }))[0]), POST_DEVELOP);
  assert.equal(fix(preflightProblems(ready({ ref: 'develop', branchPolicies: [] }))[0]), POST_DEVELOP);
  const feature = { id: 9, name: 'feature/*', type: 'branch' };
  assert.equal(fix(preflightProblems(ready({ ref: 'develop', branchPolicies: [DEVELOP, feature] }))[0]), `gh api --method DELETE ${POLICIES}/9`);
});

test('a run on any other branch is told that a release runs on master', () => {
  const problems = preflightProblems(ready({ ref: 'feature/x' }));
  assert.equal(problems.length, 1);
  assert.match(problems[0], /^a release runs on master \(Actions → Release → Run workflow → Use workflow from: master\), not on feature\/x/);
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
  [`repos/${REPO}/environments/production/deployment-branch-policies?per_page=100`]: { total_count: 1, branch_policies: MASTER_ONLY },
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
  assert.match(result.text, /master's rules allow the release commit, and production deploys from master\./);
  assert.deepEqual(fake.calls, [
    `gh api repos/${REPO}/rules/branches/master?per_page=100`,
    `gh api repos/${REPO}/environments/production`,
    `gh api repos/${REPO}/environments/production/deployment-branch-policies?per_page=100`,
  ]);
});

// GitHub sets GITHUB_REF_NAME to the branch the run started on; a run from a computer, without it,
// is checked as a release on master.
test('runPreflight checks the branch the run is on', () => {
  const onDevelop = preflight(fakeExec({ responses: STANDARD_RESPONSES }), { GITHUB_REPOSITORY: REPO, GITHUB_REF_NAME: 'develop' });
  assert.equal(onDevelop.code, 1);
  assert.match(onDevelop.text, /^::error::this run is on develop/m);
  assert.equal(preflight(fakeExec({ responses: STANDARD_RESPONSES }), { GITHUB_REPOSITORY: REPO, GITHUB_REF_NAME: 'master' }).code, 0);
});

// As GitHub answered run 42396834207: a run on develop, production open to develop, and the ruleset
// "master: history" (25566952) still with its linear history.
test('runPreflight names the repository and the ruleset in the command it prints', () => {
  const rules = [...STANDARD_RULES, { type: 'required_linear_history', ruleset_id: 25566952 }];
  const responses = {
    ...STANDARD_RESPONSES,
    [`repos/${REPO}/rules/branches/master?per_page=100`]: rules,
    [`repos/${REPO}/environments/production/deployment-branch-policies?per_page=100`]: { total_count: 1, branch_policies: [DEVELOP] },
  };
  const result = preflight(fakeExec({ responses }), { GITHUB_REPOSITORY: REPO, GITHUB_REF_NAME: 'develop' });
  assert.equal(result.code, 1);
  const errors = result.text.split('\n').filter((line) => line.startsWith('::error::'));
  assert.equal(errors.length, 1, result.text);
  assert.ok(errors[0].endsWith(` Fix (owner): gh api --method PUT repos/${REPO}/rulesets/25566952 --input .github/rulesets/master-history.json`), errors[0]);
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

// gh's stderr can hold several lines; a raw newline would end the annotation there, and a line
// of it starting with :: would be read as a workflow command of its own.
test('runPreflight keeps gh\'s whole error on its one annotation line', () => {
  const result = preflight(fakeExec({ ghFailure: 'HTTP 403: Resource not accessible\n::warning::not from the preflight\n' }));
  assert.equal(result.code, 2);
  assert.deepEqual(result.text.split('\n').filter(Boolean), [
    '::error::release preflight: gh api repos/owner/repo/rules/branches/master?per_page=100 failed: HTTP 403: Resource not accessible%0A::warning::not from the preflight',
  ]);
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
