// The plugin's code makes no network request: Anthropic's directory is told so
// (docs/directory-submission.md, Data handling), and the Compatibility workflow keeps its own
// downloads in the workflow file. This scans every tracked code file under src, scripts and hooks
// for the ways Node.js reaches the network.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const SHIPPED_CODE = /^(src|scripts|hooks)\/.+\.(mjs|js|ts)$/;
const NETWORK = [
  /\bfetch\s*\(/,
  /['"](?:node:)?(?:http|https|http2|net|tls|dgram|dns)['"]/,
  /\b(?:XMLHttpRequest|WebSocket|EventSource)\b/,
];

const shippedCode = () => spawnSync('git', ['ls-files', '--cached', '--others', '--exclude-standard'], { cwd: ROOT, encoding: 'utf8' })
  .stdout.split('\n').filter((file) => SHIPPED_CODE.test(file));

/** The patterns of NETWORK that `code` matches. */
const networkUses = (code) => NETWORK.filter((pattern) => pattern.test(code)).map(String);

test('networkUses finds each way to the network and passes code that has none', () => {
  for (const code of ["await fetch('https://example.com')", "import https from 'node:https';", "import { request } from 'http';",
    "const net = require('node:net');", 'new WebSocket(url)']) {
    assert.equal(networkUses(code).length, 1, code);
  }
  for (const code of ["spawnSync('git', ['status'])", "import { readFileSync } from 'node:fs';", 'const prefetch = 1;',
    "const url = 'https://code.claude.com/docs/en/statusline.md';"]) {
    assert.deepEqual(networkUses(code), [], code);
  }
});

test('no code file of the plugin reaches the network', () => {
  const files = shippedCode();
  assert.ok(files.includes('src/terminal/run.mjs') && files.includes('hooks/register.mjs'), 'the code files are listed');
  const offenders = files.filter((file) => networkUses(readFileSync(join(ROOT, file), 'utf8')).length > 0);
  assert.deepEqual(offenders, []);
});
