// The Release workflow's first check, before the tests: once the tag is pushed, the run has to
// reach master, so whatever would stop it there stops it here, before anything is written. It reads
// what the job's token can read: master's rules and the environment production. GitHub shows the
// deploy key and the environment's secret to admins only, so those two are not checked. The release
// commit is a merge of develop into master's head, so master always moves forward to it, and
// master's rules must allow a merge commit. production needs no reviewer: only the owner can start a
// release, and one click does it.
// A release runs on master, and production deploys from master alone. A run on develop is the one
// that brings a new Release workflow to master (a run executes the workflow of the branch it starts
// on, and master has the previous one); it needs production opened to develop for it first, by the
// owner (repo-standard.mjs production <owner>/<repo> --bootstrap).
//   node scripts/release-preflight.mjs   (GITHUB_REPOSITORY, GH_TOKEN; GITHUB_REF_NAME, master by default)
// Problems are printed as workflow errors on stdout.
// Exit codes: 0 ready, 1 not ready, 2 GitHub could not be read.

import { annotation } from './workflow-commands.mjs';

/** The rule types on master: the rulesets "master: release only" and "master: history", nothing else. */
export const MASTER_RULES = Object.freeze(['creation', 'deletion', 'non_fast_forward', 'update']);
const RELEASE_BRANCH = 'master';
const BOOTSTRAP_BRANCH = 'develop';
const REPOSITORY = /^[\w.-]+\/[\w.-]+$/;
const SEE = '(CONTRIBUTING.md, master)';
const RUN_ON_MASTER = 'a release runs on master (Actions → Release → Run workflow → Use workflow from: master)';

class Unreadable extends Error {}

/**
 * What would stop a release after its tag; [] when nothing would.
 * @param {{ masterRules: { type: string }[], environment: object | null, branchPolicies: { name: string, type?: string }[],
 *   ref?: string }} facts `ref`: the branch the run started on
 * @returns {string[]}
 */
export function preflightProblems({ masterRules, environment, branchPolicies, ref = RELEASE_BRANCH }) {
  const problems = [];
  if (ref !== RELEASE_BRANCH && ref !== BOOTSTRAP_BRANCH) {
    problems.push(`${RUN_ON_MASTER}, not on ${ref} ${SEE}.`);
  }
  const types = masterRules.map((rule) => rule.type).sort();
  if (types.join(' ') !== MASTER_RULES.join(' ')) {
    problems.push(`master's rules are [${types.join(', ')}], not [${MASTER_RULES.join(', ')}]: master takes the rulesets `
      + `"master: release only" and "master: history" and no other, and no required_linear_history, which would refuse `
      + `the release, a merge commit of develop ${SEE}.`);
  }
  if (!environment) {
    problems.push(`the environment production is missing, so no job gets the deploy key that moves master ${SEE}.`);
    return problems;
  }
  const policy = environment.deployment_branch_policy;
  const branches = branchPolicies.map((branch) => `${branch.type ?? 'branch'}:${branch.name}`);
  const custom = policy?.custom_branch_policies === true && policy.protected_branches === false;
  const from = policy ? branches.join(', ') || 'no branch' : 'any branch';
  if (ref === BOOTSTRAP_BRANCH) {
    const open = custom && branches.includes(`branch:${BOOTSTRAP_BRANCH}`)
      && branches.every((branch) => branch === `branch:${BOOTSTRAP_BRANCH}` || branch === `branch:${RELEASE_BRANCH}`);
    if (!open) {
      problems.push(`this run is on develop, but production deploys from ${from}: ${RUN_ON_MASTER}. A run on develop only `
        + 'brings a new Release workflow to master, after the owner opened production to develop (repo-standard.mjs '
        + `production <owner>/<repo> --bootstrap, or by hand) ${SEE}.`);
    }
  } else if (!(custom && branches.join(' ') === `branch:${RELEASE_BRANCH}`)) {
    problems.push(`the environment production deploys from ${from}, not from master alone ${SEE}.`);
  }
  return problems;
}

/**
 * @typedef {(command: string, args: string[]) => { status: number, stdout: string, stderr: string }} Exec
 * @param {{ env: Record<string, string | undefined>, exec: Exec, stdout: { write(text: string): void } }} io
 * @returns {number}
 */
export function runPreflight({ env, exec, stdout }) {
  const say = (text) => stdout.write(`${text}\n`);
  if (!REPOSITORY.test(env.GITHUB_REPOSITORY ?? '')) {
    say(annotation('error', 'release preflight: GITHUB_REPOSITORY must be set as <owner>/<repo>.'));
    return 2;
  }
  let facts;
  try {
    facts = readFacts(env.GITHUB_REPOSITORY, exec);
  } catch (error) {
    if (!(error instanceof Unreadable)) throw error;
    say(annotation('error', `release preflight: ${error.message}`));
    return 2;
  }
  const ref = env.GITHUB_REF_NAME || RELEASE_BRANCH;
  const problems = preflightProblems({ ...facts, ref });
  for (const problem of problems) say(annotation('error', problem));
  if (problems.length > 0) {
    say('release preflight: the release would not reach master, so it stops here; nothing was tagged.');
    return 1;
  }
  say(`release preflight: master's rules allow the release commit, and production deploys from ${ref}`
    + `${ref === BOOTSTRAP_BRANCH ? ', for the run that brings a new Release workflow to master' : ''}.`);
  return 0;
}

function readFacts(repo, exec) {
  const api = (path) => {
    const result = exec('gh', ['api', path]);
    if (result.status === 0) return JSON.parse(result.stdout);
    if (/HTTP 404/.test(result.stderr)) return null;
    throw new Unreadable(`gh api ${path} failed: ${result.stderr.trim() || `exit ${result.status}`}`);
  };
  const environmentPath = `repos/${repo}/environments/production`;
  const masterRules = api(`repos/${repo}/rules/branches/master?per_page=100`) ?? [];
  const environment = api(environmentPath);
  const branchPolicies = environment ? api(`${environmentPath}/deployment-branch-policies?per_page=100`)?.branch_policies ?? [] : [];
  return { masterRules, environment, branchPolicies };
}
