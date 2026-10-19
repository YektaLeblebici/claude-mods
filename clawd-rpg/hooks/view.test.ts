import type { On } from 'claude-code'
import { type Engine, expect, mock, test } from 'claude-code/testing'

import type { Save } from '../types'
import { newSave } from './engine'

const always = (value: number) => () => value
const START = { cwd: '/tmp', surface: 'terminal', isInteractive: true } as const
const BAND = { hasSurvey: false, isWorking: false, maxRows: 20, bodyColumns: 60, scroll: { offset: 0, bodyRows: 19 } }

/** Claude Code beneath the plugin: the store on disk, Bash, toasts, panes, and its own band drawing. */
function engine(on: On, disk: Record<string, unknown>) {
  const seen = { toasts: [] as string[], closed: [] as string[], commands: [] as string[], screens: ['terminal'] as string[] }
  on('session.start', (_$, e) => ({ cwd: e.cwd }))
  on('command.register', (_$, e) => {
    seen.commands.push((e as { name: string }).name)
    return { value: { command: (e as { name: string }).name } }
  })
  on('store.get', (_$, e) => ({ value: disk[e.key] }))
  on('store.set', (_$, e) => {
    disk[e.key] = e.value
    return { value: undefined }
  })
  on('tool.call', { tool: 'Bash' }, () => ({ result: { stdout: '', stderr: '', interrupted: false }, text: 'ok' }) as never)
  on('ui.toast', (_$, e) => {
    seen.toasts.push(String((e as { text?: unknown }).text ?? ''))
    return { value: undefined } as never
  })
  on('ui.panes', () => ({ value: [{ id: 'clawd-rpg', title: 'Claude RPG', isShown: true, isFocused: false, isPlaced: true }] }) as never)
  on('ui.close', (_$, e) => {
    seen.closed.push((e as { id: string }).id)
    return { value: undefined } as never
  })
  on('session.surfaces', () => ({ value: seen.screens }) as never)
  on('session.attach', (_$, e) => ({ clientId: (e as { clientId: string }).clientId }) as never)
  on('session.detach', (_$, e) => ({ clientId: (e as { clientId: string }).clientId }) as never)
  on('ui.render', { component: 'AbovePrompt' }, ($, e) => {
    const { Text } = $.ui.resolve(e)
    return h(Text, null, 'ENGINE-OWN') as never
  })
  return seen
}

const run = ($: { command: { run: (e: never) => Promise<unknown> } }, command: string, args = '') =>
  $.command.run({ command, args } as never) as Promise<{ text?: string }>



const PARTIAL = '▘▝▖▗▌▐▚▞▛▜▙▟'
/** What the band above the prompt shows now: Claude Code's own drawing, the status line alone, or the full scene. */
async function band($: Engine) {
  const mounted = await $.ui.mount({ plugin: 'clawd-rpg', surface: 'terminal', component: 'AbovePrompt', props: BAND as never })
  const texts = (await mounted.findAll({ type: 'Text' })).map(t => t.text)
  await mounted.unmount()
  const all = texts.join('')
  if (all.includes('ENGINE-OWN')) return 'nothing'
  return [...all].some(ch => PARTIAL.includes(ch)) ? 'full' : all.includes('Clawd the Newbie') ? 'status line' : 'other'
}

test('with no choice ever made, the game shows the mini view: just the status line', async ($, on) => {
  mock.clock(on)
  const disk: Record<string, unknown> = { save: { ...newSave(always(0.5)), rev: 1 } }
  engine(on, disk)
  await $.session.start(START)
  expect(await band($)).toBe('status line')
})

test('/rpg show, /rpg mini and /rpg hide switch between the full view, the status line and nothing', async ($, on) => {
  mock.clock(on)
  const disk: Record<string, unknown> = { save: { ...newSave(always(0.5)), rev: 1 } }
  engine(on, disk)
  await $.session.start(START)
  expect((await run($, 'rpg', 'show')).text).toContain('full view')
  expect(disk.view).toBe('show')
  expect(await band($)).toBe('full')
  expect((await run($, 'rpg', 'hide')).text).toContain('hidden')
  expect(disk.view).toBe('hide')
  expect(await band($)).toBe('nothing')
  expect((await run($, 'rpg', 'mini')).text).toContain('mini view')
  expect(disk.view).toBe('mini')
  expect(await band($)).toBe('status line')
  expect((await run($, 'rpg', 'mini')).text).toContain('Already in that view')
})

test('the last choice is the default: a new session opens in it', async ($, on) => {
  mock.clock(on)
  const disk: Record<string, unknown> = {}
  engine(on, disk)
  for (const [chosen, seen] of [['show', 'full'], ['hide', 'nothing'], ['mini', 'status line']] as const) {
    for (const key of Object.keys(disk)) delete disk[key]
    Object.assign(disk, { save: { ...newSave(always(0.5)), rev: 1 }, view: chosen })
    await $.session.start(START)
    expect(await band($)).toBe(seen)
  }
})

test('a store from before views keeps what it showed: hidden stays hidden, animation on is the full view', async ($, on) => {
  mock.clock(on)
  const disk: Record<string, unknown> = {}
  engine(on, disk)
  for (const [old, seen] of [[{ hidden: true, anim: true }, 'nothing'], [{ anim: true }, 'full'], [{ anim: false }, 'status line']] as const) {
    for (const key of Object.keys(disk)) delete disk[key]
    Object.assign(disk, { save: { ...newSave(always(0.5)), rev: 1 }, ...old })
    await $.session.start(START)
    expect(await band($)).toBe(seen)
  }
})

test('hidden, the game keeps playing: a commit still opens a chest and the save moves on, without a toast', async ($, on) => {
  mock.clock(on)
  const disk: Record<string, unknown> = { save: { ...newSave(always(0.5)), rev: 1 } }
  const seen = engine(on, disk)
  await $.session.start(START)
  await run($, 'rpg', 'hide')
  const goldBefore = (disk.save as Save).hero.gold
  await $.tool.call({ tool: 'Bash', command: 'git commit -m "work"' })
  const after = disk.save as Save
  expect(after.hero.gold > goldBefore).toBe(true)
  expect(after.lastGoodChestAt !== undefined).toBe(true)
  expect(after.pendingLuck).toBe('lucky')
  expect(seen.toasts.length).toBe(0)

  // In the mini view toasts come back. The last good chest long ago, so this commit opens a good one.
  await run($, 'rpg', 'mini')
  disk.save = { ...(disk.save as Save), lastGoodChestAt: -1e12, rev: ((disk.save as Save).rev ?? 0) + 1 }
  await $.tool.call({ tool: 'Bash', command: 'git commit -m "more work"' })
  expect(seen.toasts.some(t => t.includes('Treasure chest'))).toBe(true)
})

test('hiding closes the character pane if it is open', async ($, on) => {
  mock.clock(on)
  const disk: Record<string, unknown> = { save: { ...newSave(always(0.5)), rev: 1 } }
  const seen = engine(on, disk)
  await $.session.start(START)
  await run($, 'rpg', 'hide')
  expect(seen.closed).toContain('clawd-rpg')
})

test('the animation clock runs only in the full view', async ($, on) => {
  const clock = mock.clock(on)
  const disk: Record<string, unknown> = { save: { ...newSave(always(0.5)), rev: 1 } }
  engine(on, disk)
  const frames: number[] = []
  on('state.set', ($, e, next) => {
    if (e.plugin === 'clawd-rpg' && e.key === 'frame') frames.push(e.value as number)
    return next(e)
  })
  await $.session.start(START)
  await clock.advance(1000)
  expect(frames.length).toBe(0)
  await run($, 'rpg', 'show')
  await band($)
  await clock.advance(1000)
  const shown = frames.length
  expect(shown > 0).toBe(true)
  await run($, 'rpg', 'hide')
  await clock.advance(1000)
  expect(frames.length).toBe(shown)
  await run($, 'rpg', 'mini')
  await clock.advance(1000)
  expect(frames.length).toBe(shown)
})

test('the game has one command, /rpg, and /rpg anim is gone', async ($, on) => {
  mock.clock(on)
  const disk: Record<string, unknown> = { save: { ...newSave(always(0.5)), rev: 1 } }
  const seen = engine(on, disk)
  await $.session.start(START)
  expect(seen.commands).toEqual(['rpg'])
  expect((await run($, 'rpg', 'anim')).text).toContain('Usage')
  expect(disk.view).toBe(undefined)
})

/** Frames the animation clock bumps, as the test watches them. */
function frameSpy(on: On) {
  const frames: number[] = []
  on('state.set', ($, e, next) => {
    if (e.plugin === 'clawd-rpg' && e.key === 'frame') frames.push(e.value as number)
    return next(e)
  })
  return frames
}

test('the band animates only while it is drawn: it idles soon after drawing stops, and picks up when drawn again', async ($, on) => {
  const clock = mock.clock(on)
  const disk: Record<string, unknown> = { save: { ...newSave(always(0.5)), rev: 1 }, view: 'show' }
  engine(on, disk)
  const frames = frameSpy(on)
  await $.session.start(START)

  // Never drawn (a session in the background from the start): no frames at all.
  await clock.advance(3000)
  expect(frames.length).toBe(0)

  // Drawn: frames run while the band is on screen.
  const mounted = await $.ui.mount({ plugin: 'clawd-rpg', surface: 'terminal', component: 'AbovePrompt', props: BAND as never })
  await clock.advance(1500)
  const whileDrawn = frames.length
  expect(whileDrawn >= 3).toBe(true)

  // Drawing stops (the session goes to the background): within the idle window, frames stop.
  await mounted.unmount()
  await clock.advance(2500)
  const settled = frames.length
  await clock.advance(5000)
  expect(frames.length).toBe(settled)

  // Drawn again (back in the foreground): frames pick up.
  const again = await $.ui.mount({ plugin: 'clawd-rpg', surface: 'terminal', component: 'AbovePrompt', props: BAND as never })
  await clock.advance(1500)
  expect(frames.length > settled).toBe(true)
  await again.unmount()
})

test('with no screen attached the clock stops; a screen attaching starts it, the last one leaving stops it', async ($, on) => {
  const clock = mock.clock(on)
  const disk: Record<string, unknown> = { save: { ...newSave(always(0.5)), rev: 1 }, view: 'show' }
  const seen = engine(on, disk)
  seen.screens = []
  const frames = frameSpy(on)
  await $.session.start(START)
  const mounted = await $.ui.mount({ plugin: 'clawd-rpg', surface: 'terminal', component: 'AbovePrompt', props: BAND as never })
  await clock.advance(1500)
  expect(frames.length).toBe(0)

  seen.screens = ['terminal']
  await $.session.attach({ surface: 'terminal', clientId: 'terminal:default' } as never)
  await clock.advance(1500)
  const attached = frames.length
  expect(attached > 0).toBe(true)

  seen.screens = []
  await $.session.detach({ surface: 'terminal', clientId: 'terminal:default', reason: 'detached' } as never)
  await clock.advance(1500)
  expect(frames.length).toBe(attached)
  await mounted.unmount()
})
