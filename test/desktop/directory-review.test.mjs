// What Anthropic's directory reads from the band's source, and what the README says about it.
// The directory lists a mod's hooks and calls on `$`, holds a version for a reviewer when the mod
// runs a program, reads files or the conversation and could send them out, or writes a file, and
// asks the README to say what the mod runs, writes and sends. These tests keep the source and the
// README saying the same thing: a new hook or call on `$` fails here until README.md ("Privacy"),
// PRIVACY.md and docs/directory-submission.md describe it.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { GIT_STATUS_ARGS } from '../../src/core/git-status.mjs';
import { limitHistoryPath } from '../../src/core/paths.mjs';

const read = (path) => readFileSync(new URL(`../../${path}`, import.meta.url), 'utf8');
const withoutComments = (source) => source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
const BAND = withoutComments(read('src/desktop/band.mjs'));

const DISCLOSED_HOOKS = ['session.end', 'session.measure', 'session.start', 'turn.complete', 'turn.step', 'ui.render'];
const DISCLOSED_CALLS = [
  'clock.every', 'clock.now', 'env.get', 'fs.exists', 'fs.read', 'fs.write', 'process.run', 'session.cwd', 'session.id',
  'session.model', 'session.repo', 'session.usage', 'session.version', 'settings.read', 'ui.invalidate', 'ui.resolve',
];
const GIT_COMMAND = ['git', ...GIT_STATUS_ARGS];
const GIT_OPTIONS = { timeoutMs: 1500 };

/**
 * The arguments of each call of `callee` in `source`, as source text split at the top level.
 * @returns {string[][]}
 */
function callsOf(source, callee) {
  const calls = [];
  for (let at = source.indexOf(`${callee}(`); at !== -1; at = source.indexOf(`${callee}(`, at + 1)) {
    const args = [];
    let start = at + callee.length + 1;
    let depth = 0;
    let quote = null;
    for (let i = start; i < source.length; i += 1) {
      const char = source[i];
      if (quote) {
        if (char === '\\') i += 1;
        else if (char === quote) quote = null;
      } else if (`'"\``.includes(char)) quote = char;
      else if ('([{'.includes(char)) depth += 1;
      else if (')]}'.includes(char) && depth > 0) depth -= 1;
      else if ((char === ',' || char === ')') && depth === 0) {
        args.push(source.slice(start, i).trim());
        start = i + 1;
        if (char === ')') break;
      }
    }
    calls.push(args.filter(Boolean));
  }
  return calls;
}

/** Whether JavaScript source is a value written out alone: strings, numbers, arrays, plain keys. */
function isFixedText(source) {
  const withoutStrings = source.replace(/'(?:[^'\\]|\\.)*'|"(?:[^"\\]|\\.)*"/g, "''");
  const withoutKeys = withoutStrings.replace(/[A-Za-z_$][\w$]*\s*:/g, ':');
  return /^[\s[\]{},:'\d_.-]*$/.test(withoutKeys);
}

// Only after isFixedText said yes: the source is then literals alone.
const valueOf = (source) => Function(`"use strict"; return (${source});`)();

test('isFixedText takes literals alone and refuses names, spreads, calls and templates', () => {
  assert.equal(isFixedText(`['git', 'status'], { timeoutMs: 1_500, env: { GIT_OPTIONAL_LOCKS: '0' } }`), true);
  assert.equal(isFixedText(`"a,b"`), true);
  for (const computed of [`['git', command]`, `[...ARGS]`, `{ timeoutMs: TIMEOUT }`, `{ ...options }`, '`${dir}/x`', `args()`, `a ? 'x' : 'y'`]) {
    assert.equal(isFixedText(computed), false, computed);
  }
});

test('callsOf splits arguments at the top level only, past strings, brackets and templates', () => {
  const source = "x($.f('a,b', [1, 2], { k: ')' }), `${y(1, 2)}`); $.f(z)";
  assert.deepEqual(callsOf(source, '$.f'), [["'a,b'", '[1, 2]', "{ k: ')' }"], ['z']]);
  assert.deepEqual(callsOf('no call here', '$.f'), []);
});

test('the band hooks and calls on $ only what the README discloses', () => {
  const hooks = new Set([...BAND.matchAll(/\bon\('([\w.]+)'/g)].map((match) => match[1]));
  const calls = new Set([...BAND.matchAll(/\$\.(\w+)\.(\w+)\(/g)].map((match) => `${match[1]}.${match[2]}`));
  assert.deepEqual([...hooks].sort(), DISCLOSED_HOOKS);
  assert.deepEqual([...calls].sort(), DISCLOSED_CALLS);
});

test('the one program the band runs is written out whole, options too: the terminal\'s git status', () => {
  const runs = callsOf(BAND, '$.process.run');
  assert.equal(runs.length, 1, 'one $.process.run call');
  const [argv, options] = runs[0];
  assert.ok(isFixedText(argv) && isFixedText(options), `fixed text: ${runs[0].join(', ')}`);
  assert.deepEqual(valueOf(argv), GIT_COMMAND);
  assert.deepEqual(valueOf(options), GIT_OPTIONS);
});

test('the one file the band writes is named in the call: the history file the terminal keeps', () => {
  const writes = callsOf(BAND, '$.fs.write');
  assert.equal(writes.length, 1, 'one $.fs.write call');
  const path = writes[0][0].match(/^`\$\{(\w+)\}(\/[^`$]+)`$/);
  assert.ok(path, `a folder and a fixed file name: ${writes[0][0]}`);
  assert.equal(`/config${path[2]}`, limitHistoryPath('/config'));
});

test('the README and the privacy statement name the command, the file and every variable the band reads', () => {
  const readme = read('README.md');
  const privacy = read('PRIVACY.md');
  assert.ok(readme.includes(`\`${GIT_COMMAND.join(' ')}\``), 'README names the git command');
  assert.ok(readme.includes('`--no-optional-locks`'), 'README says what keeps git off the index lock');
  assert.ok(readme.includes('limits-statusline/limit-history.json'), 'README names the file');
  assert.ok(readme.includes('`turn.step`'), 'README says what the band reads at each model request');
  const variables = callsOf(BAND, '$.env.get').map(([name]) => valueOf(name));
  assert.ok(variables.length > 0);
  for (const name of variables) {
    assert.ok(readme.includes(`\`${name}\``) && privacy.includes(`\`${name}\``), `${name} is named in README.md and PRIVACY.md`);
  }
});
