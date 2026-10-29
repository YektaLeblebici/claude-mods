import { expect, test } from 'claude-code/testing'

import type { PetId, Save } from '../types'
import { BIOMES, COMMON_PETS, PETS } from './content'
import { inSeason, makeEnemy, makeZone, newSave, petBonus, tick } from './engine'
import { composePixelScene } from './pixel'
import { PET_Q } from './quarterart'

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
const on = (month: number, day: number, year = 2026) => new Date(year, month - 1, day, 12).getTime()
const XMAS = BIOMES.find(b => b.id === 'christmas')!

test('the Christmas season runs from November 15 to January 15, both days included', () => {
  const season = XMAS.season!
  expect(inSeason(season, on(11, 14))).toBe(false)
  expect(inSeason(season, on(11, 15))).toBe(true)
  expect(inSeason(season, on(12, 25))).toBe(true)
  expect(inSeason(season, on(1, 1, 2027))).toBe(true)
  expect(inSeason(season, on(1, 15, 2027))).toBe(true)
  expect(inSeason(season, on(1, 16, 2027))).toBe(false)
  expect(inSeason(season, on(7, 1))).toBe(false)
  expect(inSeason({ from: [6, 1], to: [6, 30] }, on(6, 10))).toBe(true)
  expect(inSeason({ from: [6, 1], to: [6, 30] }, on(12, 10))).toBe(false)
})

test('in season, the Christmas world is as likely as any other; out of season, or with no date, never', () => {
  const rng = seeded(7)
  const share = (now?: number) => {
    let n = 0
    for (let i = 0; i < 6000; i++) if (makeZone(rng, 3, 'meadow', now).biome === 'christmas') n++
    return n / 6000
  }
  // Every world but the last one is open, the seasonal ones only in their season.
  const others = BIOMES.filter(b => b.id !== 'meadow' && (!b.season || inSeason(b.season, on(12, 1)))).length
  expect(Math.abs(share(on(12, 1)) - 1 / others) < 0.02).toBe(true)
  expect(share(on(10, 1))).toBe(0)
  expect(share(undefined)).toBe(0)
  // Never twice in a row, like every other world.
  for (let i = 0; i < 200; i++) expect(makeZone(rng, 3, 'christmas', on(12, 1)).biome === 'christmas').toBe(false)
})

test('moving on from camp in season can lead to the Christmas world, and never out of season', () => {
  const camp = (seed: number, now: number) => tick({ ...newSave(always(0.5)), phase: 'camp' }, seeded(seed), now).save.zone.biome
  const inDecember = Array.from({ length: 300 }, (_, i) => camp(i, on(12, 20)))
  expect(inDecember.includes('christmas')).toBe(true)
  expect(Array.from({ length: 300 }, (_, i) => camp(i, on(3, 20))).includes('christmas')).toBe(false)
})

test('its monsters and bosses appear only there, and Santa Claus is one of its two bosses', () => {
  expect(XMAS.enemies.map(e => e.name)).toEqual(['Gingerbread Brute', 'Snowman Sentry', 'Rogue Elf'])
  expect(XMAS.bosses.map(b => b.name)).toEqual(['Krampus', 'Santa Claus'])
  const elsewhere = BIOMES.filter(b => b !== XMAS).flatMap(b => [...b.enemies, ...b.bosses].map(e => e.name))
  for (const e of [...XMAS.enemies, ...XMAS.bosses]) expect(elsewhere.includes(e.name)).toBe(false)
})

/** Beats a Christmas boss once (it has 1 HP left) and gives back the pets Clawd got from it. */
// The fight each boss starts from, made once: tick works on a copy, so thousands of fights share it.
const fights = new Map<string, Save>()

function beat(name: string, rng: () => number): PetId[] {
  let s = fights.get(name)
  if (!s) {
    const base = newSave(always(0.5))
    const boss = XMAS.bosses.find(b => b.name === name)!
    s = { ...base, zone: { ...base.zone, biome: 'christmas' }, phase: 'fighting', enemy: { ...makeEnemy(always(0.5), 1, boss, 'boss', base.hero), hp: 1 } }
    fights.set(name, s)
  }
  const { save } = tick(s, rng)
  expect(save.enemy).toBe(null)
  return (save.hero.pets ?? []).map(p => p.id)
}

test('beating Santa Claus gives a Christmas pet one time in ten, the Little Reindeer or the Jolly Snowman', () => {
  const rng = seeded(11)
  const got: PetId[] = []
  const N = 4000
  for (let i = 0; i < N; i++) got.push(...beat('Santa Claus', rng))
  const festive = got.filter(id => id === 'reindeer' || id === 'snowman')
  expect(Math.abs(festive.length / N - 0.1) < 0.02).toBe(true)
  expect(festive.includes('reindeer') && festive.includes('snowman')).toBe(true)
  expect(PETS.reindeer.name).toBe('Little Reindeer')
  expect(PETS.snowman.name).toBe('Jolly Snowman')
})

test('Christmas pets come from Santa alone: never from Krampus, chests, other bosses or the road', () => {
  expect(COMMON_PETS.includes('reindeer') || COMMON_PETS.includes('snowman')).toBe(false)
  const rng = seeded(5)
  for (let i = 0; i < 1500; i++) {
    const pets = beat('Krampus', rng)
    expect(pets.includes('reindeer') || pets.includes('snowman')).toBe(false)
  }
})

test('the Christmas pets have their art, and Santa leaves laughing', () => {
  for (const id of ['reindeer', 'snowman'] as const) {
    expect(PET_Q[id].length).toBe(4)
    const s = newSave(always(0.5))
    const rows = composePixelScene({ ...s, hero: { ...s.hero, pets: [{ id, level: 1 }], activePet: id } }, 0, null, 60)
    expect(rows.length > 0).toBe(true)
  }
  expect(XMAS.bosses.find(b => b.name === 'Santa Claus')!.defeat.includes('Ho ho ho!')).toBe(true)
})

test('a pet only a newer version knows gives nothing and breaks nothing', () => {
  const s = newSave(always(0.5))
  const odd: Save = { ...s, hero: { ...s.hero, pets: [{ id: 'unicorn' as PetId, level: 1 }], activePet: 'unicorn' as PetId } }
  expect(petBonus(odd.hero, 'atk')).toBe(0)
  expect(tick(odd, always(0.5)).save.hero.level).toBe(1)
  expect(composePixelScene(odd, 0, null, 60).length > 0).toBe(true)
})
