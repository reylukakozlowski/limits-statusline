# limits-statusline Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A Claude Code plugin that draws a 5-line limits/cost/context status line in the terminal (classic `statusLine`) and in the desktop Code tab (mod band), with setup, tests, release tooling and marketplace metadata.

**Architecture:** A pure `src/core` (no Node built-ins, no clock reads) turns a normalized `Snapshot` into a renderer-agnostic `Line[]`. Two adapters build the `Snapshot`: `src/terminal` (Node, stdin JSON → ANSI) and `src/desktop` (mods API → `Box`/`Text` tree). Scripts handle setup, runtime sync and releases.

**Tech Stack:** Node ≥ 20 ESM `.mjs`, zero dependencies, `node:test`; Claude Code mods API (2.1.299 types); GitHub Actions (release only).

**Spec:** `docs/superpowers/specs/2026-10-20-limits-statusline-design.md`

## Global Constraints

- Node ≥ 20, zero runtime/dev dependencies, no lockfile, all source `.mjs` ESM.
- `src/core/**` imports nothing but other `src/core` files; time comes in as `nowMs`.
- Plugin at repo root; no top-level `bin/`; every file < 256 KiB; README ≥ 40 words outside code blocks.
- Identity strings, exactly: author `{ "name": "Luka Kozlowski", "email": "lukakozlowski@outlook.com" }`; marketplace `name: "sealoop"`, owner `{ "name": "SeaLoop", "email": "lukakozlowski@outlook.com" }`; LICENSE `Copyright (c) 2026 Luka Kozlowski (SeaLoop)`.
- Version `0.1.0` kept identical in `package.json`, `.claude-plugin/plugin.json`, `.claude-plugin/marketplace.json` `plugins[0].version`.
- Hook commands reference files only as `"${CLAUDE_PLUGIN_ROOT}/…"`. Paths written into settings use forward slashes.
- The status line never throws and never prints `undefined`/`NaN`; missing data renders `—` or is omitted.
- No network access, no credential reads.
- Git: branch `develop`; ONE commit for the whole development after verification (user rule), message `LS-1 feat: …`, author Luka Kozlowski, no `Co-Authored-By` trailer.
- Tests: `npm test` = `node --test "test/**/*.test.mjs"`; mod tests `*.test.ts` run by `claude plugin test` (2.1.299 binary).

## Review Focus

1. `rate_limits` absent (API-key user, before first response) → lines `7d —` / `5h —` in muted tone, no crash. Pinned in Task 3 (`layout renders placeholders without limits`).
2. Window just reset (elapsed < 15 min) or `resets_at` in the past / beyond the window (clock skew) → no rate, no false red. Pinned in Task 2 (`analyzeLimit early window`, `analyzeLimit skewed reset`).
3. Malformed / empty stdin or settings.json → status line prints a fallback line and exits 0; setup refuses to write and exits 2. Pinned in Tasks 4 and 5.
4. Narrow terminal (`COLUMNS` < 70) → bars shrink to 10, sparkline hidden, no wrap. Pinned in Task 3 (`layout narrow`).
5. Hostile `session_id` (`../../x`) → no file written outside the history dir. Pinned in Task 4 (`history rejects unsafe session id`).

---

### Task 1: Scaffold + formatting and glyph primitives

**Files:**
- Create: `package.json`, `.gitignore`, `.gitattributes`, `src/core/format.mjs`, `src/core/glyphs.mjs`, `src/core/model-name.mjs`
- Test: `test/core/format.test.mjs`, `test/core/glyphs.test.mjs`, `test/core/model-name.test.mjs`

**Interfaces:**
- Produces: `formatDuration(ms) → string`, `formatTokens(n) → string`, `formatUsd(n) → string`, `formatPercent(p) → string`, `formatRate(r) → string` (format.mjs); `progressBar(percent, width) → { filled: string, empty: string }`, `sparkline(values, maxPoints) → string`, `GLYPH` constants (glyphs.mjs); `prettyModelName(raw) → string | null` (model-name.mjs). Every function returns `'—'` (format) or `null` (model) for non-finite input.

- [ ] **Step 1: Write failing tests**

```js
assert.equal(formatDuration(20_400_000), '5h40m');   // mockup
assert.equal(formatDuration(274_200_000), '76h10m'); // hours past 24, no days
assert.equal(formatDuration(14_700_000), '4h05m');   // minutes zero-padded after hours
assert.equal(formatDuration(3_000_000), '50m');
assert.equal(formatDuration(42_000), '42s');
assert.equal(formatDuration(-1), '—'); assert.equal(formatDuration(NaN), '—');
assert.equal(formatTokens(543_000), '543k'); assert.equal(formatTokens(1_000_000), '1.0M');
assert.equal(formatTokens(999_600), '1.0M'); assert.equal(formatTokens(950), '950');
assert.equal(formatUsd(20.333), '$20.33'); assert.equal(formatUsd(0), '$0.00');
assert.equal(formatPercent(53.6), '54%'); assert.equal(formatRate(14.4), '14.4%/h'); assert.equal(formatRate(0.4247), '0.4%/h');
assert.deepEqual(progressBar(54, 20), { filled: '■'.repeat(11), empty: '□'.repeat(9) });
assert.deepEqual(progressBar(12, 20), { filled: '■■', empty: '□'.repeat(18) });
assert.deepEqual(progressBar(140, 10), { filled: '■'.repeat(10), empty: '' });   // clamp
assert.deepEqual(progressBar(-5, 10), { filled: '', empty: '□'.repeat(10) });
assert.equal(sparkline([0, 50, 100], 16), '▁▅█');  // absolute 0–100 scale, 8 levels
assert.equal(sparkline([10, 20, 30], 2), '▂▃');     // keeps the newest maxPoints
assert.equal(sparkline([], 16), '');
assert.equal(prettyModelName('claude-opus-5-5'), 'Opus 5.5');
assert.equal(prettyModelName('claude-opus-5-5[1m]'), 'Opus 5.5');
assert.equal(prettyModelName('claude-sonnet-4-5-20250929'), 'Sonnet 4.5');
assert.equal(prettyModelName('Opus 5.5'), 'Opus 5.5'); assert.equal(prettyModelName(''), null);
```

- [ ] **Step 2: Run** `node --test test/core/` → FAIL (modules missing).
- [ ] **Step 3: Implement** the three modules. Sparkline level = `min(7, floor(clamp(v,0,100) / 100 * 8))` over `'▁▂▃▄▅▆▇█'`. `package.json`: `name`, `version 0.1.0`, `private: true`, `type: module`, `engines.node >=20`, scripts `test`, `test:coverage` (`--experimental-test-coverage`), `release`. `.gitattributes`: `* text=auto eol=lf`. `.gitignore`: `node_modules/`, `coverage/`, `.claude-plugin/types/`, `*.log`, `.DS_Store`, `Thumbs.db`, `desktop.ini`.
- [ ] **Step 4: Run** `node --test test/core/` → PASS.

### Task 2: Limit metrics and colour thresholds

**Files:** Create `src/core/metrics.mjs`, `src/core/thresholds.mjs`; Test `test/core/metrics.test.mjs`, `test/core/thresholds.test.mjs`

**Interfaces:**
- Produces: `WINDOW_MS = { fiveHour: 18_000_000, sevenDay: 604_800_000 }`, `MIN_ELAPSED_MS = 900_000`; `analyzeLimit({ percentUsed, resetsAtMs }, windowMs, nowMs) → { percentUsed, remainingMs: number|null, ratePerHour: number|null, projectedPercent: number|null }`; `cacheHitRatio({ inputTokens, cacheCreationTokens, cacheReadTokens }) → number|null`; `TONE` enum (`plain, muted, accent, model, ok, warn, alert, cost, spark`); `limitTone({ percentUsed, projectedPercent }) → tone`; `contextTone(percent) → tone`.

- [ ] **Step 1: Failing tests** — mockup values with `now = 0`:
  - 5h: `analyzeLimit({percentUsed:12, resetsAtMs:15_000_000}, WINDOW_MS.fiveHour, 0)` → `ratePerHour ≈ 14.4` (±0.05), `projectedPercent ≈ 72`, `remainingMs 15_000_000`.
  - 7d: `{39, resetsAtMs: 274_200_000}` → rate ≈ 0.4247, projected ≈ 71.
  - `analyzeLimit early window`: resets in `window − 600_000` → `ratePerHour null, projectedPercent null`.
  - `analyzeLimit skewed reset`: `resetsAtMs > now + window` → rate/projection null; `resetsAtMs < now` → `remainingMs 0`, projected = used.
  - `resetsAtMs null` → remaining/rate/projection null; non-finite `percentUsed` → returns `null`.
  - `cacheHitRatio({inputTokens:10, cacheCreationTokens:0, cacheReadTokens:990})` → 0.99; all zero → null.
  - `limitTone`: projected 79.9 → ok, 80 → warn, 100 → warn, 100.1 → alert; projected null & used 85 → warn; used 100 → alert.
  - `contextTone`: 49 → ok, 50 → warn, 80 → warn, 80.1 → alert, null → muted.
- [ ] **Step 2: Run** → FAIL. **Step 3: Implement** (`elapsed = windowMs − (resetsAtMs − nowMs)`; rate only when `MIN_ELAPSED_MS ≤ elapsed ≤ windowMs`; `projected = used + rate × remainingMs/3.6e6`). **Step 4: Run** → PASS.

### Task 3: Git status parser and the line layout

**Files:** Create `src/core/git-status.mjs`, `src/core/layout.mjs`; Test `test/core/git-status.test.mjs`, `test/core/layout.test.mjs`, `test/fixtures/snapshots.mjs`

**Interfaces:**
- Consumes: Tasks 1–2.
- Produces: `GIT_STATUS_ARGS = ['status','--porcelain=v2','--branch','--untracked-files=no']`; `parseGitStatus({ exitCode, stdout }) → { isRepo, branch: string|null, isDirty: boolean }` (`exitCode ≠ 0` → `{ isRepo:false, branch:null, isDirty:false }`; `# branch.head (detached)` → branch from `branch.oid` first 7 chars; any non-`#` line → dirty).
- Produces: `buildLines(snapshot, { columns }) → Line[]`, `Line = Segment[]`, `Segment = { text, tone }`. **Snapshot** (JSDoc typedef in layout.mjs, the contract both adapters fill):
  `{ nowMs, project: string|null, git: {isRepo, branch, isDirty}|null, modelName, costUsd, durationMs, cacheHitRatio, effort, context: { usedTokens, windowTokens, percent }, contextHistory: number[], limits: { sevenDay: {percentUsed, resetsAtMs}|null, fiveHour: …|null } }` (absent values are `null`).

- [ ] **Step 1: Failing tests** with fixture `MOCKUP` (the spec's mockup numbers): `plain(buildLines(MOCKUP,{columns:120}))` equals the 5 spec lines (labels padded to 3 chars + space, two spaces between columns); tone of the 7d `%` segment is `ok`, ctx `%` is `warn`, cost is `cost`, model is `model`; `layout renders placeholders without limits` → line 4 `7d  —`, line 5 `5h  —`, tone `muted`; `layout narrow` (`columns:60`) → bars of 10, no sparkline segment; missing cost/effort/cache → those items dropped from line 3 without double separators; `git null` → `no git`; dirty → `git develop*`; projected 104 → rate segment and bar tone `alert`. Parser: clean repo on `develop`, dirty repo, detached head, `exitCode 128` → not a repo.
- [ ] **Step 2: Run** → FAIL. **Step 3: Implement** `layout.mjs` as small per-line builders (`headerLine`, `contextLine`, `sessionLine`, `limitLine`) composed by `buildLines`. **Step 4: Run** → PASS.

### Task 4: Terminal adapter

**Files:** Create `src/terminal/{stdin,snapshot,git-probe,history-store,ansi,main}.mjs`; Test `test/terminal/*.test.mjs`, `test/fixtures/status-input.full.json` (docs schema + mockup values), `status-input.minimal.json`, `status-input.legacy.json` (no `prompt_cache`, no `effort`, no `rate_limits`)

**Interfaces:**
- Consumes: core `buildLines`, `parseGitStatus`, `GIT_STATUS_ARGS`, `cacheHitRatio`, `prettyModelName`.
- Produces: `readStdin(stream, { timeoutMs = 1500 }) → Promise<string>`; `parseInput(text) → object|null`; `snapshotFromStatusInput(input, { nowMs, git, contextHistory }) → Snapshot` (project = `workspace.repo.name ?? basename(project_dir ?? current_dir ?? cwd)`; resets `× 1000`; cache = `prompt_cache.hit_ratio ?? cacheHitRatio(current_usage)`); `probeGit(cwd, { spawn = spawnSync, timeoutMs = 1000 }) → {isRepo, branch, isDirty}|null` (`null` when git is missing/times out); `recordContext(dir, sessionId, percent, { maxPoints = 40 }) → number[]` (rejects ids not matching `/^[A-Za-z0-9_-]{1,128}$/` → `[]`; appends only a finite percent; atomic tmp+rename write; on any fs error returns `[]`); `renderAnsi(lines, { color }) → string` (256-colour SGR per tone, reset after each segment, `\n`-joined; `color:false` → plain); `run({ stdin, stdout, env, argv, nowMs }) → Promise<0>` (`--data <dir>` enables history under `<dir>/history`; `NO_COLOR` disables colour; any error → prints `limits-statusline: no data` muted, returns 0).

- [ ] **Step 1: Failing tests**: snapshot from `full` matches the `MOCKUP` snapshot; `legacy` → cache from `current_usage`, effort null, limits null; `minimal` (`{}`) → all-null snapshot; `parseInput('')`/`'{'` → null; `history rejects unsafe session id` (`'../../x'` → `[]`, no file outside dir); history caps at `maxPoints`; `renderAnsi` with `color:false` equals the plain text, with `color:true` contains `\x1b[38;5;` and ends each segment with `\x1b[0m`; integration (`main.integration.test.mjs`): spawn `node src/terminal/main.mjs` with `full` on stdin, `NO_COLOR=1`, `COLUMNS=120` → 5 lines, line 1 starts with project name; garbage stdin → exit 0 and fallback line; wall time < 1000 ms.
- [ ] **Step 2: Run** → FAIL. **Step 3: Implement.** `main.mjs` runs `run()` only when it is the entry module (`import.meta.url === pathToFileURL(process.argv[1]).href`). **Step 4: Run** `npm test` → PASS.

### Task 5: Setup, runtime sync and the SessionStart hook

**Files:** Create `scripts/lib/settings-plan.mjs`, `scripts/lib/runtime-sync.mjs`, `scripts/lib/fs-atomic.mjs`, `scripts/setup.mjs`, `scripts/sync-runtime.mjs`, `commands/setup.md`; Test `test/scripts/settings-plan.test.mjs`, `test/scripts/runtime-sync.test.mjs`, `test/scripts/setup.integration.test.mjs`

**Interfaces:**
- Produces: `MARKER = 'limits-statusline'`; `buildStatusLineCommand({ mainPath, dataDir }) → string` = `node "<mainPath>" --data "<dataDir>"` with `\` → `/`; `isOwnStatusLine(statusLine) → boolean` (command contains MARKER); `planInstall(settings, { command, refreshInterval = 60 }) → { settings, previous, changed }` (never mutates input; `previous` = foreign statusLine or null); `planUninstall(settings, { previous }) → { settings, changed }` (restores previous, else deletes key, only if current is own); `writeFileAtomic(path, text)`; `syncRuntime({ pluginRoot, dataDir, version }) → { copied }` (copies `src/core`, `src/terminal` into `<dataDir>/runtime/src/` when `<dataDir>/runtime/VERSION` ≠ version).
- `scripts/setup.mjs` CLI: `--data <dir>` (required), `--settings <file>` (default `~/.claude/settings.json`), `--uninstall`, `--dry-run`. Exit 0 ok, 1 usage error, 2 refused (invalid JSON). Saves the foreign statusLine to `<data>/previous-statusline.json` (only if absent) and a copy of settings to `<data>/settings.backup.json` before writing.
- `scripts/sync-runtime.mjs`: reads `CLAUDE_PLUGIN_ROOT`, `CLAUDE_PLUGIN_DATA`; syncs only if `<data>/runtime` exists; always exits 0 silently.
- `commands/setup.md`: frontmatter `description`, `argument-hint: [--uninstall]`; body tells Claude to run `node "${CLAUDE_PLUGIN_ROOT}/scripts/setup.mjs" --data "${CLAUDE_PLUGIN_DATA}" $ARGUMENTS` and report its output.

- [ ] **Step 1: Failing tests**: install into `{}`; install over a foreign statusLine keeps it in `previous`; re-install is `changed:false`; uninstall restores foreign; uninstall when current is foreign → `changed:false`; command uses forward slashes for `C:\\Users\\x`; integration on a temp dir: invalid JSON settings → exit 2 and file byte-identical; happy path writes `statusLine.command` containing `--data`, backup file exists, runtime `VERSION` = `0.1.0`; `--dry-run` writes nothing; sync is a no-op when versions match.
- [ ] **Step 2: Run** → FAIL. **Step 3: Implement.** **Step 4: Run** `npm test` → PASS.

### Task 6: Desktop band (mod)

**Files:** Create `hooks/hooks.json`, `hooks/register.mjs`, `src/desktop/tracker.mjs`, `src/desktop/snapshot.mjs`, `src/desktop/band-view.mjs`, `src/desktop/band.mjs`, `types/index.d.ts`; Test `test/desktop/*.test.mjs`, `test/desktop/band.test.ts`

**Interfaces:**
- Consumes: core `buildLines`, `parseGitStatus`, `GIT_STATUS_ARGS`, `cacheHitRatio`, `prettyModelName`.
- Produces: `hooks/hooks.json` = `{ "modules": ["./register.mjs"], "hooks": { "SessionStart": [{ "hooks": [{ "type": "command", "command": "node \"${CLAUDE_PLUGIN_ROOT}/scripts/sync-runtime.mjs\"" }] }] } }`.
- `tracker.mjs` (pure reducers over `Tracker = { effort, cache: {input, creation, read}, history: number[], git }`): `initialTracker()`, `withEffort(t, step)` (ignores steps with `agentId`), `withTurnUsage(t, complete)` (ignores `agentId`, missing usage), `withContext(t, percent, maxPoints = 40)`, `withGit(t, git)`.
- `snapshot.mjs`: `snapshotFromSession({ usage, modelRaw, cwd, tracker, nowMs }) → Snapshot` (`kind 'five_hour'|'seven_day'`, `Date.parse(resetsAt)`, duration `nowMs − startedAt`).
- `band-view.mjs`: `TONE_COLOR = { ok:'success', warn:'warning', alert:'error', accent:'suggestion', model:'merged', muted:'subtle', cost:'claude', spark:'suggestion' }`; `renderBand(lines, { Box, Text }) → RenderNode` via global `h` (column Box, one Text row per line, one nested Text per segment).
- `band.mjs`: `registerBand(on, options)`; `shouldDraw(mode, surface)` (`'desktop'` → only `desktop`, `'all'` → terminal+desktop, `'off'` → never). Hooks: `turn.step` async generator recording effort then `yield* next(e)`; `turn.complete`, `session.measure` (records `context.percent`, refreshes git via `$.process.run(['git', ...GIT_STATUS_ARGS], { cwd, timeoutMs: 1500 })`), `session.start` (git + `$.clock.every(60_000, () => $.ui.invalidate('ui.render'))`), `ui.render` `{ component: 'AbovePrompt' }` (`next(e)` when not drawing or `e.props.hasSurvey`; columns = `e.props.bodyColumns`). State in `atom({ plugin: 'limits-statusline', key: 'tracker' }, initialTracker())`, declared in `types/index.d.ts`.
- `plugin.json` `userConfig.band`: `{ type: string, title: "Band above the prompt", description, options: ["desktop","all","off"], default: "desktop" }`; `"types": "./types/index.d.ts"`.

- [ ] **Step 1: Failing tests**: reducers (subagent steps ignored; cache totals sum; history cap); `snapshotFromSession` with mockup-equivalent usage equals `MOCKUP` limits; `shouldDraw` matrix; `band.test.ts` (claude plugin test): mount `AbovePrompt` on `desktop` with `session.usage`/`session.model`/`session.cwd` answered by the test's hooks → a Text containing `7d` exists; on `terminal` with default options → engine's own drawing (no `7d`).
- [ ] **Step 2: Run** → FAIL. **Step 3: Implement.** **Step 4: Run** `npm test` and `"$CC299" plugin test .` → PASS; `"$CC299" plugin validate . --strict` → `Validation passed`.

### Task 7: Manifests, docs and release tooling

**Files:** Create `.claude-plugin/plugin.json`, `.claude-plugin/marketplace.json`, `README.md`, `CHANGELOG.md`, `LICENSE`, `PRIVACY.md`, `scripts/lib/release-lib.mjs`, `scripts/release.mjs`, `scripts/release-notes.mjs`, `.github/workflows/release.yml`; Test `test/scripts/release-lib.test.mjs`, `test/scripts/manifests.test.mjs`

**Interfaces:**
- `release-lib.mjs`: `nextVersion(current, kind) → string` (`patch|minor|major|X.Y.Z`, throws on garbage or non-increasing explicit version); `stampChangelog(text, version, isoDate) → string` (moves `## [Unreleased]` body under `## [version] - date`, leaves an empty Unreleased; throws if Unreleased is empty); `extractReleaseNotes(text, version) → string` (throws if missing); `nextCommitIndex(subjects, prefix = 'LS') → number`; `withVersion(json, version) → json` for the three manifests.
- `release.mjs`: `<patch|minor|major|X.Y.Z> [--push] [--dry-run]`; refuses unless on `develop` with a clean tree; runs `npm test`; writes versions + changelog; commits `LS-<N> chore(release): v<version>`; annotated tag `v<version>`; `--push` → `git push origin develop --follow-tags`.
- `release.yml`: `on.push.tags: ['v*.*.*']`, `permissions: contents: write`, steps: checkout, `node scripts/release-notes.mjs "$GITHUB_REF_NAME" > notes.md`, `gh release create "$GITHUB_REF_NAME" --title "$GITHUB_REF_NAME" --notes-file notes.md` with `GH_TOKEN`. No test job.
- Manifests: `plugin.json` — name, displayName `Limits Status Line`, version, description, author (constraint), license `MIT`, keywords, `homepage`/`repository` = `https://github.com/Reywedian/limits-statusline`, `documentationUrl` (README), `supportUrl` (issues), `privacyPolicyUrl` (PRIVACY.md), `userConfig.band`, `types`. `marketplace.json` — `name: sealoop`, owner (constraint), one plugin entry `source: "./"`.

- [ ] **Step 1: Failing tests**: version bumps and refusals; changelog stamp/extract; commit index from `['LS-1 feat: x','LS-7 fix: y','foo']` → 8; `manifests.test.mjs` asserts the three versions are equal, author/owner strings are exactly the constraint, plugin name is not `claude-*`, no top-level `bin/`, every tracked file < 256 KiB, README ≥ 40 words outside code fences.
- [ ] **Step 2: Run** → FAIL. **Step 3: Implement.** **Step 4: Run** `npm test` → PASS; `"$CC299" plugin validate . --strict` → passed.

### Task 8: Verification, audit, publish

- [ ] `npm test` and `npm run test:coverage` (core ≥ 90 % lines); `"$CC299" plugin validate . --strict`; `"$CC299" plugin test .`.
- [ ] Performance: 20 runs of `main.mjs` with the `full` fixture on Windows, p95 < 300 ms.
- [ ] Auditor pass (completeness, correctness vs sources, consistency, goal) — iterate until "very good".
- [ ] Live desktop check: load the plugin folder into this session's mods (junction in the dev-mods folder), user confirms the band.
- [ ] Single commit `LS-1 feat: …`; `gh repo create Reywedian/limits-statusline --public --source . --push`; repo config (description, topics, issues on, wiki/projects off, default branch `develop`, ruleset blocking force-push/deletion on `develop`); tag `v0.1.0` → Release created by the workflow.
- [ ] Install for the user: `claude plugin marketplace add Reywedian/limits-statusline`, `claude plugin install limits-statusline@sealoop`, run setup; user confirms terminal output.

---

## Iteration 2 — mockup gaps (pixel-measured) and review findings

Measured from the mockup image: bars are **16 cells** (ctx 9/16, 7d 6/16, 5h 2/16); the sparkline is a **thin line ~15 chars wide, min→max scaled over the full row**; line 3 starts in the **bar column** (indent 4). User decisions: SVG line in the desktop band (braille line in the terminal); fix all review findings now.

### Task 9: Layout to mockup (core)
- `src/core/glyphs.mjs`: `BAR_CELLS = 16`; `normalizeSeries(values, maxPoints) → number[]` (newest finite points, min→0, max→1, flat → 0.5); `brailleLine(series, widthChars) → string` (2 points per char, 4 dot rows, consecutive points joined vertically; empty series → '').
- `src/core/layout.mjs`: wide = 16-cell bars + 15-char line; narrow below the full line width (52 columns) = 10-cell bars, no line; session line indented 4; the line segment carries `series` (normalized) next to its braille `text`.
- Tests: MOCKUP_LINES updated to the measured mockup; braille glyph cases; narrow at 40 columns.

### Task 10: Desktop band to mockup
- `src/desktop/band-view.mjs`: rows with a `series` segment become a row Box of Text + `Svg` (polyline, `alt` text) when the surface has `Svg`, else the braille text; `mono`/`tabular` on rows only when `supportsTypography(version)` (≥ 2.1.299).
- `src/desktop/sparkline-svg.mjs`: `sparklineSvg(series, { width, height, color }) → string`.
- `src/desktop/git.mjs`: `probeGitWithEngine($)` — `$.process.run` first; on failure `$.session.repo()` + `$.fs.read(<root>/.git/HEAD)` (branch only, dirty unknown).
- `src/desktop/snapshot.mjs`: a window whose `resetsAt` has passed is dropped (as the terminal stdin does).

### Task 11: Setup and runtime robustness (review: Important)
- previous status line is overwritten whenever the current one is foreign; previous + backup live in `<configDir>/limits-statusline/` (survive plugin uninstall); `configDir = CLAUDE_CONFIG_DIR || ~/.claude`; empty or unsubstituted `--data` → `<configDir>/plugins/data/limits-statusline-sealoop`; writes follow a symlinked settings.json; BOM-prefixed settings parse.
- runtime swap: staging → rename old aside → rename staging in → delete old; rollback + short retry on EPERM/EBUSY; setup writes `<data>/setup.json`; the SessionStart hook repairs whenever that marker exists.

### Task 12: Minor review findings and docs
- shared `HISTORY_MAX_POINTS` in core/history; one `LimitReading` typedef; `Number.isFinite` everywhere (drop `isFiniteNumber`); no nested ternary; `\uFEFF` escapes; remove `.gitattributes`; `test:mod` script.
- README: two-step install for older Claude Code (+ one-liners with their minimum versions), Uninstall section, first release, wording; PRIVACY paths.
