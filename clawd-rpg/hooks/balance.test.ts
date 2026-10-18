import { expect, test } from 'claude-code/testing'

import type { Item, Save } from '../types'
import { BIOMES } from './content'
import {
  heroStats,
  isCommit,
  loot,
  makeEnemy,
  newSave,
  nextLuck,
  pressure,
  scoreOf,
  setLuck,
  tick,
  typicalHero,
  UPGRADE_CAP,
} from './engine'

const seeded = (seed: number) => () => {
  seed = (seed + 0x6d2b79f5) | 0
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed)
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296
}
const always = (value: number) => () => value
const AVG = { name: 'Average', desc: '', hp: 1, atk: 1, def: 1, verbs: ['hits', 'hits'] as [string, string] }
const BOSS = { ...AVG, intro: '', defeat: '' }

/** Hits for Clawd to win and for the enemy to win, before crits, luck and potions. */
function odds(hero: Save['hero'], depth: number, kind: 'normal' | 'boss') {
  const st = heroStats(hero)
  const foe = makeEnemy(always(0.5), depth, kind === 'boss' ? BOSS : AVG, kind, hero)
  const hit = (atk: number, def: number) => Math.max(1, atk - def * 0.5)
  return { ttk: foe.maxHp / hit(st.atk, foe.def), ttd: st.maxHp / hit(foe.atk, st.def) }
}

// ── Enemies match Clawd ───────────────────────────────────────────────

test('fights at par stay a fair match from the first zone to the late game', () => {
  for (const [level, depth] of [[1, 1], [10, 11], [25, 26], [50, 51], [90, 91]] as const) {
    const hero = typicalHero(level, depth)
    const normal = odds(hero, depth, 'normal')
    const boss = odds(hero, depth, 'boss')
    expect(normal.ttk >= 2 && normal.ttk <= 5).toBe(true)
    expect(normal.ttd >= 3 && normal.ttd <= 9).toBe(true)
    expect(boss.ttk >= 6 && boss.ttk <= 12).toBe(true)
    expect(boss.ttd >= 3.5 && boss.ttd <= 10).toBe(true)
  }
})

test('even pushed far too deep, with only typical gear, fights stay survivable', () => {
  for (const [level, depth] of [[10, 25], [25, 60], [50, 120]] as const) {
    const hero = typicalHero(level, depth)
    expect(odds(hero, depth, 'normal').ttd >= 2.5).toBe(true)
    expect(odds(hero, depth, 'boss').ttd >= 3).toBe(true)
  }
})

test('better gear than typical still makes the same fight easier', () => {
  const typical = typicalHero(20, 25)
  const geared: Save['hero'] = {
    ...typical,
    gear: Object.fromEntries(Object.entries(typical.gear).map(([slot, it]) => [slot, { ...it!, power: it!.power * 2 }])) as Save['hero']['gear'],
  }
  const plain = odds(typical, 25, 'normal')
  const strong = odds(geared, 25, 'normal')
  expect(strong.ttk < plain.ttk).toBe(true)
  expect(strong.ttd > plain.ttd).toBe(true)
})

test('pushing deeper than Clawd\'s level makes enemies tougher, within limits; the first zones stay gentle', () => {
  expect(pressure(20, 10) > pressure(11, 10)).toBe(true)
  expect(pressure(60, 10)).toBe(1.3)
  expect(pressure(5, 40)).toBe(0.8)
  expect(pressure(2, 1) <= 0.9).toBe(true)
})

// ── Loot keeps up ─────────────────────────────────────────────────────

test('item levels wander around the depth, so some drops beat typical gear', () => {
  const s = { ...newSave(always(0.5)), zone: { ...newSave(always(0.5)).zone, depth: 10 } }
  const typical = typicalHero(10, 10)
  const rng = seeded(1)
  let better = 0
  for (let i = 0; i < 300; i++) {
    const it = loot(s, rng, 'neutral')
    if (scoreOf(it) > scoreOf(typical.gear[it.slot]!)) better++
  }
  expect(better > 30).toBe(true)
})

test('after six drops that were no upgrade, the next one is', () => {
  const strong: Item = { name: 'Starforged Edge', slot: 'weapon', rarity: 'legendary', power: 200, affixes: ['keen', 'vampiric', 'thorns'], score: 209 }
  const s: Save = { ...newSave(always(0.5)), stats: { ...newSave(always(0.5)).stats, dry: 6 } }
  s.hero.gear = { weapon: strong, armor: { ...strong, slot: 'armor' }, trinket: { ...strong, slot: 'trinket' } }
  const it = loot(s, seeded(2), 'neutral')
  expect(scoreOf(it) > scoreOf(s.hero.gear[it.slot]!)).toBe(true)
  expect(it.rarity).toBe('legendary')
})

test('the blacksmith stops at each rarity\'s cap', () => {
  const common: Item = { name: 'Rusty Dagger', slot: 'weapon', rarity: 'common', power: 3, affixes: [], score: 3 }
  const base = newSave(always(0.5))
  const s: Save = { ...base, phase: 'camp', hero: { ...base.hero, gold: 1_000_000, potions: 5, gear: { weapon: common, armor: null, trinket: null } } }
  const { save } = tick(s, always(0.99))
  expect(save.hero.gear.weapon!.upgrades).toBe(UPGRADE_CAP.common)
  expect(save.hero.gold > 900_000).toBe(true)
})

// ── Failures stick ────────────────────────────────────────────────────

test('a failure leaves an omen that a later success does not wash away', () => {
  let s = newSave(always(0.5))
  s = setLuck(setLuck(setLuck(s, true), true), false)
  expect(s.omens).toBe(2)
  expect(nextLuck(s)).toBe('unlucky')
  s = tick(s, always(0.99)).save
  expect(nextLuck(s)).toBe('unlucky')
  s = tick(s, always(0.99)).save
  expect(s.stats.unluckyStreak).toBe(2)
  expect(nextLuck(s)).toBe('neutral')
})

test('omens pile up to three at most', () => {
  let s = newSave(always(0.5))
  for (let i = 0; i < 6; i++) s = setLuck(s, true)
  expect(s.omens).toBe(3)
})

// ── Commits ───────────────────────────────────────────────────────────

test('only a git commit run as a command opens a chest, not one mentioned in quotes', () => {
  for (const c of ['git commit -m x', 'cd repo && git commit -am wip', '(git commit -m x)', 'npm test; git commit -m y', 'git -C repo commit -m z'])
    expect(isCommit(c)).toBe(true)
  for (const c of ['grep -r "git commit" docs/', 'echo "remember to git commit"', `node -e 'run("git commit -m x")'`, 'git log --grep commit'])
    expect(isCommit(c)).toBe(false)
})

// ── The whole curve ───────────────────────────────────────────────────

// This session's rhythm: a neutral prompt tick, then a turn tick that is lucky about 70% of the time.
const TURNS = 'NLLLLNLLLLLNNNLNLNLLLNLLNLLLL'

// Measured over 40 seeds: depth 23–38, 5–29 knock-outs, longest stall median ~180 ticks, 95th percentile ~540,
// worst ~600 (with or without wild characters: about one run in twenty slows for a week or more, by design).
test('twenty working days keep moving, sometimes knock Clawd out, and rarely stall for long', { timeoutMs: 60_000 }, () => {
  const depths: number[] = []
  const kos: number[] = []
  const stalls: number[] = []
  for (let seed = 1; seed <= 9; seed++) {
    const rng = seeded(seed)
    let s = newSave(rng)
    let stall = 0, maxStall = 0, lastDepth = 1
    for (let i = 0; i < 1200; i++) {
      if (i % 2 === 1) {
        const turn = TURNS[Math.floor(i / 2) % TURNS.length]
        if (rng() < 0.08) s = setLuck(s, true)
        else if (turn === 'L') s = setLuck(s, false)
      }
      s = tick(s, rng).save
      if (s.zone.depth > lastDepth) { lastDepth = s.zone.depth; stall = 0 } else maxStall = Math.max(maxStall, ++stall)
    }
    depths.push(s.zone.depth)
    kos.push(s.stats.knockouts)
    stalls.push(maxStall)
  }
  const median = (xs: number[]) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)]!
  expect(median(depths) >= 20).toBe(true)
  expect(median(kos) >= 1).toBe(true)
  expect(median(stalls) < 300).toBe(true)
  expect(Math.max(...stalls) < 700).toBe(true)
})

test('every biome\'s enemies are matched too', () => {
  const hero = typicalHero(12, 15)
  for (const biome of BIOMES) for (const def of biome.enemies) {
    const foe = makeEnemy(always(0.5), 15, def, 'normal', hero)
    expect(foe.maxHp > 0 && foe.atk > 0).toBe(true)
  }
})
