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

`npm run test:mod` needs Claude Code, so the Tests workflow does not run it; the Compatibility
workflow below runs the same tests every second day. Neither workflow shows how the lines look:
the status line in a macOS terminal (Terminal.app, iTerm2) and the desktop band in the macOS app
have not been checked by hand yet. To make the three `npm test on …` checks required before a
merge, the owner adds them to the `develop` ruleset (Settings → Rules → Rulesets → protect develop
→ Require status checks to pass).

### Against the newest Claude Code

Claude Code changes often: npm lists 18 releases of
[`@anthropic-ai/claude-code`](https://www.npmjs.com/package/@anthropic-ai/claude-code?activeTab=versions)
from 2.1.301 on 15 October to 2.1.319 on 6 November 2026. The plugin depends on what each release
sends and runs: the status line input, the mods engine, the manifest. The **Compatibility** workflow
([`.github/workflows/compatibility.yml`](.github/workflows/compatibility.yml)) checks the plugin
against the newest release every second day (04:17 UTC on odd days of the month), and from
Actions → Compatibility → Run workflow at any time. It installs `@anthropic-ai/claude-code@latest`
on Linux and runs:

1. `claude plugin validate .` and `claude plugin test .`, as above, with that release;
2. `node scripts/check-status-line-contract.mjs --docs <copy>` against a copy of Anthropic's
   [status line page](https://code.claude.com/docs/en/statusline.md), which the workflow downloads.
   The contract (`scripts/lib/status-line-contract.mjs`) lists every input field the status line
   reads, with the type the page's "Full JSON schema" example gives it and, where the code relies
   on one, the unit its table row states (`from 0 to 100`, `Unix epoch seconds`). A field the page
   no longer documents, or documents with another type or unit, fails the check; a field the page
   newly documents is only listed as a warning and in the run's summary. A page the parser does
   not recognise fails it too (exit code 2), rather than reading as every field gone.

Each check runs even when an earlier one failed, and any failure fails the run. A failed run is the
only notification. GitHub sends a scheduled workflow's notifications to the user who created the
workflow; after someone else changes its cron line they go to that user, and after the workflow
was disabled and enabled again, to whoever enabled it
([notifications for workflow runs](https://docs.github.com/en/actions/concepts/workflows-and-actions/notifications-for-workflow-runs)).
They arrive by email or on the web as that user's notification settings for Actions say, which can
be set to failed runs only. The token can only read the repository and the run holds no secret.
The downloads happen in the workflow, so the plugin's own code makes no network request
(`test/scripts/no-network.test.mjs` keeps it so). The contract cannot drift from the code:
`test/scripts/status-line-contract-drift.test.mjs` traces every field the status line reads and
fails when the contract lists one more or one fewer. `test/scripts/compatibility-workflow.test.mjs`
pins the workflow.

GitHub runs schedules from the default branch only (`develop`) and turns them off in a public
repository after 60 days without activity; Actions → Compatibility → Enable workflow turns the
schedule back on.

#### When a Compatibility run fails

The run's summary names the Claude Code version it installed and the contract's findings; the step
that failed says where to look:

- **Install the newest Claude Code**: npm or the package failed, not the plugin. Run the workflow
  again; if it fails again, the release itself may be broken, and a later run installs the next one.
- **Validate the plugin** or **Test the desktop band**: that release reads the manifest, the hooks
  module or the band differently. Run the same command locally with that release (`npm install
  --prefix <folder> @anthropic-ai/claude-code@<version>`, then `<folder>/node_modules/.bin/claude
  plugin test .`), read the release's entry in Claude Code's
  [changelog](https://github.com/anthropics/claude-code/blob/main/CHANGELOG.md), and fix the plugin.
- **Download the status line page**: the docs host refused or failed the download (the step's log
  shows curl's error). Nothing was checked; run the workflow again later. A refusal that keeps
  coming back means the host blocks the runner, and the check needs another way to get the page.
- **Check the status line contract** with exit code 1: a field the plugin reads changed on the page.
  The annotation names the field and what the page says now. Change the code that reads the field
  in `src/terminal/snapshot.mjs` or `run.mjs`, then the field's entry in `STATUS_LINE_CONTRACT` and
  the date beside it. A field that only moved, or a unit only reworded, needs the contract alone.
- **Check the status line contract** with exit code 2: the page's layout changed, so the parser
  (`scripts/lib/status-line-docs.mjs`) no longer finds the "Full JSON schema" example or the field
  tables. Fix the parser and its fixture (`test/fixtures/status-line-docs.md`); the plugin may need
  nothing.

A warning that lists newly documented fields leaves the run green. When such a field should stay
unread, add it to `UNREAD_FIELDS` in `scripts/lib/status-line-contract.mjs`, and the warning stops;
when the plugin should show it, read it in the code and add it to the contract.

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

A release is a merge of `develop` into `master` and its tag. `develop` carries no version: the
release commit carries the files of `develop` as they are at the commit the run releases, with
`version` in `.claude-plugin/plugin.json` set to the release's (`X.Y.Z`, SemVer), and its two
parents are the previous release (`master`'s head) and that `develop` commit. So `master` moves
forward by one commit per release and holds `develop`'s history: right after a release GitHub shows
`master` "N commits ahead of" `develop` (the release commits) and none behind; it falls behind
again only as new pull requests reach `develop`. The annotated tag `vX.Y.Z` names the release
commit. Claude Code takes the version from `plugin.json` and keeps users on it until it changes, so
each release has a new one, counted from the highest `vX.Y.Z` tag; users install from `master`, and
Anthropic's directory reads it from there. A test keeps the marketplace entry and `package.json`
without a version, and `plugin.json` too, except in a release commit (`Release vX.Y.Z`), where it
is that version. Releases come from the **Release** workflow
([`.github/workflows/release.yml`](.github/workflows/release.yml)), which only the repository owner
can run and approve; it commits nothing to `develop` and makes no branch or pull request.

### Making a release

1. Merge the changes into `develop` through pull requests, as usual. Run `npm run test:mod` first
   when the band changed: the workflow does not run it. A new hook or call on `$` in the band also
   changes what Anthropic's directory holds for a reviewer: `npm test` fails until the README's
   Privacy section, `PRIVACY.md` and [the band's policy holds](docs/directory-submission.md#the-bands-policy-holds)
   describe it.
2. On GitHub, open **Actions → Release → Run workflow**. Leave **Use workflow from** at `develop`,
   its default: a run on any other branch is refused. Pick the **Version part to raise**: `patch`
   (the default, `1.0.15` → `1.0.16`), `minor` for new features, `major` for a change users must
   act on. The **Release note** is optional: one line of at most 500 characters, which opens the
   release notes. Press **Run workflow**. The run is listed as `Release patch` and so on.
3. The run waits for your approval before any of its steps runs. Open it, press **Review
   deployments**, tick `release` and press **Approve and deploy** (GitHub also notifies you, and
   waits up to 30 days). **Reject** stops the run, and nothing has happened. The release is made of
   the `develop` commit of the moment you pressed **Run workflow**: a pull request merged while the
   run waits goes into the next release.
4. Then the jobs run by themselves, each only after the one before passed:
   - **Merge and test**, which holds no credentials, first checks the note (one line, at most 500
     characters). Then `scripts/release.mjs` refuses a `develop` commit that `master` already
     holds (nothing new since the last release) and one that lacks the `develop` commit of the
     release on `master` (`develop` only moves forward), takes the version from the highest
     `vX.Y.Z` tag, builds the release commit, runs `npm test` on it (the files `master` gets, with
     the version), and only then tags it with the annotated tag `vX.Y.Z`. The release notes, in
     the tag and in the commit's message, are your note, then the subjects of the `develop`
     commits that `master` lacks, oldest first. The job pushes nothing: the tag goes to the next
     job as a git bundle.
   - **Push to master**, in the `production` environment, holds the repository's deploy key and
     runs none of the repository's code. It pushes the tag and `master` in one atomic push, both or
     neither and never forced, and only when the tag is the release the previous job tested: named
     `vX.Y.Z` and the highest such tag, annotated, on the commit the tests passed on; a merge whose
     parents are `master`'s head and the run's commit, in this order, so no history but
     `develop`'s reaches `master`; `develop`'s files at that commit with the manifest's version
     line added and nothing else; the run's commit not yet in `master`; and a message and an
     annotation whose notes the job works out itself from your note in the form and git, so the
     job that ran the repository's code cannot put notes of its own into the release. Anything
     else stops the run with nothing pushed. With the directory's push webhook set up, that push
     is what tells Anthropic's directory about the release; without it the directory finds it at
     its next scheduled check ([docs/directory-submission.md](docs/directory-submission.md#after-the-listing)).
   - **GitHub release** creates the GitHub release from the tag's notes and marks it Latest. Once
     GitHub shows the new release as the latest, it deletes the older releases: the repository
     keeps one release, and the `vX.Y.Z` tags of all versions stay as the history (the ruleset
     **protect release tags** forbids deleting or moving them).

Claude never approves or rejects a release. Claude runs `gh` as the owner, so its approval would
pass as yours; the guard of the owner's `sealoop-workflow` plugin blocks deployment reviews.
Claude writes and changes the Release workflow and its tests; you start and approve each release.

### When a run fails

The step that failed says why, in an error at the top of the run's page.

- **Refuse**: the run was not a **Run workflow** on `develop` by you. Nothing happened; start it
  again from `develop`.
- **Approval** rejected, or never approved: nothing happened.
- **Merge and test**: nothing was pushed. The note had more than one line or 500 characters;
  `develop` has nothing new since the last release (merge something first); `develop` lost the
  commit of the last release (it never should: the `develop` ruleset forbids force pushes); or a
  test failed on the release commit (fix it on `develop`). Then start a new run.
- **Push to master**, before its push: nothing was pushed, since the push is atomic. Fix the
  cause (the error names it), then **Re-run failed jobs** within a day, while the bundle is kept,
  or start a new run, which makes the same version again.
- **Push to master** after its push, or **GitHub release**: the version is on `master` and
  tagged. **Re-run failed jobs**: **Push to master** pushes nothing when `master` already holds
  the tag, and **GitHub release** skips a release that exists. A new run would be refused, as
  `develop` has nothing new; after more merges it releases the next version, and the one before
  keeps its tag without a GitHub release.

A tag is never moved or deleted, so a version once tagged is taken for good.

### master

Users get only releases. `master` is the production branch: its head is the latest release, and
each release commit is a merge of `develop` with the version in `plugin.json`, so `master` holds
`develop`'s history up to that release and nothing else. Anthropic's directory follows it (see
[docs/directory-submission.md](docs/directory-submission.md)), and the entry in the `sealoop`
marketplace file, which is read from `develop`, fetches the plugin from it. Users get a new version
with `claude plugin update limits-statusline@sealoop`, or by themselves when they turned auto-update
on for this marketplace (it is off by default for marketplaces outside Anthropic's).

Two rulesets on GitHub guard `master`, and GitHub refuses every other change, the owner's included:

- **master: release only** lets only a deploy key create or move `master`.
- **master: history** forbids deleting `master` and force pushes, and no one bypasses it, the
  deploy key and the owner included. It must not require a linear history: a release is a merge
  commit.

The repository has exactly one deploy key with write access: GitHub cannot name a single key as
the one that bypasses a ruleset, so every deploy key of the repository could move `master`. Its
private half is the secret `PRODUCTION_DEPLOY_KEY` of the `production` environment, which deploys
from `develop` only, and only the job **Push to master** of the Release workflow names it. Do not
open pull requests into `master`: Rebase and merge would rewrite the commits, and the workflow
moves it.

The owner sets this up, and rotates the key, with the `sealoop-workflow` plugin: `repo-standard.mjs
production reylukakozlowski/limits-statusline`, with `--dry-run` first to see the plan
(`--rotate-key` for a new key). It makes `production` deploy from `develop` alone, sets up the
`release` environment (the owner its one required reviewer, self-review allowed, `develop` only),
both rulesets and the one deploy key; it neither adds nor removes a linear history on
`master: history`. It creates a credential, so Claude runs only the dry run.

A run executes the workflow file of the branch it starts on, `develop`, so a change to
`.github/workflows/release.yml` takes effect in the first run after its pull request is merged. The
file has to stay on `develop`, the default branch, for **Run workflow** to appear.

### Credentials

The job **Push to master** pushes the tag and `master` over SSH with the deploy key; its
`GITHUB_TOKEN` only reads. GitHub refuses that token a push of a commit that changes
`.github/workflows`, which a release commit does whenever `develop` changed a workflow since the
previous release; the deploy key has no such limit. The key is never in a job that runs the
repository's code: the tests run in **Merge and test**, which has no credentials, and **Push to
master** checks what that job hands it before it pushes, so even code that went wrong in the tests
could not take the key or put anything but the tested release commit on `master`: not older files,
not a lower version and no release notes of its own. **GitHub release** writes with
`GITHUB_TOKEN` (`contents: write`) and pushes nothing. No workflow here runs on a push, so the push
starts no other run. The Release workflow opens no pull requests, so **Settings → Actions →
General → Workflow permissions → Allow GitHub Actions to create and approve pull requests** can
stay off.

### Who can release

GitHub skips every release job, without a runner, when anyone but the repository owner starts the
run or when it runs on any branch but `develop`; the job **Refuse** then fails and says so. Only
people with write access can start it at all. Your approval in the `release` environment is the go
for one release; it is not what keeps the deploy key safe. That is `production`'s branch policy:
only runs on `develop` get the key, and only your merges change `develop` (pull request workflows
run on `refs/pull/…`). Three things keep the key from any other job: that branch policy; the
owner-only condition on every job of the Release workflow; and the contract test
(`test/scripts/release-workflow.test.mjs`) that fails when another workflow names `production` or
its key, which the Tests workflow runs on every pull request into `develop` once it is ready for
review. Events that anyone can cause, such as an issue comment, run the workflows of `develop` with
`develop` as their ref, so a workflow on such an event must never name `production`. Keep both
environments: GitHub creates a missing environment that a workflow names, without any protection
rules, so without `release` a run would wait for no approval.

So that no stranger runs workflows on the repository's runners, the setting
**Approval for running fork pull request workflows from contributors** (Settings → Actions →
General) is **Require approval for all external contributors**: no outside pull request runs a
workflow before the owner approves it.

### From a computer

`npm run release -- patch --dry-run` (or `minor`, `major`) runs the same checks and the tests and
prints the next version and the notes; with `NOTES="<note>"` in front, the note opens them. On a
clean `develop` that origin holds, `npm run release -- patch` builds the release commit, runs the
tests on it and tags it, in the clone only, to look at; it checks the release commit out for the
tests and then goes back, so `develop` and the working tree stay as they were. Releases come from
the workflow: only its deploy key can move `master`.

`CHANGELOG.md` covers the versions up to 1.0.2; the first tagged release is `v0.1.1`, and `0.1.0`
has a changelog entry but no tag.
