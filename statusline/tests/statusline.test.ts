import { expect, test } from 'claude-code/testing'

import { ctxColor, effortLabel, progress, WINDOW_MS } from '../hooks/register'

const NOW = Date.parse('2026-11-12T12:00:00Z')

const HINT = {
  plugin: 'statusline',
  component: 'PromptHint',
  surface: 'terminal',
  props: { isDraft: false, isWorking: false, hint: '? for shortcuts' },
} as const

function engine(on: any, model: string, usage: any) {
  const status: (string | undefined)[] = []
  const usageArgs: unknown[] = []
  on('session.start', (_: unknown, e: any) => ({ cwd: e.cwd }))
  on('session.model', () => ({ value: model }))
  on('session.usage', (_: unknown, e: any) => (usageArgs.push(e), { value: usage }))
  on('clock.now', () => ({ value: NOW }))
  on('clock.every', () => ({ value: undefined }))
  on('ui.status', (_: unknown, e: any) => (status.push(e.text), { value: undefined }))
  // stands for the engine's own hint line under the prompt
  on('ui.render', ($: any, e: any) => h($.ui.resolve(e).Text, null, e.props.hint))
  return { status, usageArgs }
}

const text = async (ui: any, re: RegExp) => (await ui.find({ type: 'Text', text: re }))?.text

test('draws the line under the prompt in palette colors, keeping the hint', async ($, on) => {
  const { status, usageArgs } = engine(on, 'claude-opus-5-5[1m]', {
    startedAt: 0,
    context: { window: 1_000_000, percent: 42.7 },
    rateLimits: [
      { kind: 'five_hour', percentUsed: 13.9, resetsAt: '2026-11-12T14:30:00Z' },
      { kind: 'seven_day', percentUsed: 61, resetsAt: '2026-11-13T12:00:00Z' },
    ],
  })
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  expect(status).toEqual([undefined])
  // the plain call: no breakdown is asked for any more
  for (const args of usageArgs) expect((args as any)?.breakdown).toBeUndefined()

  // a refused color (e.g. "ansi:cyan") would skip the whole row; this one draws
  const ui = await $.ui.mount(HINT)
  expect(await text(ui, /ctx:/)).toBe('[Opus 5.5 1M] ctx: 42% 5h: 13% 7d: 61% (85%) rst: 2.5h|24.0h')
  expect(await text(ui, /shortcuts/)).toBe('? for shortcuts')
  await ui.unmount()
})

test('missing figures render as --', async ($, on) => {
  engine(on, 'Opus 4.8 (1M context)', { startedAt: 0, context: { window: 200000 }, rateLimits: [] })
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  const ui = await $.ui.mount(HINT)
  expect(await text(ui, /ctx:/)).toBe('[Opus 4.8 1M] ctx: -- 5h: -- 7d: -- rst: --|--')
  await ui.unmount()
})

test('progress through the window rolls over at the reset', () => {
  const H = 3_600_000
  const at = (ms: number) => new Date(NOW + ms).toISOString()
  // 7d window resetting in 1.47 days: 79% through
  expect(progress(at(1.47 * 24 * H), WINDOW_MS.week, NOW)).toBe(' (79%)')
  // a whole window left: just started
  expect(progress(at(7 * 24 * H), WINDOW_MS.week, NOW)).toBe(' (0%)')
  // a minute before the reset
  expect(progress(at(60_000), WINDOW_MS.week, NOW)).toBe(' (99%)')
  // exactly at the reset it starts over
  expect(progress(at(0), WINDOW_MS.week, NOW)).toBe(' (0%)')
  // a day past a reset nobody has reported yet: 1 day into the next week
  expect(progress(at(-24 * H), WINDOW_MS.week, NOW)).toBe(' (14%)')
  // no reset time, no parentheses
  expect(progress(undefined, WINDOW_MS.week, NOW)).toBe('')
})

test('ctx value turns yellow past 70% and red past 85%', () => {
  expect(ctxColor(undefined)).toBeUndefined()
  expect(ctxColor(0)).toBeUndefined()
  expect(ctxColor(70)).toBeUndefined()
  expect(ctxColor(70.9)).toBeUndefined() // shown as 70%
  expect(ctxColor(71)).toBe('ansi256(3)')
  expect(ctxColor(85)).toBe('ansi256(3)')
  expect(ctxColor(85.9)).toBe('ansi256(3)') // shown as 85%
  expect(ctxColor(86)).toBe('ansi256(1)')
  expect(ctxColor(100)).toBe('ansi256(1)')
})

for (const [percent, label] of [[78, 'yellow'], [92, 'red']] as const) {
  test(`a ${label} ctx value still draws the whole line`, async ($, on) => {
    engine(on, 'claude-opus-5-5', { startedAt: 0, context: { window: 200000, percent }, rateLimits: [] })
    await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
    const ui = await $.ui.mount(HINT)
    expect(await text(ui, /ctx:/)).toBe(`[Opus 5.5] ctx: ${percent}% 5h: -- 7d: -- rst: --|--`)
    await ui.unmount()
  })
}

test('effort labels are short', () => {
  expect(effortLabel('low')).toBe('Low')
  expect(effortLabel('medium')).toBe('M')
  expect(effortLabel('high')).toBe('H')
  expect(effortLabel('xhigh')).toBe('XH')
  expect(effortLabel('max')).toBe('Max')
  expect(effortLabel(undefined)).toBeNull()
})

test("the main loop's effort joins the model, a subagent's does not", async ($, on) => {
  engine(on, 'claude-opus-5-5', { startedAt: 0, context: { window: 200000, percent: 5 }, rateLimits: [] })
  // stands for the model request: one text chunk, then the step's result
  on('turn.step', async function* (_: unknown, e: any) {
    yield { kind: 'text', index: 0, text: 'hi' }
    return {
      turnId: e.turnId, index: e.index, answer: 'hi', toolUses: [], stopReason: 'end_turn' as const,
      usage: { model: 'claude-opus-5-5', input_tokens: 0, output_tokens: 0, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 },
    }
  })
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })

  let ui = await $.ui.mount(HINT)
  expect(await text(ui, /ctx:/)).toMatch(/^\[Opus 5\.5\] ctx:/) // no request yet, no effort
  await ui.unmount()

  const step = { turnId: 't1', index: 0, model: 'claude-opus-5-5', messageCount: 1 }
  const chunks: unknown[] = []
  const stream = $.turn.step({ ...step, effort: 'xhigh' })
  for await (const c of stream) chunks.push(c)
  expect(chunks).toEqual([{ kind: 'text', index: 0, text: 'hi' }]) // the response passes untouched
  await $.turn.step({ ...step, index: 1, effort: 'low', agentId: 'a1' }).result

  ui = await $.ui.mount(HINT)
  expect(await text(ui, /ctx:/)).toMatch(/^\[Opus 5\.5 XH\] ctx: 5%/)
  await ui.unmount()
})
