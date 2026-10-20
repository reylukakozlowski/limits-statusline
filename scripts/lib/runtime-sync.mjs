// Keeps a copy of the terminal runtime in the plugin's data folder. ${CLAUDE_PLUGIN_ROOT}
// changes with every plugin update, but the statusLine command in settings.json must not.

import fs from 'node:fs';
import { join } from 'node:path';

const RUNTIME_PARTS = Object.freeze([['src', 'core'], ['src', 'terminal']]);

/** Written by setup into the data folder: from then on the SessionStart hook keeps the runtime. */
export const SETUP_MARKER = 'setup.json';

// Windows refuses to rename a folder for a moment while a scanner or the indexer holds a
// freshly written file in it; a few short waits get past that.
const TRANSIENT = new Set(['EPERM', 'EBUSY', 'EACCES']);
const RENAME_ATTEMPTS = 5;
const RENAME_WAIT_MS = 50;

/** @param {string} pluginRoot @returns {string} */
export function readPluginVersion(pluginRoot) {
  return JSON.parse(fs.readFileSync(join(pluginRoot, '.claude-plugin', 'plugin.json'), 'utf8')).version;
}

/** @param {string} dataDir */
export const runtimeDir = (dataDir) => join(dataDir, 'runtime');

/** @param {string} dataDir */
export const runtimeMainPath = (dataDir) => join(runtimeDir(dataDir), 'src', 'terminal', 'main.mjs');

/**
 * Copies src/core and src/terminal into <dataDir>/runtime unless that copy already has `version`.
 * The new copy is built aside and swapped in; if the swap fails the old runtime is put back.
 * @param {{ pluginRoot: string, dataDir: string, version: string, rename?: typeof fs.renameSync }} options
 * @returns {{ copied: boolean }}
 */
export function syncRuntime({ pluginRoot, dataDir, version, rename = fs.renameSync }) {
  const target = runtimeDir(dataDir);
  const versionFile = join(target, 'VERSION');
  if (fs.existsSync(versionFile) && fs.readFileSync(versionFile, 'utf8') === version) return { copied: false };

  const staging = join(dataDir, `runtime.staging-${process.pid}`);
  const retired = join(dataDir, `runtime.old-${process.pid}`);
  fs.rmSync(staging, { recursive: true, force: true });
  for (const part of RUNTIME_PARTS) {
    fs.cpSync(join(pluginRoot, ...part), join(staging, ...part), { recursive: true });
  }
  fs.writeFileSync(join(staging, 'VERSION'), version);

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
  return syncRuntime({ pluginRoot, dataDir, version: readPluginVersion(pluginRoot) });
}
