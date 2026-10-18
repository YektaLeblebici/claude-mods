import type { On } from 'claude-code'
import { expect, mock, test } from 'claude-code/testing'

import type { Save } from '../types'
import { newSave } from './engine'

const always = (value: number) => () => value
const START = { cwd: '/tmp', surface: 'terminal', isInteractive: true } as const
const BAND = { hasSurvey: false, isWorking: false, maxRows: 20, bodyColumns: 60, scroll: { offset: 0, bodyRows: 19 } }

/** Claude Code beneath the plugin: the store on disk, Bash, toasts, panes, and its own band drawing. */
function engine(on: On, disk: Record<string, unknown>) {
  const seen = { toasts: [] as string[], closed: [] as string[] }
  on('session.start', (_$, e) => ({ cwd: e.cwd }))
  on('command.register', () => ({ value: { command: 'rpg' } }))
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
  on('ui.render', { component: 'AbovePrompt' }, ($, e) => {
    const { Text } = $.ui.resolve(e)
    return h(Text, null, 'ENGINE-OWN') as never
  })
  return seen
}

const run = ($: { command: { run: (e: never) => Promise<unknown> } }, command: string, args = '') =>
  $.command.run({ command, args } as never) as Promise<{ text?: string }>


test('/clawd hide hides the band, status line included; /clawd show brings it back', async ($, on) => {
  mock.clock(on)
  const disk: Record<string, unknown> = { save: { ...newSave(always(0.5)), rev: 1 } }
  engine(on, disk)
  await $.session.start(START)
  const band = await $.ui.mount({ plugin: 'clawd-rpg', surface: 'terminal', component: 'AbovePrompt', props: BAND as never })
  expect((await band.findAll({ type: 'Text', text: /Clawd the Newbie/ })).length).toBe(1)

  expect((await run($, 'clawd', 'hide')).text).toContain('hidden')
  expect(disk.hidden).toBe(true)
  expect((await band.findAll({ type: 'Text', text: /Clawd the Newbie/ })).length).toBe(0)
  expect((await band.findAll({ type: 'Text', text: 'ENGINE-OWN' })).length).toBe(1)

  expect((await run($, 'clawd', 'show')).text).toContain('shown again')
  expect(disk.hidden).toBe(false)
  expect((await band.findAll({ type: 'Text', text: /Clawd the Newbie/ })).length).toBe(1)
  await band.unmount()
})

test('hidden, the game keeps playing: a commit still opens a chest and the save moves on, without a toast', async ($, on) => {
  mock.clock(on)
  const disk: Record<string, unknown> = { save: { ...newSave(always(0.5)), rev: 1 } }
  const seen = engine(on, disk)
  await $.session.start(START)
  await run($, 'clawd', 'hide')
  const goldBefore = (disk.save as Save).hero.gold
  await $.tool.call({ tool: 'Bash', command: 'git commit -m "work"' })
  const after = disk.save as Save
  expect(after.hero.gold > goldBefore).toBe(true)
  expect(after.lastGoodChestAt !== undefined).toBe(true)
  expect(after.pendingLuck).toBe('lucky')
  expect(seen.toasts.length).toBe(0)

  await run($, 'clawd', 'show')
  // The last good chest long ago, so this commit opens a good one, which toasts.
  disk.save = { ...(disk.save as Save), lastGoodChestAt: -1e12, rev: ((disk.save as Save).rev ?? 0) + 1 }
  await $.tool.call({ tool: 'Bash', command: 'git commit -m "more work"' })
  expect(seen.toasts.some(t => t.includes('Treasure chest'))).toBe(true)
})

test('hiding closes the character pane if it is open', async ($, on) => {
  mock.clock(on)
  const disk: Record<string, unknown> = { save: { ...newSave(always(0.5)), rev: 1 } }
  const seen = engine(on, disk)
  await $.session.start(START)
  await run($, 'clawd', 'hide')
  expect(seen.closed).toContain('clawd-rpg')
})

test('hidden, the animation clock stops; shown again, it runs', async ($, on) => {
  const clock = mock.clock(on)
  const disk: Record<string, unknown> = { save: { ...newSave(always(0.5)), rev: 1 }, anim: true }
  engine(on, disk)
  const frames: number[] = []
  on('state.set', ($, e, next) => {
    if (e.plugin === 'clawd-rpg' && e.key === 'frame') frames.push(e.value as number)
    return next(e)
  })
  await $.session.start(START)
  await clock.advance(1000)
  expect(frames.length > 0).toBe(true)
  await run($, 'clawd', 'hide')
  const count = frames.length
  await clock.advance(2000)
  expect(frames.length).toBe(count)
  await run($, 'clawd', 'show')
  await clock.advance(1000)
  expect(frames.length > count).toBe(true)
})

test('hiding is remembered: a new session starts hidden', async ($, on) => {
  mock.clock(on)
  const disk: Record<string, unknown> = { save: { ...newSave(always(0.5)), rev: 1 }, hidden: true }
  engine(on, disk)
  await $.session.start(START)
  const band = await $.ui.mount({ plugin: 'clawd-rpg', surface: 'terminal', component: 'AbovePrompt', props: BAND as never })
  expect((await band.findAll({ type: 'Text', text: 'ENGINE-OWN' })).length).toBe(1)
  expect((await band.findAll({ type: 'Text', text: /Clawd/ })).length).toBe(0)
  expect((await run($, 'clawd')).text).toContain('is hidden')
  await band.unmount()
})

test('hidden, /rpg anim is an implicit show: the game reappears with animation on, even if it was on already', async ($, on) => {
  mock.clock(on)
  const disk: Record<string, unknown> = { save: { ...newSave(always(0.5)), rev: 1 }, anim: true, hidden: true }
  engine(on, disk)
  await $.session.start(START)
  expect((await run($, 'rpg', 'anim')).text).toContain('shown again')
  expect(disk.hidden).toBe(false)
  expect(disk.anim).toBe(true)
  const band = await $.ui.mount({ plugin: 'clawd-rpg', surface: 'terminal', component: 'AbovePrompt', props: BAND as never })
  expect((await band.findAll({ type: 'Text', text: /Clawd the Newbie/ })).length).toBe(1)
  await band.unmount()
})

test('hidden, /rpg anim with animation off shows the game and turns animation on', async ($, on) => {
  mock.clock(on)
  const disk: Record<string, unknown> = { save: { ...newSave(always(0.5)), rev: 1 }, anim: false, hidden: true }
  engine(on, disk)
  await $.session.start(START)
  await run($, 'rpg', 'anim')
  expect(disk.hidden).toBe(false)
  expect(disk.anim).toBe(true)
})

test('hidden, /rpg pixelart is an implicit show that lands on pixel art, from either style', async ($, on) => {
  mock.clock(on)
  const disk: Record<string, unknown> = { save: { ...newSave(always(0.5)), rev: 1 }, hidden: true, style: 'pixel', anim: false }
  engine(on, disk)
  await $.session.start(START)
  expect((await run($, 'rpg', 'pixelart')).text).toContain('shown again')
  expect(disk.hidden).toBe(false)
  expect(disk.style).toBe('pixel')
  expect(disk.anim).toBe(true)
  // Hidden again from text art: the implicit show still lands on pixel art.
  disk.style = 'ascii'
  await run($, 'clawd', 'hide')
  await run($, 'rpg', 'pixelart')
  expect(disk.hidden).toBe(false)
  expect(disk.style).toBe('pixel')
})

test('shown, /rpg anim and /rpg pixelart toggle as before, and other /rpg commands leave a hidden game hidden', async ($, on) => {
  mock.clock(on)
  const disk: Record<string, unknown> = { save: { ...newSave(always(0.5)), rev: 1 }, anim: true, style: 'pixel' }
  engine(on, disk)
  await $.session.start(START)
  await run($, 'rpg', 'anim')
  expect(disk.anim).toBe(false)
  await run($, 'rpg', 'pixelart')
  expect(disk.style).toBe('ascii')
  await run($, 'clawd', 'hide')
  await run($, 'rpg', 'reset')
  expect(disk.hidden).toBe(true)
})
