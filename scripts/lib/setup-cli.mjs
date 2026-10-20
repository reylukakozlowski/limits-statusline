// /limits-statusline:setup — enables (or with --uninstall removes) the terminal status line.
// Exit codes: 0 done or nothing to do, 1 usage error, 2 refused without writing anything.
//
// Where things live:
//   <config>/settings.json                    the statusLine entry (config = CLAUDE_CONFIG_DIR or ~/.claude)
//   <config>/limits-statusline/               previous status line + settings backup, and the plan limit
//                                             history the status line and the band share; outlives the
//                                             plugin, whose data folder `/plugin uninstall` deletes
//   <data>/runtime, <data>/setup.json         the runtime copy the command runs, and the hook's marker

import fs from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { parseArgs } from 'node:util';
import { writeFileAtomic } from './fs-atomic.mjs';
import { SETUP_MARKER, readPluginVersion, runtimeDir, runtimeMainPath, syncRuntime } from './runtime-sync.mjs';
import { buildStatusLineCommand, planInstall, planUninstall } from './settings-plan.mjs';

const NAME = 'limits-statusline';
const PLUGIN_DATA_ID = 'limits-statusline-sealoop';
const PREVIOUS_FILE = 'previous-statusline.json';
const BACKUP_FILE = 'settings.backup.json';
const BYTE_ORDER_MARK = /^\uFEFF/;

class Refusal extends Error {}

/**
 * @param {{
 *   argv: string[], pluginRoot: string, env?: Record<string, string | undefined>,
 *   stdout: { write(text: string): void }, stderr: { write(text: string): void },
 * }} io
 * @returns {number} exit code
 */
export function runSetup({ argv, pluginRoot, env = process.env, stdout, stderr }) {
  let options;
  try {
    options = parseOptions(argv, env);
  } catch (error) {
    stderr.write(`${NAME}: ${error.message}\nUsage: setup.mjs [--data <dir>] [--settings <file>] [--uninstall] [--dry-run]\n`);
    return 1;
  }
  try {
    const say = (text) => stdout.write(`${text}\n`);
    if (options.uninstall) uninstall(options, say);
    else install({ ...options, pluginRoot }, say);
    return 0;
  } catch (error) {
    if (!(error instanceof Refusal)) throw error;
    stderr.write(`${NAME}: ${error.message}\n`);
    return 2;
  }
}

function parseOptions(argv, env) {
  const { values } = parseArgs({
    args: argv,
    options: {
      data: { type: 'string' },
      settings: { type: 'string' },
      uninstall: { type: 'boolean', default: false },
      'dry-run': { type: 'boolean', default: false },
    },
    strict: true,
    allowPositionals: false,
  });
  const configDir = env.CLAUDE_CONFIG_DIR || join(homedir(), '.claude');
  return {
    // A ${CLAUDE_PLUGIN_DATA} the command body did not substitute reaches us literally, or
    // empty once a shell expanded it; either way the plugin's usual data folder is used.
    dataDir: isUsablePath(values.data) ? values.data : join(configDir, 'plugins', 'data', PLUGIN_DATA_ID),
    settingsPath: values.settings ?? join(configDir, 'settings.json'),
    stateDir: join(configDir, NAME),
    uninstall: values.uninstall,
    isDryRun: values['dry-run'],
  };
}

const isUsablePath = (value) => typeof value === 'string' && value.trim() !== '' && !value.includes('${');

function install({ dataDir, settingsPath, stateDir, isDryRun, pluginRoot }, say) {
  const { settings, text, writePath } = readSettings(settingsPath);
  const command = commandFor(dataDir);
  const plan = planInstall(settings, { command });
  if (isDryRun) {
    say(`${NAME} (dry run): would ${plan.changed ? 'set' : 'keep'} statusLine.command = ${command}`);
    if (plan.previous) say(`  and save the current status line (${plan.previous.command}) for --uninstall`);
    say('  Nothing was written.');
    return;
  }
  const version = readPluginVersion(pluginRoot);
  const { copied } = syncRuntime({ pluginRoot, dataDir, version });
  writeFileAtomic(join(dataDir, SETUP_MARKER), `${JSON.stringify({ version, settingsPath }, null, 2)}\n`);
  if (!plan.changed) {
    say(alreadyEnabledMessage(copied, dataDir));
    return;
  }
  // The status line in place now is the one to bring back, even if an older one was saved.
  if (plan.previous) writeFileAtomic(join(stateDir, PREVIOUS_FILE), `${JSON.stringify(plan.previous, null, 2)}\n`);
  writeSettings(writePath, text, plan.settings, stateDir);
  say(`${NAME}: status line enabled in ${settingsPath}`);
  say(`  command: ${command}`);
  if (plan.previous) say('  your previous status line is saved and comes back with --uninstall');
  say(`  before uninstalling the plugin, run /${NAME}:setup --uninstall`);
}

// A missing or outdated runtime is rebuilt even when settings.json needs no change: that is the
// repair after the plugin's data folder was deleted, so the message has to admit to it.
const alreadyEnabledMessage = (isRuntimeCopied, dataDir) => (isRuntimeCopied
  ? `${NAME}: the status line is already enabled; its runtime was rebuilt in ${runtimeDir(dataDir)}`
  : `${NAME}: the status line is already enabled; nothing changed.`);

function uninstall({ settingsPath, stateDir, isDryRun }, say) {
  const { settings, text, writePath } = readSettings(settingsPath);
  const previousPath = join(stateDir, PREVIOUS_FILE);
  const previous = readJsonOrNull(previousPath);
  const plan = planUninstall(settings, { previous });
  if (!plan.changed) {
    say(`${NAME}: this plugin's status line is not active; nothing changed.`);
    return;
  }
  if (isDryRun) {
    say(`${NAME} (dry run): would ${previous ? 'restore the previous status line' : 'remove statusLine'}. Nothing was written.`);
    return;
  }
  writeSettings(writePath, text, plan.settings, stateDir);
  fs.rmSync(previousPath, { force: true });
  say(`${NAME}: ${previous ? 'previous status line restored' : 'status line removed'} in ${settingsPath}`);
}

function commandFor(dataDir) {
  try {
    return buildStatusLineCommand({ mainPath: runtimeMainPath(dataDir), dataDir });
  } catch (error) {
    throw new Refusal(`${error.message}. Configure statusLine by hand instead.`);
  }
}

/** @returns {{ settings: Record<string, unknown>, text: string | null, writePath: string }} */
function readSettings(path) {
  if (!fs.existsSync(path)) return { settings: {}, text: null, writePath: path };
  const text = fs.readFileSync(path, 'utf8');
  let settings;
  try {
    settings = JSON.parse(text.replace(BYTE_ORDER_MARK, ''));
  } catch {
    throw new Refusal(`${path} is not valid JSON; nothing was changed. Fix the file and run setup again.`);
  }
  if (settings === null || typeof settings !== 'object' || Array.isArray(settings)) {
    throw new Refusal(`${path} must hold a JSON object; nothing was changed.`);
  }
  // Write through a symlinked settings.json (dotfiles) instead of replacing the link.
  return { settings, text, writePath: fs.realpathSync(path) };
}

function writeSettings(path, originalText, settings, stateDir) {
  if (originalText !== null) writeFileAtomic(join(stateDir, BACKUP_FILE), originalText);
  writeFileAtomic(path, `${JSON.stringify(settings, null, 2)}\n`);
}

function readJsonOrNull(path) {
  try {
    return JSON.parse(fs.readFileSync(path, 'utf8'));
  } catch {
    return null;
  }
}
