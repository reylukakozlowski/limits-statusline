// The SessionStart hook as Claude Code runs it: the command from hooks/hooks.json, with
// ${CLAUDE_PLUGIN_ROOT} put in, through `sh -c` (macOS and Linux; Git Bash on Windows) and through
// PowerShell 7 and Windows PowerShell (Windows without Git Bash). A failing SessionStart hook shows a "hook error" notice at
// every session start, so the hook must end with exit 0 even where Node.js is not installed: the
// desktop band needs no Node.js, and the status line it keeps cannot run without it anyway.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { SETUP_MARKER, runtimeMainPath } from '../../scripts/lib/runtime-sync.mjs';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const HOOKS = JSON.parse(readFileSync(new URL('../../hooks/hooks.json', import.meta.url), 'utf8'));
const [{ hooks: [HOOK] }] = HOOKS.hooks.SessionStart;
// Forward slashes, as a shell on Windows needs them and Node.js accepts them everywhere.
const COMMAND = HOOK.command.replaceAll('${CLAUDE_PLUGIN_ROOT}', ROOT.replace(/\\/g, '/').replace(/\/$/, ''));

const works = (command, args) => {
  const probe = spawnSync(command, args, { encoding: 'utf8' });
  return !probe.error && probe.status === 0;
};
// Claude Code runs a hook in PowerShell 7 (pwsh) when it is installed, else in Windows PowerShell.
const noPowerShell = (executable) => (process.platform !== 'win32' || !works(executable, ['-NoProfile', '-Command', 'exit 0']))
  && `${executable} runs hooks only on Windows, where it is installed`;
const SKIPS = {
  sh: !works('sh', ['-c', 'exit 0']) && 'no POSIX sh on PATH',
  pwsh: noPowerShell('pwsh'),
  powershell: noPowerShell('powershell'),
};

const inPowerShell = (executable) => (command, { withoutNode }) => [executable, [
  '-NoProfile', '-NonInteractive', '-Command', withoutNode ? `$env:PATH = 'C:\\no-such-folder'; ${command}` : command,
]];
// Each shell's way to run the hook with node or with a PATH that has no node on it.
const SHELLS = {
  sh: (command, { withoutNode }) => ['sh', ['-c', withoutNode ? `PATH=/no-such-folder; ${command}` : command]],
  pwsh: inPowerShell('pwsh'),
  powershell: inPowerShell('powershell'),
};

/** A data folder, with setup's marker when `isSetUp`. */
function dataFolder(t, { isSetUp }) {
  const dir = mkdtempSync(join(tmpdir(), 'ls-hook-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  if (isSetUp) {
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, SETUP_MARKER), '{}\n');
  }
  return dir;
}

function runHook(shell, dataDir, { withoutNode = false } = {}) {
  const [command, args] = SHELLS[shell](COMMAND, { withoutNode });
  const result = spawnSync(command, args, {
    encoding: 'utf8',
    env: { ...process.env, CLAUDE_PLUGIN_ROOT: ROOT, CLAUDE_PLUGIN_DATA: dataDir },
  });
  return { status: result.status, stdout: result.stdout };
}

test('the hook runs the runtime sync through ${CLAUDE_PLUGIN_ROOT} and ends with exit 0', () => {
  assert.equal(HOOK.type, 'command');
  assert.equal(HOOK.command, 'node "${CLAUDE_PLUGIN_ROOT}/scripts/sync-runtime.mjs"; exit 0');
  assert.equal('args' in HOOK, false, 'shell form: the shell, not Claude Code, reports a missing node');
});

for (const [shell, skip] of Object.entries(SKIPS)) {
  test(`${shell}: after setup the hook rebuilds a missing runtime and prints nothing into the session`, { skip }, (t) => {
    const data = dataFolder(t, { isSetUp: true });
    const run = runHook(shell, data);
    assert.equal(run.status, 0);
    assert.equal(run.stdout, '');
    assert.ok(existsSync(runtimeMainPath(data)));
  });

  test(`${shell}: before setup the hook leaves the data folder as it is`, { skip }, (t) => {
    const data = dataFolder(t, { isSetUp: false });
    const run = runHook(shell, data);
    assert.equal(run.status, 0);
    assert.equal(run.stdout, '');
    assert.equal(existsSync(runtimeMainPath(data)), false);
  });

  test(`${shell}: without Node.js the hook still exits 0, prints nothing and changes nothing`, { skip }, (t) => {
    const data = dataFolder(t, { isSetUp: true });
    const run = runHook(shell, data, { withoutNode: true });
    assert.equal(run.status, 0);
    assert.equal(run.stdout, '');
    assert.equal(existsSync(runtimeMainPath(data)), false);
  });
}
