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

const HISTORY_FILE = 'C:/Users/dev/.claude/limits-statusline/limit-history.json'

// The shared limit history lives in `files`, never in the real configuration folder. The engine
// hands hooks platform paths (backslashes on Windows), so files are keyed with forward slashes.
const fileKey = (path: string) => path.replace(/\\/g, '/')
const failing = async () => { throw new Error('denied') }

type Answers = {
  processRun?: ($: any, e: any) => Promise<unknown>, files?: Record<string, string>, folders?: string[], cwd?: string,
  asked?: string[], refuse?: boolean, writeFails?: boolean,
}

function answerSession(on: any, {
  processRun, files = {}, folders = [], cwd = 'C:/Users/dev/daily-claude', asked = [], refuse = false, writeFails = false,
}: Answers = {}) {
  on('session.usage', async () => ({ value: USAGE }))
  on('session.model', async () => ({ value: 'claude-opus-5-5' }))
  on('session.cwd', async () => ({ value: cwd }))
  on('session.id', async () => ({ value: 'session-under-test' }))
  on('clock.now', async () => ({ value: NOW }))
  on('session.version', async () => ({ value: { version: '2.1.299' } }))
  on('env.get', refuse ? failing : async ($: any, e: any) => ({ value: e.name === 'USERPROFILE' ? 'C:/Users/dev' : undefined }))
  on('settings.read', refuse ? failing : async () => ({ value: {} }))
  on('fs.exists', refuse ? failing : async ($: any, e: any) => {
    const path = fileKey(e.path)
    asked.push(path)
    return { value: Object.hasOwn(files, path) || folders.includes(path) }
  })
  on('fs.write', writeFails ? failing : async ($: any, e: any) => {
    files[fileKey(e.path)] = e.text
    return { value: undefined }
  })
  on('process.run', processRun ?? (async () => ({
    value: { exitCode: 128, stdout: '', stderr: '', isStdoutTruncated: false, isStderrTruncated: false },
  })))
  on('session.measure', async ($: any, e: any) => ({ changed: e.changed }))
  on('turn.complete', async ($: any, e: any) => ({ text: e.answer, usage: e.usage }))
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

// Where `git` cannot run, the branch comes from `files` and `folders` alone: a missing file and a
// folder both refuse to be read, as they do on disk. The engine's repository root is the main
// working tree's, a worktree's too.
const MAIN_TREE = 'C:/Users/dev/daily-claude'
const WORKTREE = `${MAIN_TREE}/.claude/worktrees/feature`

type Disk = { files: Record<string, string>, folders?: string[], cwd: string, asked?: string[], repo?: boolean }

function answerWithoutGit(on: any, { files, folders = [], cwd, asked = [], repo = true }: Disk) {
  answerSession(on, { files, folders, cwd, asked, processRun: async () => { throw new Error('CLI only') } })
  on('session.repo', async () => ({ value: repo ? { root: MAIN_TREE, remote: null, internal: false, name: null } : null }))
  on('fs.read', async ($: any, e: any) => {
    const text = files[fileKey(e.path)]
    if (text === undefined) throw new Error(`cannot read ${e.path}`)
    return { value: text }
  })
}

test('reads the branch from .git/HEAD above the session folder when $.process is not available', async ($, on) => {
  answerWithoutGit(on, {
    cwd: `${MAIN_TREE}/src`,
    folders: [`${MAIN_TREE}/.git`],
    files: { [`${MAIN_TREE}/.git/HEAD`]: 'ref: refs/heads/develop\n' },
  })
  await measure($, 40)
  const ui = await mount($, 'desktop')
  expect(await ui.find({ type: 'Text', text: /git develop/ })).toBeDefined()
  await ui.unmount()
})

test("in a worktree, reads the worktree's own branch through its .git file, not the main tree's", async ($, on) => {
  answerWithoutGit(on, {
    cwd: WORKTREE,
    folders: [`${MAIN_TREE}/.git`, `${MAIN_TREE}/.git/worktrees/feature`],
    files: {
      [`${MAIN_TREE}/.git/HEAD`]: 'ref: refs/heads/develop\n',
      [`${WORKTREE}/.git`]: `gitdir: ${MAIN_TREE}/.git/worktrees/feature\r\n`,
      [`${MAIN_TREE}/.git/worktrees/feature/HEAD`]: 'ref: refs/heads/feature/LS-45_worktree-head\n',
    },
  })
  await measure($, 40)
  const ui = await mount($, 'desktop')
  expect(await ui.find({ type: 'Text', text: /git feature\/LS-45_worktree-head/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /git develop/ })).toBeUndefined()
  await ui.unmount()
})

test('outside a repository shows no git and looks for no .git', async ($, on) => {
  const asked: string[] = []
  answerWithoutGit(on, { cwd: 'C:/Users/dev/notes', files: {}, asked, repo: false })
  await measure($, 40)
  const ui = await mount($, 'desktop')
  expect(await ui.find({ type: 'Text', text: /no git/ })).toBeDefined()
  expect(asked.filter((path) => path.endsWith('/.git'))).toEqual([])
  await ui.unmount()
})

test('runs git status in the session folder without the index lock, and shows the branch', async ($, on) => {
  const calls: any[] = []
  answerSession(on, {
    processRun: async ($: any, e: any) => {
      calls.push(e)
      const stdout = '# branch.oid abc\n# branch.head develop\n1 .M N... a b c d e f x.mjs\n'
      return { value: { exitCode: 0, stdout, stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }
    },
  })
  await measure($, 40)
  const ui = await mount($, 'desktop')
  expect(await ui.find({ type: 'Text', text: /git develop/ })).toBeDefined()
  expect(calls[0].argv).toEqual(['git', 'status', '--porcelain=v2', '--branch', '--untracked-files=no'])
  expect(calls[0].init?.env?.GIT_OPTIONAL_LOCKS).toBe('0')
  expect(calls[0].init?.timeoutMs).toBe(1500)
  expect(calls[0].init?.cwd).toBeUndefined()
  await ui.unmount()
})

// A model request as the engine raises it, answered beneath the band by `answer`.
async function step($: any, input: Record<string, unknown>) {
  const stream = $.turn.step({ turnId: 't1', index: 0, model: 'claude-opus-5-5', messageCount: 1, ...input })
  const chunks: unknown[] = []
  for (let piece = await stream.next(); ; piece = await stream.next()) {
    if (piece.done) return { chunks, result: piece.value }
    chunks.push(piece.value)
  }
}

const answerSteps = (on: any) => on('turn.step', async function* ($: any, e: any) {
  yield { kind: 'text', index: 0, text: 'the answer' }
  return { turnId: e.turnId, index: e.index, answer: 'the answer', toolUses: [] }
})

test('takes only the effort from a model request and hands its response on unchanged', async ($, on) => {
  answerSession(on)
  answerSteps(on)
  const { chunks, result } = await step($, { effort: 'xhigh' })
  expect(chunks).toEqual([{ kind: 'text', index: 0, text: 'the answer' }])
  expect(result.answer).toBe('the answer')
  const ui = await mount($, 'desktop')
  expect(await ui.find({ type: 'Text', text: /xhigh/ })).toBeDefined()
  await ui.unmount()
})

test("a subagent's request leaves the session's effort as it was", async ($, on) => {
  answerSession(on)
  answerSteps(on)
  await step($, { effort: 'xhigh' })
  await step($, { effort: 'low', agentId: 'agent-1' })
  const ui = await mount($, 'desktop')
  expect(await ui.find({ type: 'Text', text: /xhigh/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /\blow\b/ })).toBeUndefined()
  await ui.unmount()
})

test('a history file that cannot be written leaves the band drawn', async ($, on) => {
  answerSession(on, { writeFails: true })
  await $.session.measure({ context: { tokens: 0, window: 1_000_000, percent: 54 }, rateLimits: USAGE.rateLimits, changed: ['rateLimits'] } as never)
  const ui = await mount($, 'desktop')
  expect(await ui.find({ type: 'Text', text: /7d/ })).toBeDefined()
  await ui.unmount()
})

test('records the plan figures a measurement reports in the shared history', async ($, on) => {
  const files: Record<string, string> = {}
  answerSession(on, { files })
  await $.session.measure({ context: { tokens: 0, window: 1_000_000, percent: 54 }, rateLimits: USAGE.rateLimits, changed: ['rateLimits'] } as never)
  const history = JSON.parse(files[HISTORY_FILE] ?? 'null')
  expect(history.readings.fiveHour).toEqual([[NOW, 12, NOW + 15_000_000]])
  expect(history.readings.sevenDay).toEqual([[NOW, 39, NOW + 274_200_000]])
  expect(Object.keys(history.sessions)).toEqual(['session-under-test'])
})

test('a measurement of the context alone writes no history', async ($, on) => {
  const files: Record<string, string> = {}
  answerSession(on, { files })
  await measure($, 54)
  expect(files[HISTORY_FILE]).toBeUndefined()
})

test('draws the newest shared figure and the pace of the last half hour', async ($, on) => {
  const reset = NOW + 15_000_000
  const readings = { fiveHour: [[NOW - 3_600_000, 20, reset], [NOW - 1_800_000, 30, reset], [NOW - 60_000, 45, reset]], sevenDay: [] }
  const files: Record<string, string> = { [HISTORY_FILE]: JSON.stringify({ version: 1, readings, sessions: {} }) }
  answerSession(on, { files })
  on('fs.read', async ($: any, e: any) => ({ value: files[fileKey(e.path)] ?? '' }))
  const ui = await mount($, 'desktop')
  expect(await ui.find({ type: 'Text', text: /45% → 170%/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /30\.0%\/h/ })).toBeDefined()
  await ui.unmount()
})

test('shows how long the cache stays warm after a cached turn, and nothing of it after /clear', async ($, on) => {
  answerSession(on)
  on('session.end', async ($: any, e: any) => ({ sessionId: e.sessionId }))
  const usage = { input_tokens: 10, output_tokens: 5, cache_creation_input_tokens: 0, cache_read_input_tokens: 990, model: 'm' }
  await $.turn.complete({ turnId: 't1', answer: 'done', durationMs: 1000, isAborted: false, reason: 'answer', usage } as never)
  const ui = await mount($, 'desktop')
  expect(await ui.find({ type: 'Text', text: /cache 99% 1h00m/ })).toBeDefined()
  await ui.unmount()
  await $.session.end({ reason: 'clear', sessionId: 'session-under-test', resume: { id: 'session-under-test' } })
  const cleared = await mount($, 'desktop')
  expect(await cleared.find({ type: 'Text', text: /1h00m/ })).toBeUndefined()
  await cleared.unmount()
})

test('still draws the band when the environment, files and settings refuse', async ($, on) => {
  answerSession(on, { refuse: true })
  await $.session.measure({ context: { tokens: 0, window: 1_000_000, percent: 54 }, rateLimits: USAGE.rateLimits, changed: ['rateLimits'] } as never)
  const ui = await mount($, 'desktop')
  expect(await ui.find({ type: 'Text', text: /7d/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /cache 99%/ })).toBeUndefined()
  await ui.unmount()
})
