import type { On } from 'claude-code'
import { type Engine, expect, mock, test } from 'claude-code/testing'

import type { Save } from '../types'
import { newSave } from './engine'
import { readSave } from './format'

const always = (value: number) => () => value
const START = { cwd: '/tmp', surface: 'terminal', isInteractive: true } as const
const BAND = { hasSurvey: false, isWorking: false, maxRows: 20, bodyColumns: 60, scroll: { offset: 0, bodyRows: 19 } }

// ── Reading a stored value ───────────────────────────────────────────

test('a stored value reads as nothing yet, a save to play, one from a newer build, or unreadable', () => {
  const save = { ...newSave(always(0.5)), rev: 4 }
  expect(readSave(undefined).kind).toBe('empty')
  expect(readSave(null).kind).toBe('empty')
  expect(readSave(save)).toEqual({ kind: 'ok', save, from: 1 })
  expect(readSave({ ...save, version: 2 })).toEqual({ kind: 'newer', format: 2 })
  for (const junk of ['save', 7, {}, { version: '1' }, { version: 0 }, { version: 1.5 }, { ...save, hero: null }, { ...save, log: 'x' }])
    expect(readSave(junk).kind).toBe('unreadable')
})

test('an older save is migrated up one step at a time; a missing or failing step makes it unreadable', () => {
  const v1 = { ...newSave(always(0.5)), rev: 4 } as unknown as Record<string, unknown>
  const steps = { 1: (s: Record<string, unknown>) => ({ ...s, a: 1 }), 2: (s: Record<string, unknown>) => ({ ...s, b: (s.a as number) + 1 }) }
  const read = readSave(v1, 3, steps)
  expect(read.kind).toBe('ok')
  if (read.kind === 'ok') {
    expect(read.from).toBe(1)
    expect(read.save as unknown).toEqual({ ...v1, a: 1, b: 2, version: 3 })
  }
  expect(readSave(v1, 3, { 1: steps[1] }).kind).toBe('unreadable')
  expect(readSave(v1, 2, { 1: () => { throw new Error('bad') } }).kind).toBe('unreadable')
})

// ── Through the hooks ─────────────────────────────────────────────────

function engineBeneath(on: On, disk: Record<string, unknown>) {
  on('session.start', (_$, e) => ({ cwd: e.cwd }))
  on('command.register', () => ({ value: { command: 'rpg' } }))
  on('store.get', (_$, e) => ({ value: disk[e.key] }))
  on('store.set', (_$, e) => {
    disk[e.key] = e.value
    return { value: undefined }
  })
  on('store.delete', (_$, e) => {
    delete disk[e.key]
    return { value: undefined }
  })
  on('tool.call', { tool: 'Bash' }, () => ({ result: { stdout: '', stderr: '', interrupted: false }, text: 'ok' }) as never)
  on('ui.panes', () => ({ value: [] }) as never)
  on('ui.open', () => ({ value: { isPlaced: true } }) as never)
  on('session.surfaces', () => ({ value: ['terminal'] }) as never)
  on('ui.render', { component: 'AbovePrompt' }, ($, e) => {
    const { Text } = $.ui.resolve(e)
    return h(Text, null, 'ENGINE-OWN') as never
  })
}

const run = ($: Engine, args: string) => $.command.run({ command: 'rpg', args } as never) as Promise<{ text?: string }>

async function bandText($: Engine) {
  const mounted = await $.ui.mount({ plugin: 'clawd-rpg', surface: 'terminal', component: 'AbovePrompt', props: BAND as never })
  const text = (await mounted.findAll({ type: 'Text' })).map(t => t.text).join('')
  await mounted.unmount()
  return text
}

/** Everything that writes the save in play: a Bash success (luck) and a commit (a chest). */
async function play($: Engine) {
  await $.tool.call({ tool: 'Bash', command: 'true' })
  await $.tool.call({ tool: 'Bash', command: 'git commit -m "work"' })
}

test('a session meeting a save from a newer version pauses: it never plays, resets or writes it', async ($, on) => {
  mock.clock(on)
  const newer = { ...newSave(always(0.5)), version: 2, rev: 9, hero: { ...newSave(always(0.5)).hero, level: 30 }, shiny: true }
  const disk: Record<string, unknown> = { save: newer }
  engineBeneath(on, disk)
  await $.session.start(START)
  expect(await bandText($)).toContain('newer version')
  await play($)
  expect((await run($, '')).text).toContain('/reload-plugins')
  expect((await run($, 'reset')).text).toContain('Nothing was changed')
  expect((await run($, 'reset confirm')).text).toContain('Nothing was reset')
  disk['save-backup'] = { ...newSave(always(0.5)), rev: 1 }
  expect((await run($, 'reset undo')).text).toContain('Nothing was changed')
  expect(disk.save).toBe(newer)
})

test('a save upgraded by another session mid-play pauses this one at its next write, and it resumes when the save is readable again', async ($, on) => {
  const clock = mock.clock(on)
  const disk: Record<string, unknown> = { save: { ...newSave(always(0.5)), rev: 1 } }
  engineBeneath(on, disk)
  await $.session.start(START)
  expect(await bandText($)).toContain('Clawd the Newbie')
  const newer = { ...(disk.save as Save), version: 2, rev: 50 }
  disk.save = newer
  await play($)
  expect(disk.save).toBe(newer)
  expect(await bandText($)).toContain('newer version')
  disk.save = { ...newSave(always(0.5)), rev: 51 }
  await clock.advance(3100)
  expect(await bandText($)).toContain('Clawd the Newbie')
})

test('the sync alone notices a newer save, before this session writes anything', async ($, on) => {
  const clock = mock.clock(on)
  const disk: Record<string, unknown> = { save: { ...newSave(always(0.5)), rev: 1 } }
  engineBeneath(on, disk)
  await $.session.start(START)
  disk.save = { ...(disk.save as Save), version: 2, rev: 2 }
  await clock.advance(3100)
  expect(await bandText($)).toContain('newer version')
})

test('an unreadable save is never written over by play; /rpg reset confirm keeps it aside and starts anew', async ($, on) => {
  mock.clock(on)
  const junk = { version: 1, hero: 'garbled' }
  const disk: Record<string, unknown> = { save: junk }
  engineBeneath(on, disk)
  await $.session.start(START)
  expect(await bandText($)).toContain("can't be read")
  await play($)
  expect(disk.save).toBe(junk)
  expect((await run($, 'reset')).text).toContain('save-unreadable')
  expect((await run($, 'reset confirm')).text).toContain('kept in the store under save-unreadable')
  expect(disk['save-unreadable']).toEqual(junk)
  expect((disk.save as Save).hero.level).toBe(1)
  expect(await bandText($)).toContain('Clawd the Newbie')
})

test('with nothing stored, a new hero still starts and is saved on the first write', async ($, on) => {
  mock.clock(on)
  const disk: Record<string, unknown> = {}
  engineBeneath(on, disk)
  await $.session.start(START)
  expect(await bandText($)).toContain('Clawd the Newbie')
  await play($)
  expect(readSave(disk.save).kind).toBe('ok')
})

test('reset and undo still back up and restore a readable save', async ($, on) => {
  mock.clock(on)
  const hero = { ...newSave(always(0.5)), rev: 3, hero: { ...newSave(always(0.5)).hero, level: 9 } }
  const disk: Record<string, unknown> = { save: hero }
  engineBeneath(on, disk)
  await $.session.start(START)
  await run($, 'reset')
  expect((await run($, 'reset confirm')).text).toContain('level 9')
  expect((disk.save as Save).hero.level).toBe(1)
  expect((disk.save as Save).rev).toBe(4)
  expect((await run($, 'reset undo')).text).toContain('level 9')
  expect((disk.save as Save).hero.level).toBe(9)
  expect(disk['save-backup']).toBe(undefined)
})
