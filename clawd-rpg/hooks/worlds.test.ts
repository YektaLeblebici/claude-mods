import { expect, test } from 'claude-code/testing'

import { BIOMES } from './content'
import { makeZone } from './engine'
import { QUARTER_LOOKS } from './quarterart'
import { archetypeOf } from './scene'

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
const NEW = ['sprawl', 'helix', 'annex']

test('the Neon Sprawl, Helix Tower and the Annex are open all year, like the regular worlds', () => {
  const rng = seeded(4)
  const seen = new Set<string>()
  for (let i = 0; i < 4000; i++) seen.add(makeZone(rng, 3, 'meadow').biome)
  for (const id of NEW) {
    expect(BIOMES.find(b => b.id === id)!.season).toBe(undefined)
    expect(seen.has(id)).toBe(true)
  }
})

test('their monsters and bosses appear only there, and they drop nothing special', () => {
  for (const id of NEW) {
    const world = BIOMES.find(b => b.id === id)!
    expect(world.names.length).toBe(3)
    expect(world.enemies.length).toBe(3)
    expect(world.bosses.length).toBe(2)
    const elsewhere = BIOMES.filter(b => b !== world).flatMap(b => [...b.enemies, ...b.bosses].map(e => e.name))
    for (const e of [...world.enemies, ...world.bosses]) expect(elsewhere.includes(e.name)).toBe(false)
    for (const boss of world.bosses) expect(boss.item === undefined && boss.pets === undefined).toBe(true)
  }
})

test('every world has its own look', () => {
  for (const world of BIOMES) expect(QUARTER_LOOKS[world.id] !== undefined).toBe(true)
})

test('the new creatures are drawn as what they are, and the Rockstar is no serpent', () => {
  expect(archetypeOf({ name: 'Security Drone', isBoss: false })).toBe('flyer')
  expect(archetypeOf({ name: 'Corp Security Mech', isBoss: false })).toBe('construct')
  expect(archetypeOf({ name: 'Unblinking Statue', isBoss: false })).toBe('construct')
  expect(archetypeOf({ name: 'Hungry Filing Cabinet', isBoss: false })).toBe('construct')
  expect(archetypeOf({ name: 'Black ICE Daemon', isBoss: false })).toBe('spirit')
  expect(archetypeOf({ name: 'Ghost of the Last Rockstar', isBoss: true })).toBe('giant')
  expect(archetypeOf({ name: 'The Storm Roc', isBoss: true })).toBe('wyrm')
})
