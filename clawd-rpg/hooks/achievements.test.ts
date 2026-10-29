import { expect, mock, test } from 'claude-code/testing'

import type { Save } from '../types'
import { ACHIEVEMENTS, BIOMES } from './content'
import { achievementLines, makeEnemy, newSave, tick } from './engine'

const always = (value: number) => () => value
/** Noon on October 29, 2026, local time. */
const OCT_29 = new Date(2026, 9, 29, 12).getTime()

/** A fight Clawd wins this tick: the foe has 1 HP left. */
function lastBlow(s: Save, biome: string, foeName: string, isBoss: boolean): Save {
  const world = BIOMES.find(b => b.id === biome)!
  const def = [...world.enemies, ...world.bosses].find(e => e.name === foeName)!
  return { ...s, zone: { ...s.zone, biome, depth: 12, name: world.names[0]! }, phase: 'fighting', enemy: { ...makeEnemy(always(0.5), 12, def, isBoss ? 'boss' : 'normal', s.hero), hp: 1 } }
}

test('the 100th kill keeps its story: when, where, and the foe that fell', () => {
  const base = newSave(always(0.5))
  const s = lastBlow({ ...base, achievements: ['first-blood'], stats: { ...base.stats, kills: 99 } }, 'swamp', 'Bog Leech', false)
  const { save } = tick(s, always(0.5), OCT_29)
  expect(save.achievements).toContain('centurion')
  expect(save.achievementStories?.centurion).toEqual({ at: OCT_29, depth: 12, zone: 'Rotmire Bog', story: 'felling the Bog Leech, foe number 100' })
  expect(achievementLines(save, 'centurion')).toEqual([
    '“They started counting. You never stopped.”',
    'Earned Oct 29 at depth 12 in Rotmire Bog: felling the Bog Leech, foe number 100.',
  ])
})

test('a boss is named as itself in its story', () => {
  const base = newSave(always(0.5))
  const s = lastBlow({ ...base, achievements: ['first-blood'], stats: { ...base.stats, kills: 5, bosses: 9 } }, 'sprawl', 'Mama Voltage, Queen of the Sprawl', true)
  const { save } = tick(s, always(0.5), OCT_29)
  expect(save.achievementStories?.['boss-hunter']?.story).toBe('toppling Mama Voltage, Queen of the Sprawl, boss number 10')
})

test('an achievement earned before stories were kept shows its flavor and what it takes', () => {
  const s: Save = { ...newSave(always(0.5)), achievements: ['centurion'] }
  expect(achievementLines(s, 'centurion')).toEqual(['“They started counting. You never stopped.”', 'Defeat 100 enemies. Earned before Clawd kept a journal.'])
})

test('every achievement has flavor, and a story that can be told from any save', () => {
  const s = newSave(always(0.5))
  for (const a of ACHIEVEMENTS) {
    expect(a.flavor.length > 10, a.id).toBe(true)
    expect(typeof a.story(s, s), a.id).toBe('string')
  }
})

test('in the pane, an achievement opens its story when pressed, and closes when pressed again', async ($, on) => {
  const clock = mock.clock(on)
  const base = newSave(always(0.5))
  const save: Save = {
    ...base,
    rev: 1,
    achievements: ['first-blood', 'centurion'],
    achievementStories: { centurion: { at: OCT_29, depth: 12, zone: 'Rotmire Bog', story: 'felling the Bog Leech, foe number 100' } },
  }
  const disk: Record<string, unknown> = { save, view: 'mini' }
  on('store.get', (_$, e) => ({ value: disk[e.key] }))
  on('store.set', (_$, e) => {
    disk[e.key] = e.value
    return { value: undefined }
  })
  on('session.start', (_$, e) => ({ cwd: e.cwd }))
  on('command.register', () => ({ value: { command: 'rpg' } }))
  on('session.surfaces', () => ({ value: ['terminal'] }) as never)
  await $.session.start({ cwd: '/tmp', surface: 'terminal', isInteractive: true })
  await clock.settle()

  const pane = await $.ui.mount({ plugin: 'clawd-rpg', surface: 'terminal', component: 'Pane', requestId: 'clawd-rpg', props: {} as never })
  const shown = async () => (await pane.findAll({ type: 'Text' })).map(t => t.text).join('\n')
  expect(await shown()).not.toContain('They started counting')

  await pane.press({ key: 'ach-centurion' })
  expect(await shown()).toContain('They started counting. You never stopped.')
  expect(await shown()).toContain('Earned Oct 29 at depth 12 in Rotmire Bog: felling the Bog Leech, foe number 100.')

  // Another one replaces it; pressing that one again closes it.
  await pane.press({ key: 'ach-first-blood' })
  expect(await shown()).not.toContain('They started counting')
  expect(await shown()).toContain('Everyone remembers their first.')
  await pane.press({ key: 'ach-first-blood' })
  expect(await shown()).not.toContain('Everyone remembers their first.')
  await pane.unmount()
})
