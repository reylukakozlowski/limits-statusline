# Contributing

This file is for working on the plugin itself. How to install and use it is in
[README.md](README.md); security problems go through [SECURITY.md](SECURITY.md).

## Tests and checks

```bash
npm test                 # unit and integration tests (node:test)
npm run test:coverage    # the same with coverage
npm run test:mod         # the desktop band, run by the engine itself (Claude Code 2.1.299+)
claude plugin validate .  # manifest, hooks module and state contract
npm run simulate:pace    # the Monte Carlo comparison behind the pace look-backs
```

`npm run test:mod` needs a `claude` of 2.1.299 or later. When the one on `PATH` is older, run
`claude update`; on Windows the desktop app's own copy works too, under
`%LOCALAPPDATA%\Claude-Data\<app id>\claude-code\<version>\<build>\claude.exe`.

The code is split into a pure `src/core` (snapshot → lines), a terminal adapter
(`src/terminal`) and a desktop adapter (`src/desktop`). The code that runs for users (`src`,
`hooks`, and the setup and sync scripts with `scripts/lib`) never asks which system it runs on:
what differs on Windows (backslashes in paths, a rename refused for a moment while a scanner holds
a file) is handled the same way everywhere, the command that setup writes uses forward slashes,
which `sh`, Git Bash, PowerShell and Node.js all read, and the only program it starts is `git`.

### On macOS, Linux and Windows

The **Tests** workflow ([`.github/workflows/tests.yml`](.github/workflows/tests.yml)) runs
`npm test` on `macos-latest`, `ubuntu-latest` and `windows-latest`, with Node.js 24, for each pull
request into `develop`. A draft runs nothing; marking the pull request ready for review runs the
three systems, and every push after that runs them again. One system failing does not stop the
others, so each one reports its own result. The workflow can only read the repository and holds
no secret; `test/scripts/tests-workflow.test.mjs` pins all of that. The Release workflow runs the
tests once more, on Linux, before it tags.

Some tests depend on the system they run on:

- The SessionStart hook test (`test/scripts/session-start-hook.test.mjs`) runs the command from
  `hooks/hooks.json` in every shell Claude Code may use for it: `sh` (Claude Code's shell on macOS
  and Linux; on Windows the `sh` of Git for Windows stands in for Git Bash), and PowerShell 7 and
  Windows PowerShell on Windows. A shell that is not installed is skipped.
- The symlinked `settings.json` test is skipped on Windows when the account may not create
  symbolic links (Developer Mode or admin rights); it runs on macOS and Linux.
- A Windows checkout may have CRLF line endings (Git for Windows sets `core.autocrlf=true` by
  default); the tests read files with either line ending, as a run on a CRLF checkout showed.

`npm run test:mod` runs only on a computer with Claude Code, not in the workflow. Nor does the
workflow show how the lines look: the status line in a macOS terminal (Terminal.app, iTerm2) and
the desktop band in the macOS app have not been checked by hand yet. To make the three
`npm test on …` checks required before a merge, the owner adds them to the `develop` ruleset
(Settings → Rules → Rulesets → protect develop → Require status checks to pass).

## Run a working copy in every session

`claude --plugin-dir <folder>` and a session's hot-reloaded mods folder load the plugin for that
one session: the next session starts without it. To run a clone everywhere, in the terminal
and the desktop app alike, add the clone as the `sealoop` marketplace in place of the GitHub one:

```bash
claude plugin marketplace remove sealoop
claude plugin marketplace add /path/to/limits-statusline
claude plugin install limits-statusline@sealoop
```

The first line is needed only when the GitHub marketplace was added before, since both are named
`sealoop`. Removing it uninstalls the plugin and deletes its data folder, the status line's runtime
copy included, so the terminal line goes blank: run `/limits-statusline:setup` again afterwards. It
rebuilds the runtime and leaves `settings.json` as it is. The plugin is then read from the folder
itself: after an edit, `/reload-plugins` picks it up with no new version.

## The repository page and search

Search engines reach the repository only through links to it (GitHub's sitemap lists no
repositories), and the title of the GitHub page, which their results show, carries the
repository's About text. The About text, the topics and the three listing texts
(`plugin.json`, the `sealoop` marketplace entry and `package.json`) name the plan limits as
Anthropic and the people searching for them do, the **5-hour** and the **weekly** limit
([Use Claude Code with your Pro or Max
plan](https://support.claude.com/en/articles/11145838-using-claude-code-with-your-pro-or-max-plan)),
and say only what the plugin does, with no ranking, endorsement or affiliation words.
`test/scripts/manifests.test.mjs` checks both in the manifests and the README introduction.

The README banner is also the repository's social preview (Settings → General → Social
preview). It is rendered from `assets/banner.html`, whose lines are the sample at the top of the
README: when the sample changes, render the banner again and upload it there. The banner's path
stays out of backticks and code blocks here: Anthropic's directory holds for a reviewer any
bundled image named that way outside Markdown image syntax
([pre-submission checklist](https://claude.com/docs/plugins/pre-submission-checklist#files-in-the-plugin-folder)).

About and topics live on GitHub, not in the repository. Their current values, set with:

```bash
gh repo edit reylukakozlowski/limits-statusline \
  --description "Claude Code status line plugin for the 5-hour and weekly usage limits: usage now, pace, projection to the reset and a warning before a limit runs out. Also session cost, cache, effort and context. Terminal and desktop app." \
  --add-topic claude,claude-code,claude-code-plugin,claude-code-statusline,cli,developer-tools,nodejs,rate-limits,status-line,statusline,terminal,usage-limits,usage-monitor
```

## Releasing

A release is only a tag, `vX.Y.Z` on the head of `develop`. Nothing is committed for it, no
release branch or pull request is made, and the manifests carry no version: Claude Code tells
versions apart by their commit (the commit's SHA, cut to 12 characters, is the version
`claude plugin list` shows). Releases come from the **Release** workflow on GitHub, which only the
repository owner can run.

1. Merge the changes into `develop` through pull requests, as usual. Run `npm run test:mod` first
   when the band changed: the workflow does not run it.
2. On GitHub, open **Actions → Release → Run workflow** on `develop` and pick the bump (`patch`,
   `minor` or `major`) or type an exact `X.Y.Z`. Tick **Dry run** to run only the job **CI** of
   step 4. The run is listed as `Dry run patch`, `Release patch` and so on.
3. Approve the run: every run, a dry run too, starts by waiting for the owner's approval of the
   `release` environment, and nothing runs before it.
4. The job **CI: tests and checks** runs in every run, a release too, and writes nothing:
   - **Run the tests**: `npm test`; the counts, with the name of each failed test, are on the
     run's summary page;
   - **Dry run of the release**: the checks of `npm run release -- <bump> --dry-run` (a clean
     `develop`, the next version, a tag not taken yet), and the version and the notes in its log;
   - **Check that the release can reach master** (`scripts/release-preflight.mjs`): `master`
     behind the head of `develop`, its two rulesets and no other rule, and the `production`
     environment deploying from `develop` alone and waiting for the owner. Whatever would stop the
     release after its tag stops it here, before anything is written.

   A dry run ends here.
5. Only when CI passed, the job **CD: tag** runs `npm test` once more, works the version out from
   the newest `vX.Y.Z` tag, and tags the commit the run started from, the one CI checked, with an
   annotated tag whose message lists the subjects of the commits since the previous tag. It pushes
   the tag.
6. Approve the job **CD: master**: it waits for the owner's approval of the `production`
   environment, then fast-forwards `master` to the tagged commit with the repository's deploy key:
   `master` becomes exactly the tagged commit. Nothing else can move `master` (see below).
7. The job **CD: GitHub release** creates the GitHub release from the tag's notes and marks it
   Latest. Once GitHub shows the new release as the latest, it deletes the older releases: the
   repository keeps one release, and the `vX.Y.Z` tags of all versions stay as the history (a tag
   ruleset forbids deleting or moving them).

A run that fails or is rejected part way is finished by running the workflow again: when the head
of `develop` already carries a version tag, the run finishes that release (`master`, GitHub
release) instead of cutting a new one, and skips what is done. **Re-run failed jobs** after a
failed tag, `master` or GitHub release job does not ask for the `release` approval again: CI
already passed in that run.

### master

Users get only releases. `master` is the production branch: Anthropic's directory follows it (see
[docs/directory-submission.md](docs/directory-submission.md)), and the entry in the `sealoop`
marketplace file, which is read from `develop`, fetches the plugin from it. Users get a new version
with `claude plugin update limits-statusline@sealoop`, or by themselves when they turned auto-update
on for this marketplace (it is off by default for marketplaces outside Anthropic's).

Two rulesets guard `master`, and GitHub refuses every other change, the owner's included:

- **master: release only** ([.github/rulesets/master-release-only.json](.github/rulesets/master-release-only.json))
  lets only a deploy key create or move `master`.
- **master: history** ([.github/rulesets/master-history.json](.github/rulesets/master-history.json))
  forbids deleting `master`, force pushes and merge commits, and no one bypasses it, the deploy
  key and the owner included.

The repository has exactly one deploy key with write access, `production: master (release
workflow)`: GitHub cannot name a single key as the one that bypasses a ruleset, so every deploy key
of the repository could move `master`. Its private half is the secret `PRODUCTION_DEPLOY_KEY` of
the `production` environment, which deploys from `develop` only, and only the job **CD: master**
of the Release workflow names it. Do not open pull requests into `master`: Rebase and merge would
rewrite the commits, and the workflow moves it.

To set this up again, in a fork for example (the first release then creates `master`):

```bash
gh api --method POST repos/<owner>/<repo>/rulesets --input .github/rulesets/master-release-only.json
gh api --method POST repos/<owner>/<repo>/rulesets --input .github/rulesets/master-history.json
gh api --method PUT repos/<owner>/<repo>/environments/production \
  -F 'deployment_branch_policy[protected_branches]=false' -F 'deployment_branch_policy[custom_branch_policies]=true'
gh api --method POST repos/<owner>/<repo>/environments/production/deployment-branch-policies -f name=develop -f type=branch
ssh-keygen -q -t ed25519 -N '' -C 'production: master (release workflow)' -f production-key
gh repo deploy-key add production-key.pub -R <owner>/<repo> --allow-write --title 'production: master (release workflow)'
gh secret set PRODUCTION_DEPLOY_KEY --env production -R <owner>/<repo> < production-key
rm production-key production-key.pub
```

Then add the owner as the required reviewer of `production` (Settings → Environments →
production), with **Prevent self-review** off: the owner starts the run and approves it. To change
a ruleset, edit its file and send it with `gh api --method PUT repos/<owner>/<repo>/rulesets/<id>
--input <file>`; `gh api repos/<owner>/<repo>/rulesets` lists the ids.

### Credentials

The job **CD: tag** pushes the tag with its own `GITHUB_TOKEN`. GitHub lets that token point a
branch or a tag only at a commit whose `.github/workflows` match the head of the default branch;
the tag sits on the head of `develop`, the default branch, which always does. The job
**CD: master** pushes `master` over SSH with the deploy key, which has no such limit, so `master`
catches up even when `develop` moved on with a workflow change. No workflow here runs on a push,
so neither push starts another run. The workflow opens no pull requests, so
**Settings → Actions → General → Allow GitHub Actions to create and approve pull requests** can
stay off.

### Who can release

GitHub skips every job, without a runner and without asking for approval, when anyone but the
repository owner starts the run or when it runs on any branch but `develop`. Two environments
(Settings → Environments) accept only `develop` and require the owner's approval: `release` before
CI and the tag, `production` before `master` moves. They guard different things. The first
decides that the head of `develop` becomes a release, whose tag stays for good. The second guards
the one credential that can move `master`: GitHub holds every job that names `production`, in any
workflow and on any event, until the owner approves it. The repository is public, and events that
anyone can cause, such as an issue comment, run the workflows of `develop`, so accepting only
`develop` would not keep the key from such a job on its own. Keep both environments: GitHub
creates a missing environment that a workflow names, without any protection rules. The workflow
file has to stay on `develop`, the default branch, for **Run workflow** to appear.

### From a computer

`npm run release -- patch --dry-run` runs the same checks and the tests and prints the version and
the notes. With `gh` signed in, `GITHUB_REPOSITORY=<owner>/<repo> GITHUB_REPOSITORY_OWNER=<owner>
node scripts/release-preflight.mjs` makes the Release workflow's check of the way to `master`. On an
up-to-date, clean `develop`, `npm run release -- patch` tags its head in the clone and prints the
command that pushes the tag, and `--push` pushes it. A pushed tag is not a release yet: run the
Release workflow on `develop` to finish it (`master`, GitHub release).

`CHANGELOG.md` covers the versions up to 1.0.2; the first tagged release is `v0.1.1`, and `0.1.0`
has a changelog entry but no tag.
