import { expect, mock, test } from 'claude-code/testing'

import type { PetId, Save } from '../types'
import { PETS } from './content'
import { newSave } from './engine'

const always = (value: number) => () => value
const START = { cwd: '/tmp', surface: 'terminal', isInteractive: true } as const

test('a Bash call never waits for the game: it returns even while the game is stuck', async ($, on) => {
  mock.clock(on)
  // Storage that never answers: the game step started by the call can never finish.
  on('store.get', () => new Promise(() => {}) as never)
  on('tool.call', { tool: 'Bash' }, () => ({ result: { stdout: 'ok', stderr: '', interrupted: false }, text: 'ok' }) as never)
  const ran = await $.tool.call({ tool: 'Bash', command: 'git commit -m "work"' })
  expect((ran as { text?: string }).text).toBe('ok')
})

test('the pane counts only the pets it shows', async ($, on) => {
  const clock = mock.clock(on)
  const base = newSave(always(0.5))
  const save: Save = { ...base, rev: 1, hero: { ...base.hero, pets: [{ id: 'slime', level: 1 }, { id: 'unicorn' as PetId, level: 1 }], activePet: 'slime' } }
  const disk: Record<string, unknown> = { save, view: 'mini' }
  on('store.get', (_$, e) => ({ value: disk[e.key] }))
  on('store.set', (_$, e) => {
    disk[e.key] = e.value
    return { value: undefined }
  })
  on('session.start', (_$, e) => ({ cwd: e.cwd }))
  on('command.register', () => ({ value: { command: 'rpg' } }))
  on('session.surfaces', () => ({ value: ['terminal'] }) as never)
  await $.session.start(START)
  await clock.settle()
  const pane = await $.ui.mount({ plugin: 'clawd-rpg', surface: 'terminal', component: 'Pane', requestId: 'clawd-rpg', props: {} as never })
  const text = (await pane.findAll({ type: 'Text' })).map(t => t.text).join('\n')
  await pane.unmount()
  expect(text).toContain(`Pets 1/${Object.keys(PETS).length}`)
})

test('an old view setting is read once and kept as the view; the sync then reads only the view', async ($, on) => {
  const clock = mock.clock(on)
  const disk: Record<string, unknown> = { save: { ...newSave(always(0.5)), rev: 1 }, anim: true }
  const reads: string[] = []
  on('store.get', (_$, e) => {
    reads.push(e.key)
    return { value: disk[e.key] }
  })
  on('store.set', (_$, e) => {
    disk[e.key] = e.value
    return { value: undefined }
  })
  on('session.start', (_$, e) => ({ cwd: e.cwd }))
  on('command.register', () => ({ value: { command: 'rpg' } }))
  on('session.surfaces', () => ({ value: ['terminal'] }) as never)
  await $.session.start(START)
  expect(disk.view).toBe('show')
  reads.length = 0
  await clock.advance(3 * 3100)
  expect(reads.includes('view')).toBe(true)
  expect(reads.includes('anim') || reads.includes('hidden')).toBe(false)
})
