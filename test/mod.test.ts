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
    viewport: { columns: 160, rows: 40 },
    props: { hasSurvey: false, isWorking: false, maxRows: 8, bodyColumns: 150, scroll: { offset: 0, bodyRows: 8 }, view: {}, ...props },
  }) as any

// Everything the mod asks Claude Code for, answered in its place.
function stub(on: any, state: { usage: unknown; messages?: unknown[] }) {
  mock.clock(on, { now: NOW })
  on('session.usage', () => ({ value: state.usage }))
  on('session.messages', () => ({ value: state.messages ?? [] }))
  on('session.start', () => ({ cwd: '/work' }))
  on('session.measure', ($: any, e: any) => ({ changed: e.changed ?? [] }))
  on('tool.call', () => ({ result: 'ok' }))
  on('ui.render', () => ({ type: 'Text', props: {}, children: ['ENGINE'] }))
}
const start = ($: any) => $.session.start({ surface: 'desktop', isInteractive: true, cwd: '/work' })

test('counts tool calls and shows limits on the terminal and the Desktop app', async ($, on) => {
  stub(on, { usage: usageAt(23) })
  await start($)
  await $.tool.call({ tool: 'Bash', command: 'ls' })
  await $.tool.call({ tool: 'Edit', file_path: 'src/a.ts', old_string: 'a', new_string: 'b' })
  await $.tool.call({ tool: 'WebFetch', url: 'https://example.com', prompt: 'summarise' })
  await $.tool.call({ tool: 'Bash', command: 'git push --force origin main' })

  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount(band(surface))
    const risk = await ui.find({ type: 'Text', text: /git push --force origin main/ })
    expect(risk).toBeDefined()
    expect(risk.props.color).toBe('error') // a high-risk action, just now
    expect(await ui.find({ type: 'Text', text: '23%' })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: '■' })).toBeDefined()
    // The band keeps what the mods after this one draw
    expect(await ui.find({ type: 'Text', text: 'ENGINE' })).toBeDefined()
    await ui.unmount()
  }
})

test('a new reading of the limits redraws with the new value', async ($, on) => {
  const state = { usage: usageAt(23) as unknown }
  stub(on, state)
  await start($)
  state.usage = usageAt(91)
  await $.session.measure({ changed: ['rateLimits'] })
  const ui = await $.ui.mount(band('desktop'))
  const pct = await ui.find({ type: 'Text', text: '91%' })
  expect(pct).toBeDefined()
  // 91% used with 2h40m to go: at the window's average pace the limit is ~14 minutes away
  expect(pct.props.color).toBe('error')
  expect(await ui.find({ type: 'Text', text: ' → limit in 13m' })).toBeDefined()
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
  expect(await ui.find({ type: 'Text', text: / read \.env$/ })).toBeDefined()
})

test('narrow band drops the gauges', async ($, on) => {
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
  expect(await ui.find({ type: 'Text', text: '■' })).toBeUndefined()
})
