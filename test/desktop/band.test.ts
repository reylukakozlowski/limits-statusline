// Runs under `claude plugin test` (Claude Code ≥ 2.1.299): the mod loaded by the engine itself,
// with the session's figures answered by the test's own hooks, which sit beneath the plugin.
import { expect, test } from 'claude-code/testing'

const NOW = 1_800_000_000_000
const iso = (ms: number) => new Date(ms).toISOString()

const USAGE = {
  startedAt: NOW - 20_400_000,
  context: { tokens: 543_000, window: 1_000_000, percent: 54 },
  rateLimits: [
    { kind: 'five_hour', percentUsed: 12, resetsAt: iso(NOW + 15_000_000) },
    { kind: 'seven_day', percentUsed: 39, resetsAt: iso(NOW + 274_200_000) },
  ],
  cost: { usd: 20.33 },
}

const PROPS = { hasSurvey: false, isWorking: false, maxRows: 8, bodyColumns: 120 } as never

function answerSession(on: any, { processRun }: { processRun?: () => Promise<unknown> } = {}) {
  on('session.usage', async () => ({ value: USAGE }))
  on('session.model', async () => ({ value: 'claude-opus-5-5' }))
  on('session.cwd', async () => ({ value: 'C:/Users/dev/daily-claude' }))
  on('clock.now', async () => ({ value: NOW }))
  on('session.version', async () => ({ value: { version: '2.1.299' } }))
  on('process.run', processRun ?? (async () => ({
    value: { exitCode: 128, stdout: '', stderr: '', isStdoutTruncated: false, isStderrTruncated: false },
  })))
  on('session.measure', async ($: any, e: any) => ({ changed: e.changed }))
  // Stands in for the engine's own band, so a test can tell "passed to the engine" from "drew".
  on('ui.render', { component: 'AbovePrompt' }, ($: any, e: any) => {
    const { Text } = $.ui.resolve(e)
    return h(Text, null, 'engine band')
  })
}

const mount = ($: any, surface: 'desktop' | 'terminal') =>
  $.ui.mount({ plugin: 'limits-statusline', surface, component: 'AbovePrompt', props: PROPS })

test('draws the five lines in the desktop band', async ($, on) => {
  answerSession(on)
  const ui = await mount($, 'desktop')
  expect(await ui.find({ type: 'Text', text: /7d/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /\$20\.33/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /Opus 5\.5/ })).toBeDefined()
  await ui.unmount()
})

test('leaves the terminal to the classic status line by default', async ($, on) => {
  answerSession(on)
  const ui = await mount($, 'terminal')
  expect(await ui.find({ type: 'Text', text: /7d/ })).toBeUndefined()
  expect(await ui.find({ type: 'Text', text: /engine band/ })).toBeDefined()
  await ui.unmount()
})

test('band=all draws in the terminal too', { options: { band: 'all' } }, async ($, on) => {
  answerSession(on)
  const ui = await mount($, 'terminal')
  expect(await ui.find({ type: 'Text', text: /7d/ })).toBeDefined()
  await ui.unmount()
})

test('band=off draws nothing on desktop', { options: { band: 'off' } }, async ($, on) => {
  answerSession(on)
  const ui = await mount($, 'desktop')
  expect(await ui.find({ type: 'Text', text: /7d/ })).toBeUndefined()
  expect(await ui.find({ type: 'Text', text: /engine band/ })).toBeDefined()
  await ui.unmount()
})

test('yields to the engine while a survey is shown', async ($, on) => {
  answerSession(on)
  const ui = await $.ui.mount({
    plugin: 'limits-statusline', surface: 'desktop', component: 'AbovePrompt',
    props: { hasSurvey: true, isWorking: false, maxRows: 8, bodyColumns: 120 } as never,
  })
  expect(await ui.find({ type: 'Text', text: /engine band/ })).toBeDefined()
  await ui.unmount()
})

const measure = ($: any, percent: number) =>
  $.session.measure({ context: { tokens: percent * 10_000, window: 1_000_000, percent }, rateLimits: [], changed: ['context'] })

test('draws the context history as an SVG line in the monospaced face on desktop', async ($, on) => {
  answerSession(on)
  await measure($, 40)
  await measure($, 54)
  const ui = await mount($, 'desktop')
  const chart = await ui.find({ type: 'Svg' })
  expect(chart).toBeDefined()
  expect(String(chart?.props.source)).toContain('<polyline')
  expect((await ui.find({ type: 'Text', text: /543k/ }))).toBeDefined()
  const row = await ui.find({ type: 'Text', text: /\$20\.33/ })
  expect(row?.props.mono).toBe(true)
  await ui.unmount()
})

test('/clear starts the line over, as a new terminal session would', async ($, on) => {
  answerSession(on)
  on('session.end', async ($: any, e: any) => ({ sessionId: e.sessionId }))
  await measure($, 40)
  await measure($, 54)
  await $.session.end({ reason: 'clear', sessionId: 'session-under-test', resume: { id: 'session-under-test' } })
  const ui = await mount($, 'desktop')
  expect(await ui.find({ type: 'Svg' })).toBeUndefined()
  await ui.unmount()
})

test('reads the branch from .git/HEAD when $.process is not available', async ($, on) => {
  answerSession(on, { processRun: async () => { throw new Error('CLI only') } })
  on('session.repo', async () => ({ value: { root: 'C:/Users/dev/daily-claude', remote: null, internal: false, name: null } }))
  on('fs.read', async () => ({ value: 'ref: refs/heads/develop\n' }))
  await measure($, 40)
  const ui = await mount($, 'desktop')
  expect(await ui.find({ type: 'Text', text: /git develop/ })).toBeDefined()
  await ui.unmount()
})
