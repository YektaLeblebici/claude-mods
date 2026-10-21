import { expect, test } from 'claude-code/testing'

import type { Save } from '../types'
import { BIOMES } from './content'
import { bossItem, inSeason, makeEnemy, makeZone, newSave, tick } from './engine'
import { archetypeOf } from './scene'

const always = (value: number) => () => value
/** A seeded generator (mulberry32), for rates measured over many rolls. */
function seeded(seed: number) {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}
/** Noon on a day of 2026 (months from 1), local time. */
const on = (month: number, day: number) => new Date(2026, month - 1, day, 12).getTime()
const HALLOWEEN = BIOMES.find(b => b.id === 'halloween')!
const ITEMS = HALLOWEEN.bosses.map(b => b.item!.name)

test('the Halloween season runs from October 15 to November 15, both days included', () => {
  const season = HALLOWEEN.season!
  expect(inSeason(season, on(10, 14))).toBe(false)
  expect(inSeason(season, on(10, 15))).toBe(true)
  expect(inSeason(season, on(10, 31))).toBe(true)
  expect(inSeason(season, on(11, 15))).toBe(true)
  expect(inSeason(season, on(11, 16))).toBe(false)
})

test('the seasonal worlds open on their own dates: Halloween in October, Christmas in December, both on November 15', () => {
  const opens = (now: number) => {
    const rng = seeded(3)
    const seen = new Set<string>()
    for (let i = 0; i < 3000; i++) seen.add(makeZone(rng, 3, 'meadow', now).biome)
    return { halloween: seen.has('halloween'), christmas: seen.has('christmas') }
  }
  expect(opens(on(10, 31))).toEqual({ halloween: true, christmas: false })
  expect(opens(on(11, 15))).toEqual({ halloween: true, christmas: true })
  expect(opens(on(12, 10))).toEqual({ halloween: false, christmas: true })
  expect(opens(on(7, 1))).toEqual({ halloween: false, christmas: false })
})

test('its monsters and bosses appear only there, and look the part', () => {
  expect(HALLOWEEN.enemies.map(e => e.name)).toEqual(["Jack-o'-Lantern", 'Poltergeist', 'Candy Ghoul'])
  expect(HALLOWEEN.bosses.map(b => b.name)).toEqual(['The Headless Horseman', 'Old Grizelda'])
  const elsewhere = BIOMES.filter(b => b !== HALLOWEEN).flatMap(b => [...b.enemies, ...b.bosses].map(e => e.name))
  for (const e of [...HALLOWEEN.enemies, ...HALLOWEEN.bosses]) expect(elsewhere.includes(e.name)).toBe(false)
  expect(archetypeOf({ name: 'Poltergeist', isBoss: false })).toBe('spirit')
})

/** Beats a boss of `biome` once (it has 1 HP left) and gives back the log of that win. */
function beat(biome: string, name: string, rng: () => number): string {
  const base = newSave(always(0.5))
  const boss = BIOMES.find(b => b.id === biome)!.bosses.find(b => b.name === name)!
  const s: Save = { ...base, zone: { ...base.zone, biome, depth: 6 }, phase: 'fighting', enemy: { ...makeEnemy(always(0.5), 6, boss, 'boss', base.hero), hp: 1 } }
  const { save } = tick(s, rng)
  expect(save.enemy).toBe(null)
  return save.log.map(l => l.text).join('\n')
}

test('each Halloween boss gives its own legendary one time in ten', () => {
  for (const boss of HALLOWEEN.bosses) {
    const rng = seeded(boss.name.length)
    const N = 3000
    let got = 0
    for (let i = 0; i < N; i++) {
      const log = beat('halloween', boss.name, rng)
      if (log.includes(`legendary ${boss.item!.name}`)) got++
      // Never the other boss's item.
      for (const other of ITEMS.filter(n => n !== boss.item!.name)) expect(log.includes(other)).toBe(false)
    }
    expect(Math.abs(got / N - 0.1) < 0.02).toBe(true)
  }
})

test('the Halloween items drop nowhere else', () => {
  const rng = seeded(9)
  for (const [biome, name] of [['christmas', 'Santa Claus'], ['meadow', 'The Harvest King'], ['woods', 'The Elder Bark']] as const)
    for (let i = 0; i < 500; i++) {
      const log = beat(biome, name, rng)
      for (const item of ITEMS) expect(log.includes(item)).toBe(false)
    }
})

test('a boss item is a legendary with its own name, slot and effects, a level deeper than where it drops', () => {
  const horseman = HALLOWEEN.bosses[0]!.item!
  const blade = bossItem(always(0.5), 10, horseman)
  expect(blade).toEqual({ name: "Hollowhead, the Horseman's Blade", slot: 'weapon', rarity: 'legendary', power: 46, affixes: ['keen', 'vampiric', 'thorns'], score: 55 })
  const cat = bossItem(always(0.5), 10, HALLOWEEN.bosses[1]!.item!)
  expect([cat.name, cat.slot, cat.affixes]).toEqual(["Grizelda's Black Cat", 'trinket', ['fortunate', 'keen', 'warding']])
  // The same item made twice is two items: equipping one never changes the other.
  expect(bossItem(always(0.5), 10, horseman).affixes === blade.affixes).toBe(false)
})
