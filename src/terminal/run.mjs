// The terminal status line: stdin JSON → five coloured lines on stdout. Always exits 0,
// because a failing status line command only leaves the user with an empty bar.

import { spawnSync } from 'node:child_process';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { buildLines } from '../core/layout.mjs';
import { claudeConfigDir, limitHistoryPath } from '../core/paths.mjs';
import { TONE } from '../core/thresholds.mjs';
import { renderAnsi } from './ansi.mjs';
import { probeGit } from './git-probe.mjs';
import { recordContext } from './history-store.mjs';
import { recordLimitHistory, transcriptWrittenAtMs } from './limit-history-store.mjs';
import { parseInput, readStdin } from './stdin.mjs';
import { limitsFromStatusInput, snapshotFromStatusInput, workingDirectory } from './snapshot.mjs';

export const FALLBACK_TEXT = 'limits-statusline: no data';

/**
 * @param {{
 *   stdin: NodeJS.ReadableStream, stdout: NodeJS.WritableStream,
 *   env?: Record<string, string | undefined>, argv?: string[], nowMs?: number,
 *   spawn?: typeof spawnSync, home?: string, timeZone?: string,
 * }} io
 * @returns {Promise<0>}
 */
export async function run({
  stdin, stdout, env = {}, argv = [], nowMs = Date.now(), spawn = spawnSync, home = homedir(),
  timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone,
}) {
  const color = !env.NO_COLOR;
  let output;
  try {
    const input = parseInput(await readStdin(stdin));
    output = input ? render(input, { env, argv, nowMs, spawn, color, home, timeZone }) : fallback(color);
  } catch {
    output = fallback(color);
  }
  stdout.write(`${output}\n`);
  return 0;
}

// Histories are kept only by the installed runtime (--data), so a test or a working copy run by
// hand writes nothing into the user's folders.
function render(input, { env, argv, nowMs, spawn, color, home, timeZone }) {
  const dataDir = optionValue(argv, '--data');
  const contextHistory = dataDir
    ? recordContext(join(dataDir, 'history'), input.session_id, input.context_window?.used_percentage, { nowMs })
    : [];
  const configDir = dataDir ? claudeConfigDir(env.CLAUDE_CONFIG_DIR, home) : null;
  const limitReadings = configDir
    ? recordLimitHistory(limitHistoryPath(configDir), {
      sessionId: input.session_id,
      limits: limitsFromStatusInput(input),
      nowMs,
      lastResponseAtMs: transcriptWrittenAtMs(input.transcript_path),
    })
    : undefined;
  const git = probeGit(workingDirectory(input), { spawn });
  const snapshot = snapshotFromStatusInput(input, { nowMs, git, contextHistory, timeZone, limitReadings });
  return renderAnsi(buildLines(snapshot, { columns: Number(env.COLUMNS) }), { color });
}

function fallback(color) {
  return renderAnsi([[{ text: FALLBACK_TEXT, tone: TONE.muted }]], { color });
}

function optionValue(argv, name) {
  const index = argv.indexOf(name);
  const value = index === -1 ? undefined : argv[index + 1];
  return typeof value === 'string' && value !== '' && !value.startsWith('--') ? value : null;
}
