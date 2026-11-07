// GitHub workflow commands: a line `::error::message` on stdout makes an annotation on the run
// (https://docs.github.com/en/actions/reference/workflows-and-actions/workflow-commands).

/**
 * One workflow command line. The message is escaped as GitHub's own toolkit escapes it
 * (escapeData in https://github.com/actions/toolkit/blob/main/packages/core/src/command.ts:
 * `%` as %25, CR as %0D, LF as %0A), so text from elsewhere stays on the line and cannot start
 * another command.
 * @param {'error' | 'warning' | 'notice'} level
 * @param {string} message
 */
export function annotation(level, message) {
  const escaped = String(message).replace(/%/g, '%25').replace(/\r/g, '%0D').replace(/\n/g, '%0A');
  return `::${level}::${escaped}`;
}
