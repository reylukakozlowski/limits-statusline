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

Releases come from the **Release** workflow on GitHub, which only the repository owner can run.

1. Describe the changes under `## [Unreleased]` in `CHANGELOG.md` and merge them into `develop`.
   Run `npm run test:mod` first when the band changed: the workflow does not run it.
2. On GitHub, open **Actions → Release → Run workflow** on `develop` and pick the bump (`patch`,
   `minor` or `major`) or type an exact `X.Y.Z`. Tick **Dry run** to run every check and the tests
   without changing anything. The run is listed as `Dry run patch`, `Release patch` and so on.
3. Approve the run: it starts by waiting for the owner's approval of the `release` environment, and
   nothing runs before it. The approval is also the decision to merge the release.
4. The job runs `npm test`, bumps the version in `package.json`, `plugin.json` and
   `marketplace.json`, stamps the changelog, commits `LS-N_chore(release): vX.Y.Z` on a new branch
   `release/vX.Y.Z`, pushes it and opens its pull request into `develop`. `develop` is protected
   (changes only through pull requests, for the owner too), so nothing is pushed to it directly.
   When origin already has that branch, the run stops before the tests: the earlier pull request
   is still waiting.
5. The job merges that pull request (Rebase and merge, only the commit it prepared, no rule
   bypassed), tags the merged commit `vX.Y.Z` (after the merge, because Rebase and merge gives the
   commit a new SHA), and the publish job creates the GitHub release with the changelog notes. A
   failed publish can be re-run on its own; it skips a release that already exists.

When the job cannot merge the pull request (GitHub still refuses after four tries over about half
a minute), the run fails and the pull request stays open. Merge it with **Rebase and merge**: that
merge changes `package.json` on `develop`, which starts the workflow again, and its tag job tags
and the publish job publishes. When the merge went through but tagging failed, run
`node scripts/tag-release.mjs` on an up-to-date `develop`: the tag it pushes starts the publish job.

The workflow can open the pull request only while **Settings → Actions → General → Workflow
permissions → Allow GitHub Actions to create and approve pull requests** is on; a personal
repository starts with it off. Without it the run pushes the branch, stops, and prints the
`gh pr create` command that opens the pull request by hand.

Anthropic's directory follows `develop` too (see [docs/directory-submission.md](docs/directory-submission.md)):
it scans the merged release and publishes it as its publish setting says.

The `sealoop` marketplace serves `develop`, so the merge is what reaches users: they get the new
version with `claude plugin update limits-statusline@sealoop`, or by themselves when they turned
auto-update on for this marketplace (it is off by default for marketplaces outside Anthropic's).
The first tagged release is `v0.1.1`; `0.1.0` has a changelog entry but no tag.

Who can release: GitHub skips the release job, without a runner and without asking for approval,
when anyone but the repository owner starts the run or when it runs on any branch but `develop`.
The `release` environment (Settings → Environments) then requires the owner's approval and accepts
only `develop`. Keep that environment: GitHub creates a missing
environment that a workflow names, without any protection rules. The workflow file has to stay on
`develop`, the default branch, for **Run workflow** to appear. The tag job asks for no approval:
it runs for a push to `develop` that changes `package.json`, which only a merged pull request can
make, and it only names a commit that is already there.

The same release still runs from a computer, on an up-to-date `develop` and with `gh` signed in:
`npm run release -- patch --push` (or `--dry-run`) commits on `release/vX.Y.Z`, pushes it and opens
the pull request, which the owner then merges with Rebase and merge; the workflow's tag job tags and
publishes as above. Without `--push` the commit stays in the clone, with the commands that push it
and open the pull request.

