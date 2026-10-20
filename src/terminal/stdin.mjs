// Reading the status-line JSON that Claude Code pipes in.

export const STDIN_TIMEOUT_MS = 1500;

/**
 * Resolves with everything the stream delivered, or with what arrived before the timeout.
 * Never rejects: a broken stream is just less text.
 * @param {NodeJS.ReadableStream} stream
 * @param {{ timeoutMs?: number }} [options]
 * @returns {Promise<string>}
 */
export function readStdin(stream, { timeoutMs = STDIN_TIMEOUT_MS } = {}) {
  return new Promise((resolve) => {
    let text = '';
    let isSettled = false;
    const finish = () => {
      if (isSettled) return;
      isSettled = true;
      clearTimeout(timer);
      stream.pause?.();
      resolve(text);
    };
    const timer = setTimeout(finish, timeoutMs);
    stream.setEncoding?.('utf8');
    stream.on('data', (chunk) => { text += chunk; });
    stream.once('end', finish);
    stream.once('error', finish);
  });
}

/**
 * @param {unknown} text
 * @returns {Record<string, unknown> | null} the JSON object, or null for anything else
 */
export function parseInput(text) {
  if (typeof text !== 'string') return null;
  try {
    const value = JSON.parse(text.replace(/^\uFEFF/, ''));
    return value !== null && typeof value === 'object' && !Array.isArray(value) ? value : null;
  } catch {
    return null;
  }
}
