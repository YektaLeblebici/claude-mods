import { expect, test } from 'claude-code/testing'

import type { LegendId, Save } from '../types'
import { COMMON_PETS, LEGENDS, PETS } from './content'
import { gainPet, makeEnemy, newSave, tick, wildCharacters } from './engine'
import { composePixelScene } from './pixel'
import { PET_Q } from './quarterart'
import { composeScene } from './scene'

const always = (value: number) => () => value
const atLevel = (level: number, beaten: LegendId[] = []): Save => {
  const s = newSave(always(0.5))
  return { ...s, hero: { ...s.hero, level }, legendsBeaten: beaten }
}
const AVG = { name: 'Average', desc: '', hp: 1, atk: 1, def: 1, verbs: ['hits', 'hits'] as [string, string] }

test('wild characters never appear below their level', () => {
  // 0 rolls an encounter and the wild-character chance every time.
  const { save } = tick(atLevel(4), always(0))
  expect(save.phase).toBe('fighting')
  expect(save.enemy?.legend).toBe(undefined)
  expect(wildCharacters(atLevel(4)).length).toBe(0)
  expect(wildCharacters(atLevel(12)).map(l => l.id)).toEqual(['tim'])
  expect(wildCharacters(atLevel(30)).length).toBe(LEGENDS.length)
  for (const legend of LEGENDS) {
    expect(wildCharacters(atLevel(legend.minLevel - 1)).some(l => l.id === legend.id)).toBe(false)
    expect(wildCharacters(atLevel(legend.minLevel)).some(l => l.id === legend.id)).toBe(true)
  }
})

test('a wild character is always introduced with "A wild … appears!", and announced', () => {
  const { save, toasts, fx } = tick(atLevel(5), always(0))
  expect(save.enemy?.legend).toBe('tim')
  expect(save.log.at(-1)!.text.startsWith('A wild Tim Apple appears!')).toBe(true)
  expect(toasts).toContain('A wild Tim Apple appears!')
  expect(fx).toContain('legend')
})

test('without the rare roll, a regular enemy turns up instead', () => {
  // 0.005 meets someone; 0.5 for the wild-character chance misses it.
  let calls = 0
  const rng = () => (++calls === 2 ? 0.5 : 0.005)
  const { save } = tick(atLevel(30), rng)
  expect(save.phase).toBe('fighting')
  expect(save.enemy?.legend).toBe(undefined)
})

test('wild characters are tougher than elites, which are tougher than the usual enemy', () => {
  const hero = atLevel(20).hero
  const normal = makeEnemy(always(0.5), 20, AVG, 'normal', hero)
  const elite = makeEnemy(always(0.5), 20, AVG, 'elite', hero)
  const wild = makeEnemy(always(0.5), 20, AVG, 'legend', hero)
  expect(wild.maxHp > elite.maxHp && elite.maxHp > normal.maxHp).toBe(true)
  expect(wild.atk > elite.atk && elite.atk > normal.atk).toBe(true)
  expect(wild.xp > elite.xp).toBe(true)
})

test('once beaten, a wild character joins as a pet and never appears again', () => {
  const base = atLevel(5)
  const s: Save = {
    ...base,
    phase: 'fighting',
    enemy: { ...makeEnemy(always(0.5), 1, LEGENDS[0]!, 'legend', base.hero), legend: 'tim', hp: 1 },
  }
  const { save, toasts } = tick(s, always(0.5))
  expect(save.phase).toBe('exploring')
  expect(save.legendsBeaten).toEqual(['tim'])
  expect(save.hero.pets?.some(p => p.id === 'tim')).toBe(true)
  expect(save.log.some(l => l.text.startsWith('Tim Apple joins as a pet!'))).toBe(true)
  expect(toasts).toContain('New pet: Tim Apple')
  // Beaten, Tim Apple is not among those Clawd can meet; at level 5 nobody else is either.
  expect(wildCharacters(save).length).toBe(0)
  expect(tick(save, always(0)).save.enemy?.legend).toBe(undefined)
})

test('a wild character that knocks Clawd out can turn up again later', () => {
  const base = atLevel(5)
  const s: Save = {
    ...base,
    phase: 'fighting',
    hero: { ...base.hero, hp: 1, potions: 0 },
    enemy: { ...makeEnemy(always(0.5), 1, LEGENDS[0]!, 'legend', base.hero), legend: 'tim', hp: 9999, maxHp: 9999 },
  }
  const { save } = tick(s, always(0.99))
  expect(save.phase).toBe('recovering')
  expect(save.legendsBeaten).toEqual([])
  expect(wildCharacters(save).some(l => l.id === 'tim')).toBe(true)
})

test('chests, bosses and the road never hand out a wild character as a pet', () => {
  for (const legend of LEGENDS) expect(COMMON_PETS.includes(legend.id)).toBe(false)
  expect(COMMON_PETS.length).toBe(Object.keys(PETS).length - LEGENDS.length)
})

test('battle text names a wild character by name, without "the"', () => {
  const base = atLevel(15)
  const s: Save = { ...base, phase: 'fighting', enemy: { ...makeEnemy(always(0.5), 3, LEGENDS[1]!, 'legend', base.hero), legend: 'tarbolts' } }
  const text = tick(s, always(0.5)).save.log.map(l => l.text).join(' | ')
  expect(text).toContain('Linux Tarbolts')
  expect(/the Linux Tarbolts/i.test(text)).toBe(false)
})

test('every wild character has its own pet look, drawn in both art styles', () => {
  for (const legend of LEGENDS) {
    expect(PETS[legend.id].art.length).toBe(2)
    expect(PET_Q[legend.id].length).toBe(4)
    const s = atLevel(legend.minLevel)
    gainPet(s, legend.id, [], [])
    expect(s.hero.activePet).toBe(legend.id)
    for (const compose of [composeScene, composePixelScene]) {
      const rows = compose(s, 1, null, 60)
      expect(rows.length).toBe(6)
      for (const row of rows) expect([...row.map(seg => seg.text).join('')].length).toBe(60)
    }
  }
})
