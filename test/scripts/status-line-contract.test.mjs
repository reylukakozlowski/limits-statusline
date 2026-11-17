// The contract check, against test/fixtures/status-line-docs.md (a stand-in for Anthropic's status
// line page that documents every field the plugin reads, with the units the page states) and
// against the same page with one change at a time, as Anthropic could make it.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseStatusLineDocs } from '../../scripts/lib/status-line-docs.mjs';
import { checkContract, STATUS_LINE_CONTRACT, UNREAD_FIELDS } from '../../scripts/lib/status-line-contract.mjs';
import { edited, PAGE, rowOf } from '../fixtures/status-line-page.mjs';

const FIVE_HOUR_RESET = '"five_hour": { "used_percentage": 12, "resets_at": 1800015000 }';
const RESETS_ROW = '| `rate_limits.five_hour.resets_at`, `rate_limits.seven_day.resets_at` |';
const HIT_RATIO_ROW = '| `hit_ratio` | Cache reads as a share of all input, from 0 to 1. |';

const check = (page = PAGE, options) => checkContract(parseStatusLineDocs(page), options);

test('the page as it is documents every field the plugin reads as it expects, and nothing new', () => {
  // status-line-contract-drift.test.mjs pins which fields the contract lists.
  assert.deepEqual(check(), {
    ok: true, checked: STATUS_LINE_CONTRACT.length, missing: [], retyped: [], unitChanged: [], newLimitFields: [], newFields: [],
  });
});

test('a field taken off the page breaks the contract, and only that field is named', () => {
  const report = check(edited(
    [FIVE_HOUR_RESET, '"five_hour": { "used_percentage": 12 }'],
    [RESETS_ROW, '| `rate_limits.seven_day.resets_at` |'],
  ));
  assert.equal(report.ok, false);
  assert.deepEqual(report.missing, ['rate_limits.five_hour.resets_at']);
  assert.deepEqual([report.retyped, report.unitChanged], [[], []]);
});

test('a field still in a table counts as documented when the example leaves it out', () => {
  const report = check(edited([FIVE_HOUR_RESET, '"five_hour": { "used_percentage": 12 }']));
  assert.equal(report.ok, true);
  assert.deepEqual(report.missing, []);
});

test('a reset time documented as text instead of a number breaks the contract', () => {
  const report = check(edited([FIVE_HOUR_RESET, '"five_hour": { "used_percentage": 12, "resets_at": "2027-01-15T04:10:00Z" }']));
  assert.equal(report.ok, false);
  assert.deepEqual(report.retyped, [{ path: 'rate_limits.five_hour.resets_at', expected: 'number', documented: 'string' }]);
});

test('reset times in milliseconds instead of seconds break the contract for both windows', () => {
  const report = check(edited(['in Unix epoch seconds |', 'in Unix epoch milliseconds |']));
  assert.equal(report.ok, false);
  const documented = 'When the window resets, in Unix epoch milliseconds';
  assert.deepEqual(report.unitChanged, [
    { path: 'rate_limits.five_hour.resets_at', expected: 'Unix epoch seconds', documented },
    { path: 'rate_limits.seven_day.resets_at', expected: 'Unix epoch seconds', documented },
  ]);
});

// "from 0 to 1" is a prefix of "from 0 to 100": a substring match would miss both changes.
test('a ratio that becomes a percentage, or a percentage that becomes a ratio, breaks the contract', () => {
  const toPercent = check(edited([HIT_RATIO_ROW, '| `hit_ratio` | Cache reads as a share of all input, from 0 to 100. |']));
  assert.deepEqual(toPercent.unitChanged.map((change) => change.path), ['prompt_cache.hit_ratio']);
  const toRatio = check(edited(['is used, from 0 to 100 |', 'is used, from 0 to 1 |']));
  assert.deepEqual(toRatio.unitChanged.map((change) => change.path),
    ['rate_limits.five_hour.used_percentage', 'rate_limits.seven_day.used_percentage']);
  const toDecimal = check(edited([HIT_RATIO_ROW, '| `hit_ratio` | Cache reads, from 0 to 1.5 |']));
  assert.deepEqual(toDecimal.unitChanged.map((change) => change.path), ['prompt_cache.hit_ratio']);
});

// Each unit the contract expects is checked: a unit phrase mistyped in the contract, which the
// real page would never state, shows here as a field whose changed row goes unnoticed.
test('every field with a unit breaks the contract once its row stops stating that unit', () => {
  const withUnit = STATUS_LINE_CONTRACT.filter((entry) => entry.unit);
  assert.equal(withUnit.length, 12);
  for (const { path } of withUnit) {
    const name = path.startsWith('prompt_cache.') ? path.slice('prompt_cache.'.length) : path;
    const row = PAGE.split('\n').find((line) => line.startsWith('| `') && line.includes(`\`${name}\``));
    assert.ok(row, `a row names ${name}`);
    const names = row.slice(0, row.lastIndexOf('|', row.length - 2));
    const report = check(edited([row, `${names}| nothing |`]));
    const sharing = withUnit.filter((entry) => row.includes(`\`${entry.path.replace('prompt_cache.', '')}\``)).map((entry) => entry.path);
    assert.deepEqual(report.unitChanged.map((change) => change.path), sharing, path);
  }
});

test('a field whose row went away has no stated unit any more, which breaks the contract', () => {
  const report = check(edited([`${HIT_RATIO_ROW}\n`, '']));
  assert.deepEqual(report.missing, [], 'the example still has it');
  assert.deepEqual(report.unitChanged, [{ path: 'prompt_cache.hit_ratio', expected: 'from 0 to 1', documented: null }]);
});

test('more words around a unit, or other letter case, keep the contract', () => {
  const report = check(edited(
    ['in Unix epoch seconds |', 'in UNIX Epoch Seconds. Absent once the window resets |'],
    [HIT_RATIO_ROW, '| `hit_ratio` | Cache reads as a share of all input, from 0 to 1. `null` while nothing was read |'],
  ));
  assert.equal(report.ok, true, JSON.stringify(report.unitChanged));
});

test('a newly documented field outside the plan limits is news, never a broken contract', () => {
  const report = check(edited(['"effort": { "level": "high" },', '"effort": { "level": "high" },\n>   "plan": { "name": "ultra" },']));
  assert.equal(report.ok, true);
  assert.deepEqual([report.newFields, report.newLimitFields], [['plan.name'], []]);
});

// Claude Code has limits it does not pass to status lines (a weekly limit of one model, as of
// 2.1.325). The day the page documents one the run has to fail, since a failed run is the only
// notification. The names below are made up: only their place under rate_limits matters.
test('a newly documented plan limit field fails the check, in the example or in a table alone', () => {
  const inExample = check(edited([FIVE_HOUR_RESET, `${FIVE_HOUR_RESET},\n>     "seven_day_fable": { "used_percentage": 5, "resets_at": 1800274200 }`]));
  assert.equal(inExample.ok, false);
  assert.deepEqual(inExample.newLimitFields, ['rate_limits.seven_day_fable.resets_at', 'rate_limits.seven_day_fable.used_percentage']);
  assert.deepEqual([inExample.missing, inExample.retyped, inExample.unitChanged, inExample.newFields], [[], [], [], []]);
  const inTable = check(edited([rowOf('version'), `${rowOf('version')}\n| \`rate_limits.model_scoped\` | Weekly limits of single models |`]));
  assert.equal(inTable.ok, false);
  assert.deepEqual(inTable.newLimitFields, ['rate_limits.model_scoped']);
});

test('a plan limit field the plugin leaves unread on purpose does not fail the check', () => {
  // The fixture documents rate_limits.spend_limit.period, which UNREAD_FIELDS lists.
  assert.equal(check().ok, true);
  assert.deepEqual(check(PAGE, { unread: [] }).newLimitFields, ['rate_limits.spend_limit.period']);
  assert.equal(check(PAGE, { unread: [] }).ok, false);
});

test('a field only a table names is news too, but a row for an object of the example is not', () => {
  const report = check(edited([rowOf('version'), `${rowOf('version')}\n| \`plan.name\` | The subscription's name |`]));
  assert.deepEqual(report.newFields, ['plan.name']);
  // `prompt_cache` and `context_window.current_usage` have rows of their own and leaves in the example.
  assert.ok(parseStatusLineDocs(PAGE).descriptions.has('prompt_cache'));
  assert.deepEqual(check().newFields, []);
});

test('the fields the plugin leaves unread on purpose are what keeps documented ones from being news', () => {
  const { newFields } = check(PAGE, { unread: [] });
  // The fixture's documented fields that the contract does not list, counted by hand.
  assert.deepEqual(newFields, [
    'context_window.current_usage.output_tokens', 'context_window.total_output_tokens', 'prompt_cache.ttl',
    'version', 'workspace.repo.host', 'workspace.repo.owner',
  ]);
});

test('the contract and the unread fields name each field once and never the same one', () => {
  const contract = STATUS_LINE_CONTRACT.map((entry) => entry.path);
  assert.equal(new Set(contract).size, contract.length, 'contract paths are unique');
  assert.equal(new Set(UNREAD_FIELDS).size, UNREAD_FIELDS.length, 'unread paths are unique');
  assert.deepEqual(contract.filter((path) => UNREAD_FIELDS.includes(path)), []);
  assert.deepEqual([...UNREAD_FIELDS], [...UNREAD_FIELDS].sort(), 'unread paths are sorted');
});
