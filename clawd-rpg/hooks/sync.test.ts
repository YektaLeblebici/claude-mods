import type { On } from 'claude-code'
import { expect, mock, test } from 'claude-code/testing'

import type { Save } from '../types'
import { newSave } from './engine'
import { mutate, revOf, type SaveIO } from './sync'

const always = (value: number) => () => value
const START = { cwd: '/tmp', surface: 'terminal', isInteractive: true } as const

/** What the engine answers beneath the plugin when a session starts. */
function engineStart(on: On) {
  on('session.start', (_$, e) => ({ cwd: e.cwd }))
  on('command.register', () => ({ value: { command: 'rpg' } }))
}

/** The plugin's store on disk, which another session can write to directly. */
function diskStore(on: On, disk: Record<string, unknown>) {
  on('store.get', (_$, e) => ({ value: disk[e.key] }))
  on('store.set', (_$, e) => {
    disk[e.key] = e.value
    return { value: undefined }
  })
}

const levelUp = (s: Save) => ({ save: { ...s, hero: { ...s.hero, level: s.hero.level + 1 } }, extra: null })

/** A store another session writes to: `interloper` runs once, between this session's read and its write. */
function sharedStore(start: Save, interloper?: (s: Save) => Save) {
  let disk: Save | undefined = start
  let writes = 0
  let reads = 0
  const io: SaveIO = {
    read: async () => {
      reads++
      return disk!
    },
    peekRev: async () => {
      if (interloper && reads === 1) disk = { ...interloper(disk!), rev: revOf(disk) + 1 }
      return revOf(disk)
    },
    write: async s => {
      writes++
      disk = s
    },
  }
  return { io, disk: () => disk!, writes: () => writes }
}

/**
 * One store several sessions write to at once: every read, check and write gives the others a turn,
 * and `lock`, when given, is a lock they share.
 */
function racingStore(start: Save, isLocked: boolean) {
  let disk: Save = start
  const turn = async () => {
    for (let i = 0; i < 3; i++) await Promise.resolve()
  }
  let held: Promise<void> = Promise.resolve()
  const lock = async () => {
    let free!: () => void
    const mine = new Promise<void>(resolve => (free = resolve))
    const before = held
    held = before.then(() => mine)
    await before
    return async () => free()
  }
  const io: SaveIO = {
    read: async () => (await turn(), disk),
    peekRev: async () => (await turn(), revOf(disk)),
    write: async s => {
      await turn()
      disk = s
    },
    ...(isLocked ? { lock } : {}),
  }
  return { io, disk: () => disk }
}

test('with the lock, five sessions writing at once all keep their change', async () => {
  const store = racingStore({ ...newSave(always(0.5)), rev: 1 }, true)
  await Promise.all(Array.from({ length: 5 }, () => mutate(store.io, levelUp)))
  expect(store.disk().hero.level).toBe(6)
  expect(store.disk().rev).toBe(6)
})

test('without the lock, the same race loses changes: why the lock is taken', async () => {
  const store = racingStore({ ...newSave(always(0.5)), rev: 1 }, false)
  await Promise.all(Array.from({ length: 5 }, () => mutate(store.io, levelUp)))
  expect(store.disk().hero.level < 6).toBe(true)
})

test('the save is locked across sessions with a directory: made before writing, removed after', async ($, on) => {
  const clock = mock.clock(on)
  const disk: Record<string, unknown> = { save: { ...newSave(always(0.5)), rev: 1 } }
  engineStart(on)
  diskStore(on, disk)
  mock.env(on, { HOME: '/home/x' })
  const dirs = new Set<string>()
  const ran: string[] = []
  on('process.run', (_$, e) => {
    const [cmd, path] = e.argv as string[]
    ran.push(`${cmd} ${path}`)
    if (cmd === 'mkdir' && dirs.has(path!)) return { value: { exitCode: 1, stdout: '', stderr: 'File exists' } } as never
    if (cmd === 'mkdir') dirs.add(path!)
    if (cmd === 'rmdir') dirs.delete(path!)
    return { value: { exitCode: 0, stdout: '', stderr: '' } } as never
  })
  // A lock a crashed session left a minute ago: stale, so it is taken over.
  const LOCK = '/home/x/.claude/plugins/clawd-rpg.lock'
  dirs.add(LOCK)
  on('fs.stat', (_$, e) => (dirs.has(e.path) ? ({ value: { kind: 'dir', size: 0, mtimeMs: Date.now() - 60_000 } } as never) : (() => { throw new Error('ENOENT') })()))
  on('tool.call', { tool: 'Bash' }, () => ({ result: { stdout: '', stderr: '', interrupted: false }, text: 'ok' }) as never)
  await $.session.start(START)
  await $.tool.call({ tool: 'Bash', command: 'true' })
  await clock.settle()

  expect((disk.save as Save).pendingLuck).toBe('lucky')
  expect(ran).toEqual([`mkdir ${LOCK}`, `rmdir ${LOCK}`, `mkdir ${LOCK}`, `rmdir ${LOCK}`])
  expect(dirs.has(LOCK)).toBe(false)
})

test('a change redoes itself on the save another session just wrote', async () => {
  const start = { ...newSave(always(0.5)), rev: 4 }
  const store = sharedStore(start, s => ({ ...s, hero: { ...s.hero, gold: 999 } }))
  const result = await mutate(store.io, levelUp)
  expect(result.tries).toBe(2)
  expect(store.writes()).toBe(1)
  expect(store.disk().rev).toBe(6)
  // Both sessions' work survives: the other's gold and this one's level.
  expect(store.disk().hero.gold).toBe(999)
  expect(store.disk().hero.level).toBe(2)
})

test('with no other writer, a change writes once, one revision on', async () => {
  const store = sharedStore({ ...newSave(always(0.5)), rev: 7 })
  const result = await mutate(store.io, levelUp)
  expect(result.tries).toBe(1)
  expect(store.disk().rev).toBe(8)
})

test('after its last attempt a change writes even if the store moved', async () => {
  let rev = 0
  const io: SaveIO = {
    read: async () => ({ ...newSave(always(0.5)), rev }),
    peekRev: async () => ++rev + 100,
    write: async () => undefined,
  }
  const result = await mutate(io, levelUp, 3)
  expect(result.tries).toBe(3)
})

test('a save another session wrote shows here within one sync', async ($, on) => {
  const clock = mock.clock(on)
  const mine = { ...newSave(always(0.5)), rev: 1 }
  const disk: Record<string, unknown> = { save: mine }
  diskStore(on, disk)
  engineStart(on)
  await $.session.start(START)
  disk.save = { ...mine, rev: 2, hero: { ...mine.hero, level: 9 } } satisfies Save
  const props = { hasSurvey: false, isWorking: false, maxRows: 20, bodyColumns: 100, scroll: { offset: 0, bodyRows: 19 } }
  const band = await $.ui.mount({ plugin: 'clawd-rpg', surface: 'terminal', component: 'AbovePrompt', props: props as never })
  expect((await band.findAll({ type: 'Text', text: /Lv1 / })).length).toBe(1)
  await clock.advance(3100)
  expect((await band.findAll({ type: 'Text', text: /Lv9 / })).length).toBe(1)
  await band.unmount()
})

test('the full view chosen in another session starts here within one sync, and its frames advance', async ($, on) => {
  const clock = mock.clock(on)
  const disk: Record<string, unknown> = { save: { ...newSave(always(0.5)), rev: 1 } }
  diskStore(on, disk)
  const frames: number[] = []
  on('state.set', ($, e, next) => {
    if (e.plugin === 'clawd-rpg' && e.key === 'frame') frames.push(e.value as number)
    return next(e)
  })
  engineStart(on)
  await $.session.start(START)
  disk.view = 'show'
  await clock.advance(3100)
  // The band is drawn, so the clock has someone to animate for.
  const props = { hasSurvey: false, isWorking: false, maxRows: 20, bodyColumns: 60, scroll: { offset: 0, bodyRows: 19 } }
  const band = await $.ui.mount({ plugin: 'clawd-rpg', surface: 'terminal', component: 'AbovePrompt', props: props as never })
  await clock.advance(1000)
  await band.unmount()
  expect(frames.length >= 2).toBe(true)
  expect(frames[frames.length - 1]! > frames[0]!).toBe(true)
})
