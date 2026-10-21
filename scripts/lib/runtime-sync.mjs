// Keeps a copy of the terminal runtime in the plugin's data folder. ${CLAUDE_PLUGIN_ROOT}
// changes with every plugin update, but the statusLine command in settings.json must not.

import { createHash } from 'node:crypto';
import fs from 'node:fs';
import { join, relative } from 'node:path';

const RUNTIME_PARTS = Object.freeze([['src', 'core'], ['src', 'terminal']]);
const FINGERPRINT_FILE = 'FINGERPRINT';

/** Written by setup into the data folder: from then on the SessionStart hook keeps the runtime. */
export const SETUP_MARKER = 'setup.json';

// Windows refuses to rename a folder for a moment while a scanner or the indexer holds a
// freshly written file in it; a few short waits get past that.
const TRANSIENT = new Set(['EPERM', 'EBUSY', 'EACCES']);
const RENAME_ATTEMPTS = 5;
const RENAME_WAIT_MS = 50;

/**
 * Names the runtime sources by their content: the manifests carry no version (a release is only
 * its tag), so the files themselves tell one runtime from another.
 * @param {string} pluginRoot
 * @returns {string} 16 hex digits
 */
export function runtimeFingerprint(pluginRoot) {
  const hash = createHash('sha256');
  for (const part of RUNTIME_PARTS) {
    for (const file of filesUnder(join(pluginRoot, ...part)).sort()) {
      const name = relative(pluginRoot, file).replaceAll('\\', '/');
      hash.update(`${name}\0`).update(fs.readFileSync(file)).update('\0');
    }
  }
  return hash.digest('hex').slice(0, 16);
}

/** Every file below `dir`; a walk of its own, since readdir's `recursive` needs Node 20.1. */
function filesUnder(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return filesUnder(path);
    return entry.isFile() ? [path] : [];
  });
}

/** @param {string} dataDir */
export const runtimeDir = (dataDir) => join(dataDir, 'runtime');

/** @param {string} dataDir */
export const runtimeMainPath = (dataDir) => join(runtimeDir(dataDir), 'src', 'terminal', 'main.mjs');

/**
 * Copies src/core and src/terminal into <dataDir>/runtime unless that copy already has
 * `fingerprint`. The new copy is built aside and swapped in; if the swap fails the old runtime is
 * put back.
 * @param {{ pluginRoot: string, dataDir: string, fingerprint?: string, rename?: typeof fs.renameSync }} options
 * @returns {{ copied: boolean }}
 */
export function syncRuntime({ pluginRoot, dataDir, fingerprint = runtimeFingerprint(pluginRoot), rename = fs.renameSync }) {
  const target = runtimeDir(dataDir);
  const fingerprintFile = join(target, FINGERPRINT_FILE);
  if (fs.existsSync(fingerprintFile) && fs.readFileSync(fingerprintFile, 'utf8') === fingerprint) return { copied: false };

  const staging = join(dataDir, `runtime.staging-${process.pid}`);
  const retired = join(dataDir, `runtime.old-${process.pid}`);
  fs.rmSync(staging, { recursive: true, force: true });
  for (const part of RUNTIME_PARTS) {
    fs.cpSync(join(pluginRoot, ...part), join(staging, ...part), { recursive: true });
  }
  fs.writeFileSync(join(staging, FINGERPRINT_FILE), fingerprint);

  const hadRuntime = fs.existsSync(target);
  try {
    if (hadRuntime) renamePatiently(rename, target, retired);
    try {
      renamePatiently(rename, staging, target);
    } catch (error) {
      if (hadRuntime) renamePatiently(rename, retired, target);
      throw error;
    }
  } finally {
    fs.rmSync(staging, { recursive: true, force: true });
    fs.rmSync(retired, { recursive: true, force: true });
  }
  return { copied: true };
}

function renamePatiently(rename, from, to) {
  for (let attempt = 1; ; attempt += 1) {
    try {
      rename(from, to);
      return;
    } catch (error) {
      if (!TRANSIENT.has(error.code) || attempt === RENAME_ATTEMPTS) throw error;
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, RENAME_WAIT_MS * attempt);
    }
  }
}

/**
 * The SessionStart hook's job: after setup has run, keep the runtime current across plugin
 * updates and rebuild it if it went missing. Before setup there is nothing to keep.
 * @param {Record<string, string | undefined>} env
 * @returns {{ copied: boolean } | null}
 */
export function syncFromHookEnv(env) {
  const { CLAUDE_PLUGIN_ROOT: pluginRoot, CLAUDE_PLUGIN_DATA: dataDir } = env;
  if (!pluginRoot || !dataDir || !fs.existsSync(join(dataDir, SETUP_MARKER))) return null;
  return syncRuntime({ pluginRoot, dataDir });
}
