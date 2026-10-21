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
   - The report warns that `plugin.json` sets no `version`. That is deliberate and does not block:
     a release is only its tag, so the directory, like Claude Code, tells versions apart by
     commit, and each release that moves `master` is a new version.
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

## After the listing

A release tags `vX.Y.Z` and moves `master` to it; the webhook or the scheduled check picks it up,
the directory validates and scans it, and it is published as the plugin's publish setting says.
Anthropic applies that setting: by default a reviewer publishes each version, and a version with a
policy hold (the band runs `git status` and writes the limit history file) waits for a reviewer.
The **Versions** tab on the plugin's page in the portal shows each scanned commit and why a version
is not live; **Check for new commits** scans at once. People who added the plugin from the
directory have it in Claude Code as `limits-statusline@synced`.

Sources: [Submit your plugin](https://claude.com/docs/plugins/submit), [Plugin pre-submission
checklist](https://claude.com/docs/plugins/pre-submission-checklist), [Publish and distribute a
plugin](https://code.claude.com/docs/en/plugins/publish).
