// korkmaz-trail: an audit trail for your AI agent, drawn above the Claude Code prompt.
//
// Counts the commands, file changes and outbound calls Claude makes, flags risky
// ones, and shows them next to your plan limits, context and cost. It only
// watches: every tool call is passed on unchanged. Nothing leaves your machine.
import { classifyToolUse } from '../lib/rules.js'
import { STRINGS, WINDOWS, buildModel, chipLine, fit, legend, merge, pushSample, systemLanguage } from '../lib/bar.js'

// Text colours come from the theme, so they follow the app's light or dark mode.
const TONES = {
  ok: { color: 'success' },
  watch: { color: 'warning' },
  act: { color: 'error' },
  dim: { dimColor: true },
}
// Chip backgrounds are translucent, so they read on light and dark themes alike.
const TINTS = {
  ok: 'rgba(47, 163, 107, 0.16)',
  watch: 'rgba(217, 106, 28, 0.18)',
  act: 'rgba(224, 68, 62, 0.18)',
  neutral: 'rgba(127, 127, 127, 0.13)',
}
const MAX_RISKS = 50
const REFRESH_MS = 30000 // keeps the reset countdowns current while idle

const freshTrail = () => ({ cmds: 0, net: 0, files: new Set(), riskCount: 0, risks: [] })

let trail = freshTrail()
let usage = null
let samples = { five_hour: [], seven_day: [] }
let lang = systemLanguage()

// Windows paths are case-insensitive; count C:\a.ts and c:/A.ts as one file.
const normPath = (p) => {
  const s = String(p).replace(/\\/g, '/')
  return /^[A-Za-z]:\//.test(s) ? s.toLowerCase() : s
}

function note(name, input, t) {
  const r = classifyToolUse({ name, input })
  if (r.cmd) trail.cmds += 1
  if (r.net) trail.net += 1
  if (r.edit) trail.files.add(normPath(r.edit))
  if (r.risk) {
    trail.riskCount += 1
    trail.risks.push({ t, ...r.risk })
    if (trail.risks.length > MAX_RISKS) trail.risks.shift()
  }
}

// Rebuild the trail from the conversation so far, for a session the mod joins
// late: a resumed one, or one where the mod was just installed or reloaded.
async function seed($) {
  trail = freshTrail()
  let messages = []
  try {
    messages = await $.session.messages()
  } catch {
    return
  }
  for (const message of Array.isArray(messages) ? messages : []) {
    for (const use of Array.isArray(message?.toolUses) ? message.toolUses : []) {
      const name = use?.tool ?? use?.name
      if (typeof name !== 'string') continue
      note(name, use.input && typeof use.input === 'object' ? use.input : use, 0)
    }
  }
}

async function measure($) {
  try {
    usage = await $.session.usage()
  } catch {
    return
  }
  const now = Math.floor((await $.clock.now()) / 1000)
  for (const limit of Array.isArray(usage?.rateLimits) ? usage.rateLimits : []) {
    const spec = WINDOWS[limit?.kind]
    if (!spec || !Number.isFinite(limit.percentUsed)) continue
    samples[limit.kind] = pushSample(samples[limit.kind], now, limit.percentUsed, spec)
  }
}

// The language /korkmaz-trail tr|en saved, else the system's.
async function loadLanguage($) {
  const saved = await $.store.get('language').catch(() => undefined)
  lang = STRINGS[saved] ? saved : systemLanguage()
}

export function register(on) {
  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'korkmaz-trail',
      description: 'Explain the bar above the prompt, or switch its language: /korkmaz-trail tr | en',
      immediate: true,
    })
    await loadLanguage($)
    await seed($)
    await measure($)
    $.clock.every(REFRESH_MS, () => $.ui.invalidate('ui.render'))
    return next(e)
  })

  // /clear, /resume and /branch start a different conversation.
  on('classic.SessionStart', { source: ['clear', 'resume', 'fork'] }, async ($, e, next) => {
    await seed($)
    $.ui.invalidate('ui.render')
    return next(e)
  })

  on('command.run', { command: 'korkmaz-trail' }, async ($, e) => {
    const arg = String(e.args ?? '').trim().toLowerCase()
    if (STRINGS[arg]) {
      lang = arg
      await $.store.set('language', arg)
      $.ui.invalidate('ui.render')
      return { text: STRINGS[arg].langSet }
    }
    return { text: legend(lang) }
  })

  on('tool.call', async ($, e, next) => {
    note(e.tool, e, Math.floor((await $.clock.now()) / 1000))
    $.ui.invalidate('ui.render')
    return next(e)
  })

  // After each turn, and whenever a plan limit's percentage moves.
  on('session.measure', async ($, e, next) => {
    await measure($)
    $.ui.invalidate('ui.render')
    return next(e)
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (e.props.hasSurvey) return next(e)
    const now = Math.floor((await $.clock.now()) / 1000)
    const model = buildModel({ trail: { ...trail, files: trail.files.size }, usage, samples, now })
    const { Box, Text } = $.ui.resolve(e)
    const text = (s) => Text({ ...(s.tone ? TONES[s.tone] : {}), ...(s.bold ? { bold: true } : {}), children: [s.text] })

    // The Desktop app gets one chip per fact, wrapping onto more rows when
    // narrow; the terminal gets the same chips as one line of text.
    const isDesktop = e.surface === 'desktop'
    const list = fit(model, e.props.bodyColumns || 0, lang, isDesktop ? 3 : 1)
    const row = isDesktop
      ? Box({
          key: 'korkmaz-trail',
          flexDirection: 'row',
          flexWrap: 'wrap',
          gap: 1,
          children: list.map((c) =>
            Box({
              key: `korkmaz-trail-${c.key}`,
              flexDirection: 'row',
              backgroundColor: TINTS[c.tint || 'neutral'],
              paddingX: 1,
              children: merge(c.parts).map(text),
            }),
          ),
        })
      : Box({ key: 'korkmaz-trail', flexDirection: 'row', children: merge(chipLine(list)).map(text) })

    // Keep whatever the mods after this one draw in the band.
    const theirs = await next(e)
    return Box({ flexDirection: 'column', children: theirs ? [row, theirs] : [row] })
  })
}
