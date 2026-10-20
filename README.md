# Limits Status Line

A Claude Code status line that answers, at a glance, "how much have I spent and how close am I to
my plan limits?". It shows the session's cost, runtime, prompt-cache hit ratio and effort, the
project, git branch and model, how full the context window is, and the claude.ai **7-day** and
**5-hour** limits with the time to reset and a burn rate. When the current pace would pass 100%
before the window resets, the limit turns red.

```
daily-claude | no git | ✦ Opus 5.5
ctx ■■■■■■■■■□□□□□□□ 54%  543k/1.0M  ⣀⡠⠔⠊
    $20.33 · 5h40m · cache 99% · xhigh
7d  ■■■■■■□□□□□□□□□□ 39%  ↻ 76h10m  ↗ 0.4%/h
5h  ■■□□□□□□□□□□□□□□ 12%  ↻ 4h10m   ↗ 14.4%/h
```

It works in both places Claude Code runs on your computer:

- **Terminal** — the classic status line at the bottom of the screen; the context history is a
  braille line.
- **Claude desktop app (Code tab)** — a band above the prompt, drawn by the plugin's mod in the
  app's monospaced face, with the context history as a real vector line.

## Requirements

| Feature | Needs |
|---|---|
| Terminal status line | Claude Code with status line support and **Node.js 20+** on `PATH` |
| Desktop band | Claude Code 2.1.290 or later (the desktop app updates its own copy); the monospaced face from 2.1.299 |
| 7-day and 5-hour limits | A claude.ai Pro or Max subscription; the limits appear after the session's first response |
| Prompt-cache ratio in the terminal | Exact with Claude Code 2.1.251+, estimated from the last request on older versions |

## Install

From a shell, on any Claude Code version with plugins:

```bash
claude plugin marketplace add reylukakozlowski/limits-statusline
claude plugin install limits-statusline@sealoop
```

Newer versions can do both steps in one line: `/plugin install limits-statusline --marketplace
reylukakozlowski/limits-statusline` inside a session (Claude Code 2.1.275+), or
`claude plugin install limits-statusline --marketplace reylukakozlowski/limits-statusline` from a
shell (2.1.292+). In the desktop app: click **+** next to the prompt box, then **Plugins**,
**Add marketplace** with `reylukakozlowski/limits-statusline`, then add **limits-statusline**.

### Turn on the terminal status line

A plugin cannot switch the status line on by itself, so run this once in Claude Code:

```
/limits-statusline:setup
```

It writes `statusLine` into your `settings.json` (in `CLAUDE_CONFIG_DIR` when you set one, else
`~/.claude`). Your previous status line, if you had one, is saved and comes back with
`/limits-statusline:setup --uninstall`. Add `--dry-run` to see what would change without writing
anything. The desktop band needs no setup.

### Uninstall

Run `/limits-statusline:setup --uninstall` **before** removing the plugin: it puts your previous
status line back (or removes the entry). Then run `claude plugin uninstall limits-statusline@sealoop`.
Removing or disabling the plugin first leaves `settings.json` pointing at a runtime that no longer
exists, so the bottom line goes blank; your saved status line is still in
`~/.claude/limits-statusline/previous-statusline.json` and the command above restores it as long as
the plugin is installed.

## What the numbers mean

| Item | Source | Meaning |
|---|---|---|
| `$20.33` | `cost.total_cost_usd` | Session cost estimated by Claude Code at list price; resets on `/clear` |
| `5h40m` | `cost.total_duration_ms` | How long the session has been running (desktop: since the session first started) |
| `cache 99%` | `prompt_cache.hit_ratio` | Share of input tokens served from the prompt cache |
| `xhigh` | `effort.level` | Reasoning effort of the session (desktop: shown after the first request) |
| `ctx 54% 543k/1.0M` | `context_window` | Context window fill; the line shows how it moved during the session |
| `7d` / `5h` | `rate_limits` | Plan usage, `↻` time to reset, `↗` burn rate |

**Burn rate** is the average since the window opened: used percent divided by the hours elapsed
(12% after 50 minutes is 14.4%/h). The **projection** extends that pace to the reset. Colours:
green below 80% projected, yellow from 80% to 100%, **red above 100%** or when the limit is used up.
In the first 15 minutes of a window there is no rate yet (`↗ —`). The context bar is green below
50%, orange to 80% and red above. The context line is scaled from its lowest to its highest point,
so it shows the shape of the trend; the percentage next to the bar is the absolute figure.

## Settings

| Option | Values | Default |
|---|---|---|
| `band` | `desktop` (band only in the desktop app), `all` (also in the terminal), `off` | `desktop` |

Change it in `/config` or in the plugin's settings in the desktop app. Set `NO_COLOR=1` to print
the terminal status line without colours.

## What the plugin runs and writes

Everything stays on your computer. The plugin makes no network requests and reads no credentials.

- **Status line** (terminal): reads the JSON Claude Code passes on stdin, runs
  `git status --porcelain=v2 --branch --untracked-files=no` in the working folder (with
  `GIT_OPTIONAL_LOCKS=0`, so it never takes git's index lock), and keeps a small context history per
  session under `~/.claude/plugins/data/limits-statusline-sealoop/history/` (pruned after 7 days).
- **Setup** (`/limits-statusline:setup`): copies the status line runtime into the plugin's data
  folder, writes `statusLine` to `settings.json` (atomically, through a symlink if it is one), and
  keeps your previous status line and a copy of the previous `settings.json` in
  `~/.claude/limits-statusline/`. It refuses to touch a settings file that is not valid JSON.
- **SessionStart hook**: after setup has run, refreshes the runtime copy after a plugin update and
  rebuilds it if it went missing; before setup it does nothing.
- **Desktop band** (mod): reads the session's figures from Claude Code, runs the same `git status`
  (or reads `.git/HEAD` where commands are unavailable) and redraws once a minute so the reset
  countdowns stay current.

## Troubleshooting

- **Nothing shows in a new session** — the plugin is not installed: `claude --plugin-dir` and a
  session's hot-reloaded mods folder load it for that session only. `claude plugin list` should
  show `limits-statusline@sealoop`; if it does not, follow [Install](#install) (or, for a clone,
  [Run a working copy in every session](#run-a-working-copy-in-every-session)).
- **The terminal shows nothing** — run `/limits-statusline:setup` and check that `node --version`
  prints 20 or higher. On Windows the command runs through Git Bash or PowerShell; its paths use
  forward slashes so both read them.
- **`7d —` and `5h —`** — the limits arrive with the first response of a session and only for
  Pro and Max subscribers.
- **No effort or cache shown** — older Claude Code versions do not send them; update Claude Code.

## Development

```bash
npm test                 # unit and integration tests (node:test)
npm run test:coverage    # the same with coverage
npm run test:mod         # the desktop band, run by the engine itself (Claude Code 2.1.299+)
claude plugin validate .  # manifest, hooks module and state contract
```

The code is split into a pure `src/core` (snapshot → lines), a terminal adapter
(`src/terminal`) and a desktop adapter (`src/desktop`). Tests run locally, and the Release
workflow runs them again before every release.

### Run a working copy in every session

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
   without changing anything.
3. Approve the run: the release job waits for the owner's approval of the `release` environment.
4. The job runs `npm test`, bumps the version in `package.json`, `plugin.json` and
   `marketplace.json`, stamps the changelog, commits `LS-N chore(release): vX.Y.Z`, tags `vX.Y.Z`
   and pushes the commit and the tag to `develop` in one atomic push: when `develop` moved on in the
   meantime, neither is pushed and nothing changes. The publish job then creates the GitHub release
   with the changelog notes. A failed publish can be re-run on its own; it skips a release that
   already exists.

The `sealoop` marketplace serves `develop`, so the push is what reaches users: they get the new
version with `claude plugin update limits-statusline@sealoop`, or by themselves when they turned
auto-update on for this marketplace (it is off by default for marketplaces outside Anthropic's).
The first tagged release is `v0.1.1`; `0.1.0` has a changelog entry but no tag.

Who can release: the workflow stops anyone but the repository owner, and any branch but `develop`,
before it asks for approval, and the `release` environment (Settings → Environments) requires the
owner's approval and accepts only `develop`. Keep that environment: GitHub creates a missing
environment that a workflow names, without any protection rules. The workflow file has to stay on
`develop`, the default branch, for **Run workflow** to appear.

The same release still runs from a computer, on an up-to-date `develop`:
`npm run release -- patch --push` (or `--dry-run`). The tag it pushes starts only the publish job.

## License

MIT © 2026 Luka Kozlowski (SeaLoop) · lukakozlowski@outlook.com
