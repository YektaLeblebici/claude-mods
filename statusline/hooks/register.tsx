import { atom, read, update } from 'claude-code'
import type { Register, EngineInterface } from 'claude-code'

import type { Figures } from '../types'

// Port of ~/.claude/statusline.sh, drawn on its own row under the prompt
// (above the engine's hint line):
//   [Model Effort] ctx: <ctx%>  5h: <5h%>  7d: <7d%> (<% through the week>)  rst: <5h left>|<7d left>
// Missing values render as "--". Colors are the terminal's own palette slots, as the
// script's SGR codes were: ansi256(8)=90 grey, (6)=36 cyan, (2)=32 green, (3)=33 yellow,
// (5)=35 magenta. Plain names ("cyan") are swapped for fixed hex values, and "ansi:cyan"
// is refused in a mod's tree. Values are drawn in the theme's grey (inactive), as the
// engine draws a statusLine script's plain text (38;5;246 measured). The ctx value turns yellow past 70% and red past 85%.

const figures = atom({ plugin: 'statusline', key: 'figures' } as const, null)
// the effort the main loop's last request went out with, known from its first request on
const effort = atom({ plugin: 'statusline', key: 'effort' } as const, null)

// Short effort labels: Low, M, H, XH, Max ("Low" spelled out so it is not read as "Large"; "Max" as M is medium); a numeric budget as given.
const EFFORT_SHORT: Record<string, string> = { low: 'Low', medium: 'M', high: 'H', xhigh: 'XH', max: 'Max' }
export function effortLabel(level: string | number | undefined): string | null {
  if (level === undefined) return null
  if (typeof level === 'number') return String(level)
  return EFFORT_SHORT[level] ?? level
}

// "Opus 4.8 (1M context)" -> "Opus 4.8 1M"; "claude-opus-5-5[1m]" -> "Opus 5.5 1M".
export function modelLabel(raw: string): string {
  const id = /^claude-([a-z]+)-(\d+)(?:-(\d{1,2}))?(?:-\d{8})?(\[1m\])?$/i.exec(raw.trim())
  if (id) {
    const [, family = '', major = '', minor, oneM] = id
    const fam = family.charAt(0).toUpperCase() + family.slice(1)
    const ver = minor ? `${major}.${minor}` : major
    return `${fam} ${ver}${oneM ? ' 1M' : ''}`
  }
  return (raw || '?').replace(/ context/g, '').replace(/[()]/g, '')
}

export const pct = (n: number | undefined) => (n === undefined ? '--' : `${Math.floor(n)}%`)

export function hrs(iso: string | undefined, nowMs: number): string {
  if (!iso) return '--'
  const t = Date.parse(iso)
  if (Number.isNaN(t)) return '--'
  return `${Math.max(0, (t - nowMs) / 3_600_000).toFixed(1)}h`
}

// The ctx value's color: default up to 70%, yellow past 70%, red past 85%, judged on the
// whole percentage shown, so "70%" is never yellow. Palette slots, as the labels.
export function ctxColor(n: number | undefined): string | undefined {
  if (n === undefined) return undefined
  const shown = Math.floor(n)
  if (shown > 85) return 'ansi256(1)'
  if (shown > 70) return 'ansi256(3)'
  return undefined
}

const HOUR = 3_600_000
export const WINDOW_MS = { five: 5 * HOUR, week: 7 * 24 * HOUR } as const

// How far through its window we are, 0-99: 100% is the reset itself, after which
// it starts over (rolled on by whole windows until fresh figures arrive).
export function progress(iso: string | undefined, windowMs: number, nowMs: number): string {
  if (!iso) return ''
  const t = Date.parse(iso)
  if (Number.isNaN(t)) return ''
  const elapsed = windowMs - (t - nowMs)
  const into = ((elapsed % windowMs) + windowMs) % windowMs
  return ` (${Math.floor((into / windowMs) * 100)}%)`
}

async function refresh($: EngineInterface) {
  const [model, u, now] = await Promise.all([$.session.model(), $.session.usage(), $.clock.now()])
  const five = u.rateLimits.find(r => r.kind === 'five_hour')
  const week = u.rateLimits.find(r => r.kind === 'seven_day')
  const next: Figures = {
    model: modelLabel(model),
    ctx: u.context.percent,
    five: five?.percentUsed,
    week: week?.percentUsed,
    fiveResetsAt: five?.resetsAt,
    weekResetsAt: week?.resetsAt,
    now,
  }
  await update($, figures, () => next)
}

// the minute tick only moves the reset countdowns
async function tick($: EngineInterface) {
  const now = await $.clock.now()
  await update($, figures, f => (f === null ? f : { ...f, now }))
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    const r = await next(e)
    $.ui.status(undefined) // drop the pinned line an earlier version left
    await refresh($)
    $.clock.every(60_000, () => tick($))
    return r
  })

  on('session.measure', async ($, e, next) => {
    const r = await next(e)
    await refresh($)
    return r
  })

  // the effort level rides on each model request; main loop only, not subagents
  // turn.step streams the response: forward every chunk untouched
  on('turn.step', async function* ($, e, next) {
    if (e.agentId === undefined) {
      const label = effortLabel(e.effort)
      if ((await read($, effort)) !== label) await update($, effort, () => label)
    }
    return yield* next(e)
  })

  // a /model switch shows up after the next turn
  on('turn.complete', async ($, e, next) => {
    const r = await next(e)
    await refresh($)
    return r
  })

  on('ui.render', { component: 'PromptHint' }, async ($, e, next) => {
    const f = await read($, figures)
    if (f === null) return next(e)
    const { Box, Text } = $.ui.resolve(e)
    const ctx = ctxColor(f.ctx)
    const level = await read($, effort)

    return (
      <Box flexDirection="column">
        <Text wrap="truncate-end" color="inactive">
          <Text color="ansi256(8)">[{level === null ? f.model : `${f.model} ${level}`}]</Text>{' '}
          <Text color="ansi256(6)">ctx:</Text>{' '}
          {ctx === undefined ? pct(f.ctx) : <Text color={ctx}>{pct(f.ctx)}</Text>}{' '}
          <Text color="ansi256(2)">5h:</Text> {pct(f.five)}{' '}
          <Text color="ansi256(3)">7d:</Text> {pct(f.week)}{progress(f.weekResetsAt, WINDOW_MS.week, f.now)}{' '}
          <Text color="ansi256(5)">rst:</Text> {hrs(f.fiveResetsAt, f.now)}|{hrs(f.weekResetsAt, f.now)}
        </Text>
        {await next(e)}
      </Box>
    )
  })
}
