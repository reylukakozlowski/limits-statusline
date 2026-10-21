// The Release workflow's last check before it tags: once the tag is pushed, the run has to reach
// master, so whatever would stop it there stops it here, before anything is written. It reads what
// the job's token can read: master's rules, the environment production and the history. GitHub
// shows the deploy key and the environment's secret to admins only, so those two are not checked.
// production needs no reviewer: a release has one approval, the release environment's at the start.
//   node scripts/release-preflight.mjs   (GITHUB_REPOSITORY, GH_TOKEN)
// Problems are printed as workflow errors on stdout.
// Exit codes: 0 ready, 1 not ready, 2 GitHub or git could not be read.

/** The rule types on master: the rulesets "master: release only" and "master: history", nothing else. */
export const MASTER_RULES = Object.freeze(['creation', 'deletion', 'non_fast_forward', 'required_linear_history', 'update']);
const DEPLOY_FROM = 'branch:develop';
const REPOSITORY = /^[\w.-]+\/[\w.-]+$/;
const SEE = '(CONTRIBUTING.md, master)';

class Unreadable extends Error {}

/**
 * What would stop a release after its tag; [] when nothing would.
 * @param {{ masterRules: { type: string }[], environment: object | null, branchPolicies: { name: string, type?: string }[],
 *   masterBehindHead: boolean | null }} facts masterBehindHead is null while master does not exist yet
 * @returns {string[]}
 */
export function preflightProblems({ masterRules, environment, branchPolicies, masterBehindHead }) {
  const problems = [];
  if (masterBehindHead === false) {
    problems.push("master has commits that develop's head lacks, so the release cannot move master forward to it.");
  }
  const types = masterRules.map((rule) => rule.type).sort();
  if (types.join(' ') !== MASTER_RULES.join(' ')) {
    problems.push(`master's rules are [${types.join(', ')}], not [${MASTER_RULES.join(', ')}]: master takes the rulesets `
      + `"master: release only" and "master: history" and no other ${SEE}.`);
  }
  if (!environment) {
    problems.push(`the environment production is missing, so no job gets the deploy key that moves master ${SEE}.`);
    return problems;
  }
  const policy = environment.deployment_branch_policy;
  const branches = branchPolicies.map((branch) => `${branch.type ?? 'branch'}:${branch.name}`);
  if (!(policy?.custom_branch_policies === true && policy.protected_branches === false && branches.join(' ') === DEPLOY_FROM)) {
    const from = policy ? branches.join(', ') || 'no branch' : 'any branch';
    problems.push(`the environment production deploys from ${from}, not from develop alone ${SEE}.`);
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
    say('::error::release preflight: GITHUB_REPOSITORY must be set as <owner>/<repo>.');
    return 2;
  }
  let facts;
  try {
    facts = readFacts(env.GITHUB_REPOSITORY, exec);
  } catch (error) {
    if (!(error instanceof Unreadable)) throw error;
    say(`::error::release preflight: ${error.message}`);
    return 2;
  }
  const problems = preflightProblems(facts);
  for (const problem of problems) say(`::error::${problem}`);
  if (problems.length > 0) {
    say('release preflight: the release would stop after its tag, so it stops here; nothing was tagged.');
    return 1;
  }
  say("release preflight: master can move forward to develop's head through the environment production.");
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
  return { masterRules, environment, branchPolicies, masterBehindHead: masterBehindHead(exec) };
}

/** null while origin has no master; otherwise whether master is an ancestor of HEAD. */
function masterBehindHead(exec) {
  if (exec('git', ['rev-parse', '--quiet', '--verify', 'refs/remotes/origin/master']).status !== 0) return null;
  const { status, stderr } = exec('git', ['merge-base', '--is-ancestor', 'refs/remotes/origin/master', 'HEAD']);
  if (status > 1) throw new Unreadable(`git merge-base failed: ${stderr.trim() || `exit ${status}`}`);
  return status === 0;
}
