import { expect, test } from 'claude-code/testing'

import type { Item, Save } from '../types'
import { BIOMES, FOE_TONES, HERO_TONES, HERO_VERBS } from './content'
import { FOE_STEPS, HERO_STEPS, hitTier, makeEnemy, newSave, setLuck, tick } from './engine'
import { composePixelScene } from './pixel'

const seeded = (seed: number) => () => {
  seed = (seed + 0x6d2b79f5) | 0
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed)
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296
}
const always = (value: number) => () => value
const sword = (power: number): Item => ({ name: 'Test Blade', slot: 'weapon', rarity: 'common', power, affixes: [], score: power })
const fighting = (s: Save, biome = 0, boss = false): Save => ({
  ...s,
  phase: 'fighting',
  enemy: makeEnemy(always(0.5), 3, boss ? BIOMES[biome]!.bosses[0]! : BIOMES[biome]!.enemies[1]!, boss ? 'boss' : 'normal'),
})

test('tiers follow the share of max HP a hit takes; the top tier needs a crit or a knock-out', () => {
  expect(hitTier(10, 100, HERO_STEPS)).toBe(0)
  expect(hitTier(50, 100, HERO_STEPS)).toBe(1)
  expect(hitTier(70, 100, HERO_STEPS)).toBe(2)
  expect(hitTier(99, 100, HERO_STEPS)).toBe(3)
  expect(hitTier(99, 100, HERO_STEPS, true)).toBe(4)
  expect(hitTier(60, 100, HERO_STEPS, true)).toBe(1)
  expect(hitTier(20, 100, FOE_STEPS)).toBe(0)
  expect(hitTier(45, 100, FOE_STEPS)).toBe(2)
  expect(hitTier(60, 100, FOE_STEPS)).toBe(3)
  expect(hitTier(60, 100, FOE_STEPS, false, true)).toBe(4)
})

test('a light hit reads plainly: a simple verb, no colour, a full stop', () => {
  const s = fighting(newSave(always(0.5)), 0, true)
  const { save } = tick(s, always(0.99))
  const line = save.log.find(l => l.text.startsWith('You '))!
  expect(HERO_VERBS[0]!.some(([verb]) => line.text.startsWith(`You ${verb} `))).toBe(true)
  expect(line.tone).toBe(undefined)
  expect(line.text.endsWith('.')).toBe(true)
})

test('a crushing critical hit gets the full treatment: CAPS, crimson, bold, framed', () => {
  const base = newSave(always(0.5))
  const s = fighting({ ...base, hero: { ...base.hero, gear: { ...base.hero.gear, weapon: sword(500) } } })
  const { save } = tick(s, always(0))
  const line = save.log.find(l => l.text.includes('You '))!
  expect(line.text.startsWith('✦ You ')).toBe(true)
  expect(line.text.includes('!! ✦')).toBe(true)
  expect(HERO_VERBS[4]!.some(([verb]) => line.text.includes(` ${verb} `))).toBe(true)
  expect(line.tone).toBe(HERO_TONES[4])
  expect(line.strong).toBe(true)
})

test('a blow that knocks Clawd out is framed in burning orange', () => {
  const base = newSave(always(0.5))
  const s: Save = { ...fighting(base), hero: { ...base.hero, hp: 5, potions: 0 } }
  s.enemy = { ...s.enemy!, atk: 400, hp: 9999, maxHp: 9999 }
  const { save } = tick(s, always(0.99))
  const line = save.log.find(l => l.text.includes(' you for '))!
  expect(line.text.startsWith('✦ The ')).toBe(true)
  expect(line.tone).toBe(FOE_TONES[4])
  expect(save.phase).toBe('recovering')
})

test('bosses keep their own names in battle text', () => {
  const vulkazar = BIOMES.find(b => b.id === 'volcano')!.bosses[0]!
  const s: Save = { ...newSave(always(0.5)), phase: 'fighting', enemy: makeEnemy(always(0.5), 3, vulkazar, 'boss') }
  const text = tick(s, always(0.5)).save.log.map(l => l.text).join(' | ')
  expect(text).toContain('Vulkazar the Molten')
  expect(text.includes('The Vulkazar') || text.includes('the Vulkazar')).toBe(false)
})

test('the band caption shows a hard hit in its colour and bold', () => {
  const s: Save = { ...newSave(always(0.5)), log: [{ kind: 'combat', text: 'You DEVASTATE the Dire Wolf for 25!!', tone: HERO_TONES[3], strong: true }] }
  for (const rows of [composePixelScene(s, 0, null, 60)]) {
    const seg = rows[5]!.find(r => r.text.includes('DEVASTATE'))!
    expect(seg.color).toBe(HERO_TONES[3])
    expect(seg.bold).toBe(true)
  }
})

test('the drama stays rare: most hits read plainly', { timeoutMs: 60_000 }, () => {
  const hero = [0, 0, 0, 0, 0]
  const foe = [0, 0, 0, 0, 0]
  for (let seed = 1; seed <= 4; seed++) {
    const rng = seeded(seed)
    let s = newSave(rng)
    for (let i = 0; i < 900; i++) {
      if (i % 2 === 1 && rng() < 0.7) s = setLuck(s, rng() < 0.1)
      const before = s.log.at(-1)
      s = tick(s, rng).save
      for (const l of s.log.slice(s.log.lastIndexOf(before!) + 1)) {
        const isFoe = / you for \d+/.test(l.text)
        const isHero = !isFoe && /^(?:✦ )?(?:Critical! )?You \S+ .+ for \d+/.test(l.text)
        if (isHero) hero[l.tone ? HERO_TONES.indexOf(l.tone) : 0]!++
        if (isFoe) foe[l.tone ? FOE_TONES.indexOf(l.tone) : 0]!++
      }
    }
  }
  const share = (a: number[], from: number) => a.slice(from).reduce((x, y) => x + y, 0) / a.reduce((x, y) => x + y, 0)
  expect(share(hero, 2) < 0.25).toBe(true)
  expect(share(hero, 3) < 0.08).toBe(true)
  expect(share(foe, 2) < 0.2).toBe(true)
  expect(share(foe, 3) < 0.05).toBe(true)
})
