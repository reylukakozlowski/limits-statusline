# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project uses
[Semantic Versioning](https://semver.org/).

## [Unreleased]

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
