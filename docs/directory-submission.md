# Submitting to Anthropic's directory

What the developer portal asks for when this plugin is listed in [Anthropic's
directory](https://claude.ai/directory), with the answers for this repository. The submission is
made once, by the owner, at [claude.ai/directory/manage](https://claude.ai/directory/manage); after
that every release reaches the directory by itself, because the directory follows `develop` and
the Release workflow merges each release there.

## Before you submit

- A paid claude.ai plan (Pro or Max submits from its own account) and your GitHub account connected
  on claude.ai: the portal checks that the connected account can push to the repository.
- The repository is public, which publishing needs.
- `npm test` is green. Its `directory rules` tests in `test/scripts/manifests.test.mjs` cover the
  checks of the [pre-submission checklist](https://claude.com/docs/plugins/pre-submission-checklist)
  that can be read from the files: README of 40+ words, license, files under 256 KiB, at most 512
  files, only text and PNG files, names valid on Windows and macOS, no OS files, no lockfile, no
  `.gitattributes` that rewrites files, hook commands through `${CLAUDE_PLUGIN_ROOT}`.
- Optional: `claude plugin validate --strict .` in the repository. The portal's **Validate** runs
  more checks than the command.

## The form

1. **Submit new** → **Plugin bundle**.
2. **Source**
   - Repository: `reylukakozlowski/limits-statusline`
   - Plugin path: leave empty; the plugin is the repository root
   - Branch or tag: `develop`
   - Select **Validate** and fix anything marked **Blocking**, then validate again. A result covers
     one commit, so validate again after every push.
3. **Listing details** come from `.claude-plugin/plugin.json` (`displayName`, `description`, `icon`,
   `author`) and `README.md`. Change them there, not in the portal.
4. **Data handling**: the facts below are from [PRIVACY.md](../PRIVACY.md); the answers are yours to
   give.
   - Reads or stores personal data: it reads what Claude Code gives every status line (cost,
     duration, context fill, cache counts, effort, model, plan limits), the working folder and the
     git branch, which can contain names. It shows them on your screen and keeps them on your
     computer only: context-fill percentages for 7 days, the desktop band's figures in Claude
     Code's session state. It reads no prompts, responses, conversation history or credentials.
   - Sends data to services other than its declared connectors: no. It makes no network requests
     and declares no connectors.
   - How long it keeps data: context-fill history 7 days; the runtime copy, the `statusLine`
     entry and the setup backups until you uninstall or remove them.
   - Intended for people under 18: no; it is a developer tool.
5. **Compliance**: contact email `lukakozlowski@outlook.com` (the address in `plugin.json` and
   `PRIVACY.md`). Read the [Anthropic Software Directory
   Terms](https://support.claude.com/en/articles/13145338-anthropic-software-directory-terms) and
   [Policy](https://support.claude.com/en/articles/13145358-anthropic-software-directory-policy)
   before you select the four acknowledgements.
6. **Review and submit**
   - How new versions reach the directory: **GitHub push webhook**, then **Set up push updates**
     (needs admin access to the repository). The directory also checks `develop` on a schedule.
   - Auto-publish: the directory follows `develop`, so every merge that passes its checks becomes a
     version, not only releases, and commits between releases keep the last version number. With
     auto-publish off, you select **Publish** only for the release commits
     (`LS-N_chore(release): vX.Y.Z`). With it on, every passing merge goes live.

## After the listing

A release merges `LS-N_chore(release): vX.Y.Z` into `develop`; the webhook or the scheduled check
picks it up, the directory validates and scans it, and it is published as the plugin's publish
setting says. The **Versions** tab on the plugin's page in the portal shows each scanned commit and
why a version is not live; **Check for new commits** scans at once. People who added the plugin
from the directory have it in Claude Code as `limits-statusline@synced`.

Sources: [Submit your plugin](https://claude.com/docs/plugins/submit), [Plugin pre-submission
checklist](https://claude.com/docs/plugins/pre-submission-checklist), [Publish and distribute a
plugin](https://code.claude.com/docs/en/plugins/publish).
