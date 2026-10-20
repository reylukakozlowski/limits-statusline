// The terminal status line: stdin JSON → five coloured lines on stdout. Always exits 0,
// because a failing status line command only leaves the user with an empty bar.

import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { buildLines } from '../core/layout.mjs';
import { TONE } from '../core/thresholds.mjs';
import { renderAnsi } from './ansi.mjs';
import { probeGit } from './git-probe.mjs';
import { recordContext } from './history-store.mjs';
import { parseInput, readStdin } from './stdin.mjs';
import { snapshotFromStatusInput, workingDirectory } from './snapshot.mjs';

export const FALLBACK_TEXT = 'limits-statusline: no data';

/**
 * @param {{
 *   stdin: NodeJS.ReadableStream, stdout: NodeJS.WritableStream,
 *   env?: Record<string, string | undefined>, argv?: string[], nowMs?: number,
 *   spawn?: typeof spawnSync,
 * }} io
 * @returns {Promise<0>}
 */
export async function run({ stdin, stdout, env = {}, argv = [], nowMs = Date.now(), spawn = spawnSync }) {
  const color = !env.NO_COLOR;
  let output;
  try {
    const input = parseInput(await readStdin(stdin));
    output = input ? render(input, { env, argv, nowMs, spawn, color }) : fallback(color);
  } catch {
    output = fallback(color);
  }
  stdout.write(`${output}\n`);
  return 0;
}

function render(input, { env, argv, nowMs, spawn, color }) {
  const dataDir = optionValue(argv, '--data');
  const contextHistory = dataDir
    ? recordContext(join(dataDir, 'history'), input.session_id, input.context_window?.used_percentage, { nowMs })
    : [];
  const git = probeGit(workingDirectory(input), { spawn });
  const snapshot = snapshotFromStatusInput(input, { nowMs, git, contextHistory });
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
