// Runs with `claude plugin test`: loads the mod, fires events through its hooks
// and draws the band above the prompt for the terminal and the Desktop app.
import { expect, mock, test } from 'claude-code/testing'

const NOW = 1_800_000_000_000 // ms
const iso = (ms: number) => new Date(ms).toISOString()
const usageAt = (fivePct: number) => ({
  startedAt: iso(NOW - 3_600_000),
  context: { tokens: 76_000, window: 200_000, percent: 38 },
  rateLimits: [
    { kind: 'five_hour', percentUsed: fivePct, resetsAt: iso(NOW + 9_600_000) },
    { kind: 'seven_day', percentUsed: 41, resetsAt: iso(NOW + 274_000_000) },
  ],
  cost: { usd: 4.32 },
})

const band = (surface: 'terminal' | 'desktop', props: Record<string, unknown> = {}) =>
  ({
    plugin: 'korkmaz-trail',
    component: 'AbovePrompt',
    surface,
    viewport: { columns: 200, rows: 40 },
    props: { hasSurvey: false, isWorking: false, maxRows: 8, bodyColumns: 190, scroll: { offset: 0, bodyRows: 8 }, view: {}, ...props },
  }) as any

type State = { usage: unknown; messages?: unknown[]; store?: Map<string, unknown> }

// Everything the mod asks Claude Code for, answered in its place. The store
// starts with English chosen, so the tests read the same on any system.
function stub(on: any, state: State) {
  const store = (state.store ??= new Map([['language', 'en']]))
  mock.clock(on, { now: NOW })
  on('session.usage', () => ({ value: state.usage }))
  on('session.messages', () => ({ value: state.messages ?? [] }))
  on('session.start', () => ({ cwd: '/work' }))
  on('session.measure', ($: any, e: any) => ({ changed: e.changed ?? [] }))
  on('command.register', () => ({ value: undefined }))
  on('store.get', ($: any, e: any) => ({ value: store.get(e.key) }))
  on('store.set', ($: any, e: any) => {
    store.set(e.key, e.value)
    return { value: undefined }
  })
  on('tool.call', () => ({ result: 'ok' }))
  on('ui.render', () => ({ type: 'Text', props: {}, children: ['ENGINE'] }))
}
const start = ($: any) => $.session.start({ surface: 'desktop', isInteractive: true, cwd: '/work' })

test('Desktop: one tinted chip per fact; terminal: the same as one line', async ($, on) => {
  stub(on, { usage: usageAt(23) })
  await start($)
  await $.tool.call({ tool: 'Bash', command: 'ls' })
  await $.tool.call({ tool: 'Edit', file_path: 'src/a.ts', old_string: 'a', new_string: 'b' })
  await $.tool.call({ tool: 'WebFetch', url: 'https://example.com', prompt: 'summarise' })
  await $.tool.call({ tool: 'Bash', command: 'git push --force origin main' })

  const desk = await $.ui.mount(band('desktop'))
  const status = await desk.find({ key: 'korkmaz-trail-status' })
  expect(status.props.backgroundColor).toBe('rgba(224, 68, 62, 0.18)') // red: a high-risk action, just now
  expect(await desk.find({ type: 'Text', text: ' High-risk action' })).toBeDefined()
  expect(await desk.find({ type: 'Text', text: 'Commands ' })).toBeDefined()
  const risk = await desk.find({ type: 'Text', text: ': git push --force origin main' })
  expect(risk.props.color).toBe('error')
  expect(await desk.find({ type: 'Text', text: '23%' })).toBeDefined()
  expect(await desk.find({ key: 'korkmaz-trail-cost' })).toBeDefined()
  expect(await desk.find({ type: 'Text', text: 'ENGINE' })).toBeDefined() // keeps what later mods draw
  await desk.unmount()

  const term = await $.ui.mount(band('terminal'))
  expect(await term.find({ key: 'korkmaz-trail-status' })).toBeUndefined()
  expect(await term.find({ type: 'Text', text: ' High-risk action' })).toBeDefined()
  expect(await term.find({ type: 'Text', text: /│/ })).toBeDefined()
  await term.unmount()
})

test('/korkmaz-trail tr switches to Turkish and remembers it; plain /korkmaz-trail explains', async ($, on) => {
  const state: State = { usage: usageAt(23) }
  stub(on, state)
  await start($)
  const help = await $.command.run({ command: 'korkmaz-trail', args: '' })
  expect(help.text).toMatch(/Commands · Files · Internet/)
  const answer = await $.command.run({ command: 'korkmaz-trail', args: 'tr' })
  expect(answer.text).toBe('Dil: Türkçe')
  expect(state.store!.get('language')).toBe('tr')
  const ui = await $.ui.mount(band('desktop'))
  expect(await ui.find({ type: 'Text', text: ' Her şey yolunda' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: '%23' })).toBeDefined()
})

test('with nothing saved, the bar starts in the system language', async ($, on) => {
  stub(on, { usage: usageAt(23), store: new Map() })
  await start($)
  const isTurkish = Intl.DateTimeFormat().resolvedOptions().locale.toLowerCase().startsWith('tr')
  const ui = await $.ui.mount(band('desktop'))
  expect(await ui.find({ type: 'Text', text: isTurkish ? 'Komut ' : 'Commands ' })).toBeDefined()
})

test('a saved language is used from the start', async ($, on) => {
  stub(on, { usage: usageAt(23), store: new Map([['language', 'tr']]) })
  await start($)
  const ui = await $.ui.mount(band('desktop'))
  expect(await ui.find({ type: 'Text', text: 'Komut ' })).toBeDefined()
})

test('a new reading of the limits redraws with the new value', async ($, on) => {
  const state: State = { usage: usageAt(23) }
  stub(on, state)
  await start($)
  state.usage = usageAt(91)
  await $.session.measure({ changed: ['rateLimits'] })
  const ui = await $.ui.mount(band('desktop'))
  // 91% used with 2h40m to go: at the window's average pace the limit is ~14 minutes away
  expect((await ui.find({ type: 'Text', text: '91%' })).props.color).toBe('error')
  expect(await ui.find({ type: 'Text', text: ' · full in 13m at this pace' })).toBeDefined()
  expect((await ui.find({ key: 'korkmaz-trail-five_hour' })).props.backgroundColor).toBe('rgba(224, 68, 62, 0.18)')
})

test('joining a session late rebuilds the trail from the conversation', async ($, on) => {
  stub(on, {
    usage: null,
    messages: [
      { role: 'assistant', text: '', toolUses: [{ name: 'Bash', input: { command: 'sudo ls /root' } }] },
      { role: 'assistant', text: '', toolUses: [{ tool: 'Read', file_path: '/app/.env' }] },
    ],
  })
  await start($)
  const ui = await $.ui.mount(band('terminal'))
  expect(await ui.find({ type: 'Text', text: ': read .env' })).toBeDefined()
})

test('Turkish keeps the gauges on a Desktop-sized band', async ($, on) => {
  stub(on, { usage: usageAt(23), store: new Map([['language', 'tr']]) })
  await start($)
  const ui = await $.ui.mount(band('desktop', { bodyColumns: 95 }))
  expect(await ui.find({ type: 'Text', text: /▰/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: '%23' })).toBeDefined()
})

test('a narrow band drops the gauges', async ($, on) => {
  stub(on, { usage: usageAt(23) })
  await start($)
  const ui = await $.ui.mount(band('desktop', { bodyColumns: 40 }))
  expect(await ui.find({ type: 'Text', text: /▰/ })).toBeUndefined()
  expect(await ui.find({ type: 'Text', text: '23%' })).toBeDefined()
})

test('steps aside while a survey is showing', async ($, on) => {
  stub(on, { usage: usageAt(23) })
  await start($)
  const ui = await $.ui.mount(band('desktop', { hasSurvey: true }))
  expect(await ui.find({ type: 'Text', text: 'ENGINE' })).toBeDefined()
  expect(await ui.find({ key: 'korkmaz-trail-status' })).toBeUndefined()
})
