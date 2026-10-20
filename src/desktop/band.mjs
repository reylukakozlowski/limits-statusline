// The mod: listens to the session, keeps a tracker in $.state, and draws the band above the
// prompt from the same core layout as the terminal status line.

import { atom, read, update } from 'claude-code';
import { buildLines } from '../core/layout.mjs';
import { renderBand } from './band-view.mjs';
import { cacheTtlWithEngine } from './cache-ttl.mjs';
import { probeGitWithEngine } from './git.mjs';
import { loadLimitReadings, recordMeasuredLimits } from './limit-history.mjs';
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
    const cacheTtlMs = await cacheTtlWithEngine($, usage?.rateLimits, nowMs);
    const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    const snapshot = snapshotFromSession({ usage, modelRaw, cwd, tracker: state, nowMs, timeZone, limitReadings, cacheTtlMs });
    const lines = buildLines(snapshot, { columns: e.props.bodyColumns });
    return renderBand(lines, $.ui.resolve(e), h, { typography });
  });
}

async function refreshGit($) {
  const git = await probeGitWithEngine($);
  await update($, tracker, (state) => withGit(state ?? initialTracker(), git));
}

async function hasTypography($) {
  try {
    return supportsTypography((await $.session.version()).version);
  } catch {
    return false;
  }
}
