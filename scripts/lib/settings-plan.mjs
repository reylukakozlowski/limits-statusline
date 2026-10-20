// Pure decisions about the user's settings.json: what to write on install and on uninstall.
// No I/O here, so every branch is a unit test.

// Every command setup writes runs this file from the plugin's runtime copy.
export const MARKER = 'runtime/src/terminal/main.mjs';
export const REFRESH_INTERVAL_SECONDS = 60;

// Characters that Git Bash and PowerShell both reinterpret inside double quotes.
const UNQUOTABLE = /["$`]/;

const toForwardSlashes = (path) => path.replace(/\\/g, '/');

function quote(path) {
  if (UNQUOTABLE.test(path)) throw new Error(`Path cannot be quoted safely for the status line command: ${path}`);
  return `"${toForwardSlashes(path)}"`;
}

/**
 * The `statusLine.command` string. Forward slashes, because on Windows Claude Code runs it
 * through Git Bash, which would eat backslashes.
 * @param {{ mainPath: string, dataDir: string }} paths
 */
export function buildStatusLineCommand({ mainPath, dataDir }) {
  return `node ${quote(mainPath)} --data ${quote(dataDir)}`;
}

/** @param {unknown} statusLine */
export function isOwnStatusLine(statusLine) {
  return typeof statusLine?.command === 'string' && statusLine.command.includes(MARKER);
}

const sameStatusLine = (a, b) => JSON.stringify(a) === JSON.stringify(b);

/**
 * @param {Record<string, unknown>} settings parsed settings.json (not mutated)
 * @param {{ command: string, refreshInterval?: number }} options
 * @returns {{ settings: Record<string, unknown>, previous: object | null, changed: boolean }}
 */
export function planInstall(settings, { command, refreshInterval = REFRESH_INTERVAL_SECONDS }) {
  const current = settings.statusLine;
  const desired = { type: 'command', command, padding: 0, refreshInterval };
  return {
    settings: { ...settings, statusLine: desired },
    previous: current && !isOwnStatusLine(current) ? current : null,
    changed: !sameStatusLine(current, desired),
  };
}

/**
 * Removes this plugin's status line, putting back the one it replaced. A status line that is
 * not ours is never touched.
 * @param {Record<string, unknown>} settings
 * @param {{ previous: object | null }} options
 * @returns {{ settings: Record<string, unknown>, changed: boolean }}
 */
export function planUninstall(settings, { previous }) {
  if (!isOwnStatusLine(settings.statusLine)) return { settings, changed: false };
  const { statusLine: _removed, ...rest } = settings;
  return { settings: previous ? { ...rest, statusLine: previous } : rest, changed: true };
}
