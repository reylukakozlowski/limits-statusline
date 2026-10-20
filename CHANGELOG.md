# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project uses
[Semantic Versioning](https://semver.org/).

## [Unreleased]

## [1.0.0] - 2026-10-20

### Changed

- The 7-day pace is shown per hour again (`↗ 0.4%/h`), like the 5-hour one; it still looks back
  over the last 24 hours.

## [0.1.4] - 2026-10-20

### Added

- The 7-day and 5-hour lines show where the usage ends up at the reset if the current pace
  holds, right after the usage (`39% →  71%`), and the reset's clock time next to the countdown
  (`↻ 4h10m 12:10`, with the weekday beyond a day: `3d04h Mon 12:10`).
- When the pace would use a limit up before its reset, the line also says when:
  `⚠ 100% in 1h17m`. On a narrow screen the clock time goes first, then this part.
- The session line shows how long the prompt cache stays warm (`cache 99% 52m`, yellow in its
  last five minutes, `cold` once expired; estimated in the desktop app from the last response and
  Claude Code's cache lifetime) and, in the terminal, the lines changed (`+156 -23`).
- A plan limit history shared by every session and by the status line and the desktop band
  (`~/.claude/limits-statusline/limit-history.json`, readings kept for 1 or 48 hours), so the
  pace counts all sessions and a new session has it at once.

### Changed

- The pace (`↗`) is the recent one instead of the average since the window opened: over the last
  30 minutes for the 5-hour limit, and over the last 24 hours for the 7-day limit, now shown per
  day (`10.2%/d`) and taken across the weekly reset. A Monte Carlo comparison of bursty work
  (`npm run simulate:pace`) chose both look-backs; the 24-hour one keeps the 7-day projection
  from soaring early in the week. The colours follow this projection.
- The limit lines show the newest figure any session saw, so an idle session no longer shows an
  old usage.
- The reset countdown rolls whole days out of the hours (`3d04h` instead of `76h10m`).

## [0.1.3] - 2026-10-20

### Added

- `docs/directory-submission.md`: what the developer portal asks when the plugin is submitted to
  Anthropic's directory, with this repository's answers; the directory follows `develop`.

### Changed

- One run releases: after the owner approves the `release` environment, the Release workflow
  merges its own release pull request (Rebase and merge, only the commit it prepared), tags the
  merged commit and publishes the GitHub release. A pull request it cannot merge stays open, and
  the owner's merge finishes the release as before.
- The session line (cost, runtime, cache, effort) moves up to sit right under the project, git and
  model line, above the context bar, in the terminal and in the desktop band alike.

## [0.1.2] - 2026-10-20

### Added

- An icon for the plugin's listing in Anthropic's directory (`assets/icon.png`, drawn from
  `assets/icon.svg`).
- `SECURITY.md` (private reporting by email) and `CONTRIBUTING.md` (tests, a working copy in every
  session, releases); the README keeps what users need, now with use cases, installing from
  Anthropic's directory, and a support section. `PRIVACY.md` lists what is read and written and for
  how long, for both install sources.

### Changed

- Desktop band: the context history line is filled down to its baseline with a see-through shade
  of the line's colour, so the trend reads as an area.
- `/limits-statusline:setup` runs only when you type it (Claude no longer picks it up on its own),
  and its pre-approved permission covers only its own script instead of any `node` command.
- `.gitignore` keeps lockfiles, package output, secrets, editor and OS files and local Claude
  Code folders out of the repository, which is also the folder users install.

### Fixed

- Releasing with a protected `develop` (changes only through pull requests): the Release workflow
  and `npm run release -- --push` no longer push to `develop`, which the protection refused. They
  commit the version on `release/vX.Y.Z` and open its pull request; after the owner's Rebase and
  merge, the workflow tags the merged commit and publishes the GitHub release.
- The release commit is numbered after every `LS-N` commit, `LS-N_…` subjects included (it took
  `LS-8` after `LS-12_…`), and is named `LS-N_chore(release): vX.Y.Z` like the other commits.

## [0.1.1] - 2026-10-20

### Added

- Release workflow on GitHub (Actions → Release): only the repository owner can run it, from
  `develop`, and each run starts by waiting for the owner's approval of the `release` environment,
  before anything runs. It tests, bumps the version, stamps the changelog, commits, tags, pushes the
  commit and the tag atomically and publishes the GitHub release; a dry run checks all of it and
  changes nothing. Runs are named `Dry run …`, `Release …` or `Publish vX.Y.Z`.

### Changed

- `npm run release -- --dry-run` runs the tests too, `--push` sends the branch and the tag in one
  atomic push, and a version whose tag already exists is refused before anything is written.

### Fixed

- `/limits-statusline:setup` run again after the plugin's data folder was deleted says that it
  rebuilt the runtime, instead of claiming that nothing changed.

## [0.1.0] - 2026-10-20

### Added

- Terminal status line: project, git branch and model; a 16-cell context bar with token counts and
  a braille line of the context history; session cost, runtime, prompt-cache hit ratio and effort;
  7-day and 5-hour plan limits with reset countdown, burn rate and a red warning when the projected
  usage passes 100%.
- Desktop band above the prompt (mod), drawing the same five lines in the Claude desktop app in the
  monospaced face (2.1.299+), with the context history as an SVG line; the branch comes from
  `.git/HEAD` where commands are unavailable.
- `/limits-statusline:setup` to enable the terminal status line (with backup, `--dry-run` and
  `--uninstall`, honouring `CLAUDE_CONFIG_DIR`); the previous status line is kept outside the
  plugin's data folder, and a SessionStart hook keeps the runtime current and repairs it.
- `band` option: `desktop`, `all` or `off`.
- Local release tooling (`npm run release`) and a GitHub workflow that publishes tagged releases.
