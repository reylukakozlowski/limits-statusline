// The mod: listens to the session, keeps a tracker in $.state, and draws the band above the
// prompt from the same core layout as the terminal status line.
//
// Every call on `$` is written in this file, as a plain `$.noun.method(...)`: Anthropic's
// directory lists and checks a mod's calls from the source, and reads `$` passed only to a
// function declared at the top of the file that declares the hooks. The other desktop modules
// get the answers as plain values.

import { atom, read, update } from 'claude-code';
import { dotGitPaths, gitDirFromFile, gitFromHead } from '../core/git-head.mjs';
import { NOT_A_REPO, parseGitStatus } from '../core/git-status.mjs';
import { buildLines } from '../core/layout.mjs';
import { EMPTY_LIMIT_HISTORY, readLimitHistory, serializeLimitHistory } from '../core/limit-history.mjs';
import { limitHistoryPath } from '../core/paths.mjs';
import { renderBand } from './band-view.mjs';
import { cacheTtlFromEngine, observedCacheTtlMs } from './cache-ttl.mjs';
import { configFolderFor, unreadableFileWatch, withMeasuredLimits } from './limit-history.mjs';
import { shouldDraw, supportsTypography } from './policy.mjs';
import { snapshotFromSession } from './snapshot.mjs';
import { afterClear, initialTracker, withContext, withEffort, withGit, withTurnUsage } from './tracker.mjs';

const tracker = atom({ plugin: 'limits-statusline', key: 'tracker' }, initialTracker());

// Reset countdowns tick in minutes; redraw once a minute even while the session is idle.
const REDRAW_EVERY_MS = 60_000;

/** @param {import('claude-code').On} on @param {import('claude-code').PluginOptions} options */
export function registerBand(on, options) {
  const mode = options?.band;
  const historyFile = unreadableFileWatch();

  on('session.start', async ($, e, next) => {
    await refreshGit($);
    $.clock.every(REDRAW_EVERY_MS, () => $.ui.invalidate('ui.render'));
    return next(e);
  });

  on('turn.step', async function* ($, e, next) {
    await update($, tracker, (state) => withEffort(state ?? initialTracker(), e));
    return yield* next(e);
  });

  on('turn.complete', async ($, e, next) => {
    const nowMs = await $.clock.now();
    await update($, tracker, (state) => withTurnUsage(state ?? initialTracker(), e, nowMs));
    return next(e);
  });

  // A measurement names what moved since the last one, so a plan figure recorded here was
  // observed just now: the shared history gets it with the right time.
  on('session.measure', async ($, e, next) => {
    await update($, tracker, (state) => withContext(state ?? initialTracker(), e.context?.percent));
    if (e.changed?.includes('rateLimits')) await recordMeasuredLimits($, e.rateLimits, await $.clock.now(), historyFile);
    await refreshGit($);
    return next(e);
  });

  // /clear raises session.end with reason 'clear' and no session.start after it.
  on('session.end', async ($, e, next) => {
    if (e.reason === 'clear') await update($, tracker, (state) => afterClear(state ?? initialTracker()));
    return next(e);
  });

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (!shouldDraw(mode, e.surface) || e.props.hasSurvey) return next(e);
    const [usage, modelRaw, cwd, state, nowMs, typography, limitHistory] = await Promise.all([
      $.session.usage(), $.session.model(), $.session.cwd(), read($, tracker), $.clock.now(), hasTypography($),
      loadLimitHistory($),
    ]);
    // The lifetime the API reported, else the one Claude Code's settings and the plan imply.
    const cacheTtlMs = observedCacheTtlMs(state) ?? await readCacheTtl($, usage?.rateLimits, nowMs);
    const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    const snapshot = snapshotFromSession({ usage, modelRaw, cwd, tracker: state, nowMs, timeZone, limitHistory, cacheTtlMs });
    const lines = buildLines(snapshot, { columns: e.props.bodyColumns });
    return renderBand(lines, $.ui.resolve(e), h, { typography });
  });
}

async function refreshGit($) {
  const git = await probeGit($);
  await update($, tracker, (state) => withGit(state ?? initialTracker(), git));
}

/** @returns {Promise<import('../core/git-status.mjs').GitState | null>} null when nothing could be asked */
async function probeGit($) {
  let status = null;
  try {
    // The whole call as fixed text, options too, so that the directory reads the whole command:
    // the terminal's GIT_STATUS_ARGS, run in the session's folder (the default), for at most
    // 1.5 s. --no-optional-locks: never take the index lock from the user's own git.
    status = await $.process.run(['git', '--no-optional-locks', 'status', '--porcelain=v2', '--branch', '--untracked-files=no'],
      { timeoutMs: 1500 });
  } catch {
    // `$.process` is CLI only, or git could not start.
  }
  // A git that failed says nothing about the folder: the session's own HEAD does.
  return parseGitStatus(status) ?? readGitHead($);
}

// The engine's repository says whether the session is in one, but its root is the main working
// tree's for a worktree; the session's own `.git` is looked for from its folder up, as git does.
async function readGitHead($) {
  let repo;
  let cwd;
  try {
    [repo, cwd] = await Promise.all([$.session.repo(), $.session.cwd()]);
  } catch {
    return null;
  }
  if (!repo?.root) return { ...NOT_A_REPO };
  try {
    for (const dotGit of dotGitPaths(cwd)) {
      if (await $.fs.exists(dotGit)) return gitFromHead(await readHead($, dotGit));
    }
  } catch {
    // A HEAD that cannot be read, or a folder the file system refuses: the branch stays unknown.
  }
  return gitFromHead(null);
}

/** A `.git` folder holds HEAD; a `.git` file, a worktree's, names the folder that does. */
async function readHead($, dotGit) {
  try {
    return await $.fs.read(`${dotGit}/HEAD`);
  } catch {
    const gitDir = gitDirFromFile(await $.fs.read(dotGit), dotGit);
    return gitDir === null ? null : $.fs.read(`${gitDir}/HEAD`);
  }
}

async function hasTypography($) {
  try {
    return supportsTypography((await $.session.version()).version);
  } catch {
    return false;
  }
}

/** @returns {Promise<number | null>} null when the engine cannot answer */
async function readCacheTtl($, rateLimits, nowMs) {
  try {
    // Literal names: the engine lists the variables a module reads from its calls.
    const [force5m, chosenTtl, enable1h, settings] = await Promise.all([
      $.env.get('FORCE_PROMPT_CACHING_5M'),
      $.env.get('CLAUDE_CODE_PROMPT_CACHE_TTL'),
      $.env.get('ENABLE_PROMPT_CACHING_1H'),
      $.settings.read(),
    ]);
    const env = { FORCE_PROMPT_CACHING_5M: force5m, CLAUDE_CODE_PROMPT_CACHE_TTL: chosenTtl, ENABLE_PROMPT_CACHING_1H: enable1h };
    return cacheTtlFromEngine({ env, settings, rateLimits, nowMs });
  } catch {
    return null;
  }
}

// The shared limit history. Every call below settles, so a file that cannot be used leaves the
// band with less to show, never without one.

/** @returns {Promise<string | null>} the configuration folder, null when none is known */
async function configFolder($) {
  try {
    // Literal names: the engine lists the variables a module reads from its calls.
    const [configDirVariable, userProfile, home] = await Promise.all([
      $.env.get('CLAUDE_CONFIG_DIR'), $.env.get('USERPROFILE'), $.env.get('HOME'),
    ]);
    return configFolderFor(configDirVariable, userProfile, home);
  } catch {
    return null;
  }
}

/** @returns the shared history, the empty one where there is no file yet, null for a file that cannot be read */
async function storedLimitHistory($, configDir) {
  const file = limitHistoryPath(configDir);
  try {
    return (await $.fs.exists(file)) ? readLimitHistory(await $.fs.read(file)) : EMPTY_LIMIT_HISTORY;
  } catch {
    return null;
  }
}

/** @returns {Promise<import('../core/limit-history.mjs').LimitHistory>} the shared history to draw from */
async function loadLimitHistory($) {
  const configDir = await configFolder($);
  return (configDir === null ? null : await storedLimitHistory($, configDir)) ?? EMPTY_LIMIT_HISTORY;
}

/**
 * Adds this session's plan figures, measured just now, to the shared history.
 * @param {ReturnType<typeof unreadableFileWatch>} historyFile since when the file could not be read
 */
async function recordMeasuredLimits($, rateLimits, nowMs, historyFile) {
  const configDir = await configFolder($);
  if (configDir === null) return;
  try {
    const stored = await storedLimitHistory($, configDir);
    // A file that cannot be read may be one another session is writing: it is left alone until
    // it has stayed unreadable, so its readings are not replaced by this session's alone.
    if (stored === null && !historyFile.mayReplace(nowMs)) return;
    if (stored !== null) historyFile.readable();
    const history = stored ?? EMPTY_LIMIT_HISTORY;
    const sessionId = await $.session.id();
    const next = withMeasuredLimits(history, { sessionId, rateLimits, nowMs });
    // The file's name as fixed text, so that the directory reads which file the mod writes; only
    // the folder comes from the environment, as Claude Code's own configuration folder does.
    if (next !== history) await $.fs.write(`${configDir}/limits-statusline/limit-history.json`, serializeLimitHistory(next));
  } catch {
    // The terminal status line or another session may hold the file for a moment; the next
    // measurement records again.
  }
}
