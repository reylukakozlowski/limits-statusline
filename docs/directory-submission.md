# Submitting to Anthropic's directory

What the developer portal asks for when this plugin is listed in [Anthropic's
directory](https://claude.ai/directory), with the answers for this repository. The submission is
made once, by the owner, at [claude.ai/directory/manage](https://claude.ai/directory/manage); after
that every release reaches the directory by itself, because the directory follows `master`, the
production branch that only a release moves to its tag. `develop` is the working branch and never
reaches users.

## Before you submit

- A paid claude.ai plan (Pro or Max submits from its own account) and your GitHub account connected
  on claude.ai (**Customize → Connectors → GitHub Integration**): the portal checks that the
  connected account can push to the repository, so connect the account that owns it,
  `reylukakozlowski`.
- The repository is public, which publishing needs, and `master` exists: the portal validates the
  branch it will follow.
- The **Tests** workflow passed on macOS, Linux and Windows for every pull request in the release
  (it runs `npm test` on each pull request into `develop`; see CONTRIBUTING.md).
- `npm test` is green. Its `directory rules` tests in `test/scripts/manifests.test.mjs` cover the
  checks of the [pre-submission checklist](https://claude.com/docs/plugins/pre-submission-checklist)
  that can be read from the files: README of 40+ words, license, files under 256 KiB, at most 512
  files, only text and PNG files, names valid on Windows and macOS, no OS files, no lockfile, no
  `.gitattributes` that rewrites files, hook commands through `${CLAUDE_PLUGIN_ROOT}`.
- Optional: `claude plugin validate .` in the repository. The portal's **Validate** runs more
  checks than the command; it reads a mod's calls on `$` only where they are written as plain
  `$.noun.method(...)` in the file that declares the hooks (`src/desktop/band.mjs`).

## The form

1. **Submit new** → **Plugin bundle**.
2. **Source**
   - Repository: `reylukakozlowski/limits-statusline`
   - Plugin path: leave empty; the plugin is the repository root
   - Branch or tag: `master`
   - Select **Validate** and fix anything marked **Blocking**, then validate again. A result covers
     one commit, so validate again after every push. To check a fix before it is released, type
     its branch here, validate, and set `master` again before you go on.
   - `plugin.json` carries the plugin's one `version`, which a pull request raises before each
     release and the release tags as `vX.Y.Z` (CONTRIBUTING.md, Releasing).
3. **Listing details** come from `.claude-plugin/plugin.json` (`displayName`, `description`, `icon`,
   `author`, the links) and `README.md`. Change them there, not in the portal. **Listed on**: tick
   Claude Code only. The status line and the desktop band are a hook and a mod, which run only in
   Claude Code; elsewhere only the setup command would load, as a skill.
4. **Data handling**: the facts are in [PRIVACY.md](../PRIVACY.md).
   - Reads or stores personal data: **Reads and stores**. It reads folder paths and branch names,
     which can contain a person's name, and setup keeps the path of `settings.json` and an exact
     copy of it, all on your computer only.
   - Sends data to services other than its declared connectors: **No**. It makes no network
     requests and declares no connectors.
   - How long your service keeps data received from Claude: **Not retained**. There is no service;
     the local files and how long they stay are in PRIVACY.md.
   - Intended for people under 18: **No**; it is a developer tool.
5. **Compliance**: contact email `lukakozlowski@outlook.com` (the address in `plugin.json` and
   `PRIVACY.md`). Read the [Anthropic Software Directory
   Terms](https://support.claude.com/en/articles/13145338-anthropic-software-directory-terms) and
   [Policy](https://support.claude.com/en/articles/13145358-anthropic-software-directory-policy)
   before you select the four acknowledgements.
6. **Review and submit**
   - How new versions reach the directory: **GitHub push webhook**, then **Set up push updates**
     (needs admin access to the repository). The directory also checks `master` on a schedule.
   - Auto-publish: on. Only a release moves `master`, so every new commit there is a release.

## The band's policy holds

The directory reads the mod's source and holds a version for a reviewer when the mod can run a
program, read files or the conversation and send something out, or write a file. A hold is not a
rejection: an Anthropic reviewer reads the held version before it can go live, and the scan can
raise the same holds again on each new version. The band keeps every feature, so expect these
holds to stay; each one asks for something in the README, which answers it in **Privacy → Desktop
band**:

| Code (line in `band.mjs`) | Why the band has it | Where the README answers |
|---|---|---|
| `MOD_RUNS_PROCESS` (`$.process.run`) | `git status` gives the branch and the `*` for uncommitted changes; no other call tells the band whether files changed | "The one program it runs, and why" |
| `MOD_PROCESS_COMMAND_COMPUTED` (`$.process.run`) | Still raised with the whole call, options included, written out as fixed text; the finding's other way, the README naming what the band runs, is the answer | "The one program it runs, and why" |
| `MOD_LOCAL_DATA_LEAVES` (`$.fs.read` with `$.process.run`) | The band reads the session's `.git/HEAD` (in a worktree, its `.git` file and the `HEAD` it names) and the limit history file, and runs `git`; nothing it reads is passed to `git` | "What it reads", "What it sends, and where" |
| `MOD_SESSION_DATA_LEAVES` (`turn.step` with `$.process.run`) | The effort level is only on `turn.step`; the hook hands the request and response on without looking at their text | "What it reads", "What it sends, and where" |
| `MOD_WRITES_BUILD_FILE` (`$.fs.write`) | The limit history is shared with the terminal status line; its folder is the configuration folder, so only the file's name can be fixed text, and the call writes it out | "The one file it writes" |
| This plugin includes a mod (`hooks/register.mjs`) | Every plugin with a mod is held; it asks for nothing | The README's introduction and Privacy section describe the band |

**Validate** on `develop` @ `522e493` (v1.0.8, 2026-10-21) still raised the five band holds with
the git call and the written file's name as fixed text, so the README is how the band answers
them. The calls stay written out, so a reviewer reads the command and the file at the line the
finding gives.

That report also held the plugin for two findings that name what the plugin never runs or reads,
and warned that `plugin.json` sets no `version`. **Validate** on the branch of pull request #38,
with LS-48 its newest commit (2026-10-22, before LS-45 reached develop; LS-45 adds no new kind of
call on `$`), gave 5 warnings and 7 policy holds, down from 6 and 10: the five band holds above and
the two findings of the credential hold below.

- **No version in plugin.json**: gone. `plugin.json` carries the one version (CONTRIBUTING.md,
  Releasing).
- **Image or font file that the plugin's code could run**: gone. `CHANGELOG.md` and `plugin.json`
  named `assets/icon.png`, an image the validator lets through unread, and a test reads both
  files; the listing's icon is now `assets/icon.svg`, the drawing the PNG came from, which the
  validator reads as text.
- **Uses a credential from the user's machine**: still held, on other files each time one is
  answered. It pairs words, not behaviour: `test/scripts/manifests.test.mjs` names `.npmrc` (a
  sample the `.gitignore` test checks is ignored) beside a claude.com link, and
  `scripts/lib/runtime-sync.mjs` reads the hook's environment (`CLAUDE_PLUGIN_ROOT` and
  `CLAUDE_PLUGIN_DATA` alone) while the README shows `$20.33`, the sample session cost, which the
  validator reads as a command. The plugin reads no credential and sends nothing anywhere. The
  finding allows parts that are unrelated to stay for a reviewer to confirm, and they stay:
  changing the sample would make the README untrue, and renaming what reads the environment would
  only hide it.

Two warnings stay by design, both marked "No action needed" for the listing fields:

- **Unrecognized field in plugin.json**: `documentationUrl`, `supportUrl` and `privacyPolicyUrl`
  are the directory's own listing fields, and `types` is the mod's state contract that
  `claude plugin validate` reads; the [manifest reference](https://code.claude.com/docs/en/plugins/manifest-reference)
  documents all four, and Claude Code ignores them at load time.
- **Field from another tool's manifest**: `icon`, which the directory reads for the listing.

While any hold stays, every release waits for a reviewer, and the portal says auto-publish
"doesn't apply for now: no version of this plugin goes live without an Anthropic reviewer". While
the plugin's status is **In review**, Anthropic acts next and nothing is needed from you. A question
goes through **Get help** or **Contact Anthropic** in the plugin's menu in the portal, or
`directory@anthropic.com`.

The holds follow what the band calls, so a change to `src/desktop/band.mjs` that adds a hook or a
call on `$` fails `test/desktop/directory-review.test.mjs` until the README's Privacy section,
`PRIVACY.md` and the table above describe it.

## After the listing

A release tags `vX.Y.Z` and moves `master` to it; the webhook or the scheduled check picks it up,
the directory validates and scans it, and it is published as the plugin's publish setting says.
Anthropic applies that setting: by default a reviewer publishes each version, and a version with a
policy hold ([the band's policy holds](#the-bands-policy-holds)) waits for a reviewer.

Until the portal has a new commit, the **Versions** tab still shows the previous one. Without the
push webhook the scheduled check looks about every 6 hours; **Check for new commits** starts a
check at once, and the new version is listed when that check ends. The webhook is set up from the
plugin's **Settings → Updates** in the portal: add it in the repository's **Settings → Webhooks**
on GitHub with the payload URL and secret the portal gives (admin access needed). The portal says
"Waiting for GitHub's first delivery" until one arrives.

The **Versions** tab on the plugin's page in the portal shows each scanned commit and why a version
is not live. People who added the plugin from the directory have it in Claude Code as
`limits-statusline@synced`.

Sources: [Submit your plugin](https://claude.com/docs/plugins/submit), [Plugin pre-submission
checklist](https://claude.com/docs/plugins/pre-submission-checklist), [Track your directory
submission](https://claude.com/docs/directory/submission-status), [Publish and distribute a
plugin](https://code.claude.com/docs/en/plugins/publish), [Anthropic Software Directory
Policy](https://support.claude.com/en/articles/13145358-anthropic-software-directory-policy).
