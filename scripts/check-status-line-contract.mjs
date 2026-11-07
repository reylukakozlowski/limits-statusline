// Entry point: node scripts/check-status-line-contract.mjs, run by the Compatibility workflow on
// the copy of the status line page it downloaded. From a clone, on a copy of the page:
//   node scripts/check-status-line-contract.mjs --docs statusline.md
// In a workflow run it also appends to the run's summary (GITHUB_STEP_SUMMARY).
import { appendFileSync, readFileSync } from 'node:fs';
import { runContractCheck } from './lib/status-line-contract-cli.mjs';

const summaryPath = process.env.GITHUB_STEP_SUMMARY;

process.exitCode = runContractCheck({
  argv: process.argv.slice(2),
  readText: (path) => readFileSync(path, 'utf8'),
  writeSummary: summaryPath ? (markdown) => appendFileSync(summaryPath, markdown) : null,
  stdout: process.stdout,
});
