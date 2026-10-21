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

`npm run test:mod` needs a `claude` of 2.1.299 or later. When the one on `PATH` is older, the
desktop app's own copy works too; on Windows it is under
`%LOCALAPPDATA%Claude-Data<app id>claude-code<version><build>claude.exe`.

The code is split into a pure `src/core` (snapshot → lines), a terminal adapter
(`src/terminal`) and a desktop adapter (`src/desktop`). Tests run locally, and the Release
workflow runs them again before every release.

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

## Releasing

A release is only a tag, `vX.Y.Z` on the head of `develop`. Nothing is committed for it, no
release branch or pull request is made, and the manifests carry no version: Claude Code tells
versions apart by their commit (the commit's SHA, cut to 12 characters, is the version
`claude plugin list` shows). Releases come from the **Release** workflow on GitHub, which only the
repository owner can run.

1. Merge the changes into `develop` through pull requests, as usual. Run `npm run test:mod` first
   when the band changed: the workflow does not run it.
2. On GitHub, open **Actions → Release → Run workflow** on `develop` and pick the bump (`patch`,
   `minor` or `major`) or type an exact `X.Y.Z`. Tick **Dry run** to run the tests and see the
   version and the notes without changing anything. The run is listed as `Dry run patch`,
   `Release patch` and so on.
3. Approve the run: it starts by waiting for the owner's approval of the `release` environment,
   and nothing runs before it.
4. The job runs `npm test`, works the version out from the newest `vX.Y.Z` tag, and tags the head
   of `develop` with an annotated tag whose message lists the subjects of the commits since the
   previous tag. It pushes the tag.
5. It sets the commit status **Release from develop** on that commit and merges `develop` into
   `master` by fast-forward: `master` becomes exactly the tagged commit. Nothing else can move
   `master` (see below).
6. It creates the GitHub release from the tag's notes and marks it Latest. Once GitHub shows the
   new release as the latest, it deletes the older releases: the repository keeps one release, and
   the `vX.Y.Z` tags of all versions stay as the history (a tag ruleset forbids deleting or moving
   them).

A run that fails part way is finished by running the workflow again: when the head of `develop`
already carries a version tag, the run finishes that release (status, `master`, GitHub release)
instead of cutting a new one, and skips what is done.

### master

Users get only releases. `master` is the production branch: Anthropic's directory follows it (see
[docs/directory-submission.md](docs/directory-submission.md)), and the entry in the `sealoop`
marketplace file, which is read from `develop`, fetches the plugin from it. Users get a new version
with `claude plugin update limits-statusline@sealoop`, or by themselves when they turned auto-update
on for this marketplace (it is off by default for marketplaces outside Anthropic's).

The ruleset **master takes only releases from develop**
([.github/rulesets/master.json](.github/rulesets/master.json)) forbids deleting `master`, force
pushes and merge commits, and lets `master` move only to a commit whose status **Release from
develop** is successful; a push of any other commit is refused (`GH013 … Required status check
"Release from develop" is expected`). The Release workflow sets that status only on the head of
`develop` it has just tagged. No one bypasses the ruleset, the owner included; only someone with
write access, that is the owner, could set the status by hand. It is a commit status rather than
a check run because GitHub counts workflow checks towards a required check only from events such
as `push` and `pull_request`, and the Release run is a `workflow_dispatch`. Do not open pull
requests into `master`: the workflow moves it. To create the ruleset again, in a fork for example:

```bash
gh api --method POST repos/<owner>/<repo>/rulesets --input .github/rulesets/master.json
```

To change it, edit the file and send it with `gh api --method PUT
repos/<owner>/<repo>/rulesets/<id> --input .github/rulesets/master.json`; `gh api
repos/<owner>/<repo>/rulesets` lists the id.

### Tokens

The job pushes the tag and `master` with its own `GITHUB_TOKEN`. GitHub lets that token point a
branch or a tag only at a commit whose `.github/workflows` match the head of the default branch,
and the head of `develop`, the default branch, always does. So the push of `master` is refused
only when `develop` moved on with a workflow change after the release was tagged. Then add a
fine-grained personal access token limited to this repository, with **Contents** and **Workflows**
read and write, as the secret `RELEASE_TOKEN` of the `release` environment, and run the workflow
again: the checkout pushes with it from then on. The workflow opens no pull requests, so
**Settings → Actions → General → Allow GitHub Actions to create and approve pull requests** can
stay off.

### Who can release

GitHub skips the job, without a runner and without asking for approval, when anyone but the
repository owner starts the run or when it runs on any branch but `develop`. The `release`
environment (Settings → Environments) then requires the owner's approval and accepts only
`develop`. Keep that environment: GitHub creates a missing environment that a workflow names,
without any protection rules. The workflow file has to stay on `develop`, the default branch, for
**Run workflow** to appear.

### From a computer

`npm run release -- patch --dry-run` runs the same checks and the tests and prints the version and
the notes. On an up-to-date, clean `develop`, `npm run release -- patch` tags its head in the clone
and prints the command that pushes the tag, and `--push` pushes it. A pushed tag is not a release
yet: run the Release workflow on `develop` to finish it (status, `master`, GitHub release).

`CHANGELOG.md` covers the versions up to 1.0.2; the first tagged release is `v0.1.1`, and `0.1.0`
has a changelog entry but no tag.
