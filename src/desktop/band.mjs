// The mod: listens to the session, keeps a tracker in $.state, and draws the band above the
// prompt from the same core layout as the terminal status line.
//
// Every call on `$` is written in this file, as a plain `$.noun.method(...)`: Anthropic's
// directory lists and checks a mod's calls from the source, and reads `$` passed only to a
// function declared at the top of the file that declares the hooks. The other desktop modules
// get the answers as plain values.

import { atom, read, update } from 'claude-code';
import { parseGitStatus } from '../core/git-status.mjs';
import { buildLines } from '../core/layout.mjs';
import { EMPTY_LIMIT_HISTORY, parseLimitHistory, serializeLimitHistory } from '../core/limit-history.mjs';
import { renderBand } from './band-view.mjs';
import { cacheTtlFromEngine } from './cache-ttl.mjs';
import { GIT_TIMEOUT_MS, NOT_A_REPO, gitFromHead } from './git.mjs';
import { limitHistoryFileFor, withMeasuredLimits } from './limit-history.mjs';
import { shouldDraw, supportsTypography } from './policy.mjs';
import { snapshotFromSession } from './snapshot.mjs';
import { afterClear, initialTracker, withContext, withEffort, withGit, withTurnUsage } from './tracker.mjs';

const tracker = atom({ plugin: 'limits-statusline', key: 'tracker' }, initialTracker());

// Reset countdowns tick in minutes; redraw once a minute even while the session is idle.
const REDRAW_EVERY_MS = 60_000;

/** @param {import('claude-code').On} on @param {import('claude-code').PluginOptions} options */
export function registerBand(on, options) {
  const mode = options?.band;

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
    if (e.changed?.includes('rateLimits')) await recordMeasuredLimits($, e.rateLimits, await $.clock.now());
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
    const [usage, modelRaw, cwd, state, nowMs, typography, limitReadings] = await Promise.all([
      $.session.usage(), $.session.model(), $.session.cwd(), read($, tracker), $.clock.now(), hasTypography($),
      loadLimitReadings($),
    ]);
    const cacheTtlMs = await readCacheTtl($, usage?.rateLimits, nowMs);
    const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    const snapshot = snapshotFromSession({ usage, modelRaw, cwd, tracker: state, nowMs, timeZone, limitReadings, cacheTtlMs });
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
  try {
    // The whole command as fixed text, the same as the terminal's GIT_STATUS_ARGS, run in the
    // session's folder (the default). GIT_OPTIONAL_LOCKS: never take the index lock from the
    // user's own git.
    return parseGitStatus(await $.process.run(['git', 'status', '--porcelain=v2', '--branch', '--untracked-files=no'], {
      timeoutMs: GIT_TIMEOUT_MS,
      env: { GIT_OPTIONAL_LOCKS: '0' },
    }));
  } catch {
    return readGitHead($);
  }
}

async function readGitHead($) {
  let repo;
  try {
    repo = await $.session.repo();
  } catch {
    return null;
  }
  if (!repo?.root) return { ...NOT_A_REPO };
  try {
    return gitFromHead(await $.fs.read(`${repo.root}/.git/HEAD`));
  } catch {
    return gitFromHead(null);
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

// The shared limit history: every call settles, so a file that cannot be used leaves the band with
// less to show, never without one.

/** @returns {Promise<string | null>} null when no configuration folder is known */
async function limitHistoryFile($) {
  try {
    // Literal names: the engine lists the variables a module reads from its calls.
    const [configDirVariable, userProfile, home] = await Promise.all([
      $.env.get('CLAUDE_CONFIG_DIR'), $.env.get('USERPROFILE'), $.env.get('HOME'),
    ]);
    return limitHistoryFileFor(configDirVariable, userProfile, home);
  } catch {
    return null;
  }
}

async function readLimitHistory($, file) {
  try {
    return (await $.fs.exists(file)) ? parseLimitHistory(await $.fs.read(file)) : EMPTY_LIMIT_HISTORY;
  } catch {
    return EMPTY_LIMIT_HISTORY;
  }
}

/** @returns {Promise<import('../core/limit-history.mjs').LimitReadings>} the shared readings to draw from */
async function loadLimitReadings($) {
  const file = await limitHistoryFile($);
  return (file ? await readLimitHistory($, file) : EMPTY_LIMIT_HISTORY).readings;
}

/** Adds this session's plan figures, measured just now, to the shared history. */
async function recordMeasuredLimits($, rateLimits, nowMs) {
  const file = await limitHistoryFile($);
  if (!file) return;
  try {
    const history = await readLimitHistory($, file);
    const sessionId = await $.session.id();
    const next = withMeasuredLimits(history, { sessionId, rateLimits, nowMs });
    if (next !== history) await $.fs.write(file, serializeLimitHistory(next));
  } catch {
    // The terminal status line or another session may hold the file for a moment; the next
    // measurement records again.
  }
}
