// Entry point for the `statusLine` command: node main.mjs [--data <dir>]
import { run } from './run.mjs';

process.exitCode = await run({
  stdin: process.stdin,
  stdout: process.stdout,
  env: process.env,
  argv: process.argv.slice(2),
  nowMs: Date.now(),
});
