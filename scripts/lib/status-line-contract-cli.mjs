// The status line contract check as the Compatibility workflow runs it: reads a copy of Anthropic's
// status line page, which the workflow downloads, and reports what the contract found as workflow
// annotations on stdout and as a section of the run's summary.
// Exit codes: 0 the contract holds (newly documented fields only warn), 1 the contract is broken,
// 2 nothing was checked (no page given, the page unreadable, or its layout not recognised).

import { parseArgs } from 'node:util';
import { parseStatusLineDocs, STATUS_LINE_PAGE } from './status-line-docs.mjs';
import { checkContract } from './status-line-contract.mjs';
import { annotation } from './workflow-commands.mjs';

const NAME = 'status line contract';
const USAGE = 'usage: check-status-line-contract.mjs --docs <statusline.md>';

/** @typedef {import('./status-line-contract.mjs').ContractReport} ContractReport */
/**
 * @typedef {{
 *   argv: string[],
 *   readText: (path: string) => string,
 *   writeSummary: ((markdown: string) => void) | null,
 *   stdout: { write(text: string): void },
 * }} Io writeSummary is null outside a workflow run
 */

/**
 * @param {Io} io
 * @returns {0 | 1 | 2}
 */
export function runContractCheck({ argv, readText, writeSummary, stdout }) {
  const say = (text) => stdout.write(`${text}\n`);
  const cannotCheck = (reason) => {
    say(annotation('error', `${NAME}: ${reason}; nothing was checked.`));
    writeSummary?.(`${summaryHeading(false)}${reason}; nothing was checked.\n`);
    return 2;
  };
  const docsPath = docsOption(argv);
  if (docsPath === null) return cannotCheck(USAGE);
  let markdown;
  try {
    markdown = readText(docsPath);
  } catch (error) {
    return cannotCheck(`cannot read ${docsPath} (${error.message})`);
  }
  const documented = parseStatusLineDocs(markdown);
  if (documented === null) {
    return cannotCheck(`the layout of ${STATUS_LINE_PAGE} is not recognised: no "Full JSON schema" example or no field table`);
  }
  const report = checkContract(documented);
  const problems = problemTexts(report);
  for (const problem of problems) say(annotation('error', `${NAME}: ${problem}`));
  if (report.newFields.length > 0) {
    say(annotation('warning', `${NAME}: newly documented fields the plugin does not read: ${report.newFields.join(', ')}.`));
  }
  say(report.ok
    ? `${NAME}: the ${report.checked} fields the plugin reads are documented with the types and units it expects.`
    : `${NAME}: ${problems.length} of the plugin's ${report.checked} fields changed in ${STATUS_LINE_PAGE}; the plugin needs a look.`);
  writeSummary?.(summaryMarkdown(report, problems));
  return report.ok ? 0 : 1;
}

const summaryHeading = (ok) => `### ${ok ? '✅' : '❌'} Status line contract\n\n`;

function summaryMarkdown(report, problems) {
  const parts = [`${summaryHeading(report.ok)}${report.checked} fields the plugin reads, checked against ${STATUS_LINE_PAGE}.\n`];
  if (problems.length > 0) parts.push(`\n${problems.map((problem) => `- ${problem}`).join('\n')}\n`);
  if (report.newFields.length > 0) {
    parts.push(`\nNewly documented, not read by the plugin:\n\n${report.newFields.map((path) => `- \`${path}\``).join('\n')}\n`);
  }
  return parts.join('');
}

function problemTexts({ missing, retyped, unitChanged }) {
  return [
    ...missing.map((path) => `${path} is no longer documented`),
    ...retyped.map(({ path, expected, documented }) => `${path} is documented as ${documented}, not ${expected}`),
    ...unitChanged.map(({ path, expected, documented }) => (documented === null
      ? `${path} has no description that says "${expected}"`
      : `${path} no longer says "${expected}": "${documented}"`)),
  ];
}

function docsOption(argv) {
  try {
    const { values } = parseArgs({ args: argv, options: { docs: { type: 'string' } }, strict: true });
    return typeof values.docs === 'string' && values.docs !== '' ? values.docs : null;
  } catch {
    return null;
  }
}
