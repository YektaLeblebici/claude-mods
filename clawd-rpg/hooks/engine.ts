import type { Affix, ChestKind, Enemy, Fight, Fx, Item, LogEntry, LogKind, Luck, PetId, Rarity, Save, Slot, Zone, ZoneModifier } from '../types'
import {
  ACHIEVEMENTS,
  AFFIX_INFO,
  BIOMES,
  COMMON_PETS,
  FOE_TONES,
  FOE_VERBS,
  HERO_TONES,
  HERO_VERBS,
  ITEM_BASES,
  LEGEND_CHANCE,
  LEGENDS,
  LEGENDARIES,
  MODIFIERS,
  PET_MAX_LEVEL,
  PETS,
  RARITY_AFFIXES,
  RARITY_MULT,
  RARITY_WEIGHTS,
  SKILLS,
  TITLES,
  type PetBonus,
  type Biome,
  type EnemyDef,
} from './content'

export type Rng = () => number
export type TickResult = { save: Save; toasts: string[]; fx: Fx[] }

export const LOG_MAX = 15
export const GROWTH = 1.04
const SLOTS: Slot[] = ['weapon', 'armor', 'trinket']
const AFFIXES = Object.keys(AFFIX_INFO) as Affix[]
const RARITIES: Rarity[] = ['common', 'uncommon', 'rare', 'epic', 'legendary']

const pick = <T>(rng: Rng, list: readonly T[]): T => list[Math.floor(rng() * list.length)]!
const between = (rng: Rng, lo: number, hi: number) => lo + rng() * (hi - lo)
const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T

export const xpToNext = (level: number) => Math.round(20 * level ** 1.5)
export const potionPrice = (depth: number) => 8 + 4 * depth
/** An item's power with the blacksmith's upgrades, and its worth for comparing and selling. */
export const powerOf = (item: Item) => item.power + (item.upgrades ?? 0)
export const scoreOf = (item: Item) => powerOf(item) + item.affixes.length * 3
export const sellValue = (item: Item) => Math.max(1, Math.round(scoreOf(item) * 2))
export const itemLabel = (item: Item) => (item.upgrades ? `${item.name} +${item.upgrades}` : item.name)
/** What the blacksmith charges for an item's next upgrade: dearer with depth and with each upgrade. */
export const upgradeCost = (item: Item, depth: number) => Math.round((15 + 5 * depth) * 1.3 ** (item.upgrades ?? 0))
export const CHEST_WINDOW_MS = 30 * 60 * 1000
/** `git commit` as a command of its own: at the start, or after a separator; never inside quotes or arguments. */
export const isCommit = (command: string) => /(?:^|[;&|(\n])\s*git\s+(?:-\S+\s+(?:\S+\s+)?)*commit(?=\s|;|&|\||\)|$)/.test(command)

/** The active pet's bonus of `kind`, in its own unit (percent or flat points); 0 without one. */
export function petBonus(hero: Save['hero'], kind: PetBonus): number {
  const owned = hero.pets?.find(p => p.id === hero.activePet)
  if (!owned) return 0
  const pet = PETS[owned.id]
  return pet.bonus === kind ? pet.base * (1 + 0.5 * (owned.level - 1)) : 0
}
export const biomeOf = (zone: Zone): Biome => BIOMES.find(b => b.id === zone.biome) ?? BIOMES[0]!
const freshFight = (): Fight => ({ exchanges: 0, allUnlucky: true, secondWindUsed: false })

/** Renown only grows: kills, bosses and levels all count. */
export const renown = (s: Save) => s.stats.kills + 15 * s.stats.bosses + 5 * s.hero.level
export const titleOf = (s: Save) => [...TITLES].reverse().find(t => renown(s) >= t.renown)!.title
export const heroName = (s: Save) => `${s.hero.name} ${titleOf(s)}`

export function heroStats(hero: Save['hero']) {
  const gear = SLOTS.map(slot => hero.gear[slot]).filter((i): i is Item => i !== null)
  const count = (affix: Affix) => gear.filter(i => i.affixes.includes(affix)).length
  const L = hero.level
  let maxHp = 30 + 8 * L
  let atk = 4 + 2 * L
  let def = 1 + L
  let luck = 3 + Math.floor(L / 3)
  if (hero.gear.weapon) atk += powerOf(hero.gear.weapon)
  if (hero.gear.armor) {
    def += powerOf(hero.gear.armor)
    maxHp += powerOf(hero.gear.armor) * 3
  }
  if (hero.gear.trinket) luck += Math.ceil(powerOf(hero.gear.trinket) / 2)
  for (const item of gear) if (item.affixes.includes('sturdy')) def += Math.ceil(powerOf(item) / 2)
  atk += petBonus(hero, 'atk')
  def += petBonus(hero, 'def')
  maxHp = Math.round(maxHp * (1 + petBonus(hero, 'hp') / 100))
  return {
    maxHp,
    atk,
    def,
    luck,
    crit: Math.min(60, luck + 5 * count('keen') + petBonus(hero, 'crit')),
    lifesteal: count('vampiric') > 0 ? 0.1 : 0,
    thorns: count('thorns') > 0 ? 0.15 : 0,
    isFortunate: count('fortunate') > 0,
    isSwift: count('swift') > 0,
    isWarding: count('warding') > 0,
  }
}

/** How strong this tick's luck is: 0 when neutral, 1 by default, scaled by gear, zone and skills. */
function luckPower(s: Save, luck: Luck): number {
  const st = heroStats(s.hero)
  if (luck === 'lucky') return (st.isFortunate ? 1.5 : 1) * (s.zone.modifier === 'blessed' ? 1.5 : 1)
  if (luck === 'unlucky') return (s.zone.modifier === 'cursed' ? 1.5 : 1) * (s.hero.level >= 20 ? 0.5 : 1)
  return 0
}

/** "the Dire Wolf", but "The Deep Maw" as named: some bosses carry their own article. */
const the = (name: string, isCapital = false) => (/^the /i.test(name) ? name : `${isCapital ? 'The' : 'the'} ${name}`)

/** How battle text names an enemy: a boss or wild character by its own name ("Vulkazar the Molten"), anyone else as "the Dire Wolf". */
const named = (e: Pick<Enemy, 'name' | 'isBoss' | 'legend'>, isCapital = false) => (e.isBoss || e.legend ? e.name : the(e.name, isCapital))

const luckTag = (luck: Luck) => (luck === 'lucky' ? ' 🍀' : luck === 'unlucky' ? ' 💀' : '')
const luckKind = (luck: Luck, fallback: LogKind): LogKind =>
  luck === 'lucky' ? 'lucky' : luck === 'unlucky' ? 'unlucky' : fallback

function log(s: Save, kind: LogKind, text: string, style: { tone?: string; strong?: boolean } = {}) {
  const entry: LogEntry = style.tone ? { kind, text, tone: style.tone, strong: style.strong } : { kind, text }
  s.log = [...s.log, entry].slice(-LOG_MAX)
}

/**
 * Where tiers 1, 2 and 3 begin, as a share of the target's max HP. Clawd's ordinary hit takes about a
 * third of a matched enemy, so his steps sit higher than an enemy's against him.
 */
export const HERO_STEPS = [0.45, 0.65, 0.95] as const
export const FOE_STEPS = [0.25, 0.4, 0.55] as const

/**
 * How hard a hit lands, 0–4. Tier 4 is kept for tier-3 hits that are also a critical hit (Clawd's)
 * or knock Clawd out (an enemy's). A crit already doubles damage, so it earns no tier of its own below.
 */
export function hitTier(damage: number, maxHp: number, steps: readonly number[], isCrit = false, isKill = false): number {
  const tier = steps.filter(step => damage / Math.max(1, maxHp) >= step).length
  return tier >= 3 && (isCrit || isKill) ? 4 : tier
}

const bang = (tier: number) => (tier >= 3 ? '!!' : tier === 2 ? '!' : '.')
const framed = (tier: number, text: string) => (tier >= 4 ? `✦ ${text} ✦` : text)
const hitStyle = (tones: string[], tier: number) => (tier >= 2 ? { tone: tones[tier], strong: true } : {})

/** Clawd's hit, worded by tier. */
function heroHitLine(rng: Rng, tier: number, target: Enemy, damage: number, isCrit: boolean, extra: string) {
  const [verb] = pick(rng, HERO_VERBS[tier]!)
  const lead = isCrit && tier < 3 ? 'Critical! ' : ''
  return { text: framed(tier, `${lead}You ${verb} ${named(target)} for ${damage}${extra}${bang(tier)}`), style: hitStyle(HERO_TONES, tier) }
}

/** An enemy's hit on Clawd: its own verbs while light, harder words as it lands harder. */
function foeHitLine(rng: Rng, tier: number, foe: Enemy, damage: number) {
  const verb = tier <= 1 ? foe.verbs[Math.min(tier, foe.verbs.length - 1)] ?? 'hits' : pick(rng, FOE_VERBS[tier]!)
  return { text: framed(tier, `${named(foe, true)} ${verb} you for ${damage}${bang(tier)}`), style: hitStyle(FOE_TONES, tier) }
}

function heal(s: Save, amount: number) {
  s.hero.hp = Math.min(heroStats(s.hero).maxHp, s.hero.hp + Math.max(0, Math.round(amount)))
}

export function makeZone(rng: Rng, depth: number, previousBiome?: string): Zone {
  const biome = pick(rng, BIOMES.filter(b => b.id !== previousBiome))
  const modifier = rng() < 0.3 ? pick(rng, Object.keys(MODIFIERS) as ZoneModifier[]) : null
  return {
    depth,
    biome: biome.id,
    name: pick(rng, biome.names),
    desc: pick(rng, biome.descs),
    length: 8 + depth,
    progress: 0,
    modifier,
  }
}

/** Hits for Clawd to win and for the enemy to win, at par: what a fair fight of each kind takes. */
export const TYPICAL_PULL = 0.35
/** Fair-fight targets (hits for Clawd to win / for the enemy to win): soft in the first zone, full from depth 10. */
const PAR_EASY = { normal: { ttk: 3, ttd: 6.5 }, elite: { ttk: 4.5, ttd: 5 }, legend: { ttk: 5.5, ttd: 4.5 }, boss: { ttk: 7.5, ttd: 7.5 } }
const PAR_FULL = { normal: { ttk: 3.3, ttd: 4 }, elite: { ttk: 5, ttd: 3.5 }, legend: { ttk: 6.5, ttd: 3.4 }, boss: { ttk: 9, ttd: 5 } }
export type EnemyKind = 'normal' | 'elite' | 'legend' | 'boss'
export function parFor(kind: EnemyKind, depth: number) {
  const t = Math.min(1, Math.max(0, (depth - 1) / 9))
  const lerp = (a: number, b: number) => a + (b - a) * t
  return { ttk: lerp(PAR_EASY[kind].ttk, PAR_FULL[kind].ttk), ttd: lerp(PAR_EASY[kind].ttd, PAR_FULL[kind].ttd) }
}

/** A typical Clawd at this level and depth: plain gear of the depth, nothing more. Enemies are set against this one. */
export function typicalHero(level: number, depth: number): Save['hero'] {
  const power = Math.round((2 + 1.5 * depth) * 1.35)
  const plain = (slot: Slot): Item => ({ name: 'typical', slot, rarity: 'uncommon', power, affixes: [], score: power })
  return { name: 'Typical', level, xp: 0, hp: 0, gold: 0, potions: 0, gear: { weapon: plain('weapon'), armor: plain('armor'), trinket: plain('trinket') } }
}

/** Deeper than Clawd's level makes enemies tougher, over-levelled makes them softer; gentle in the first zones. */
export const pressure = (depth: number, level: number) =>
  Math.min(depth <= 3 ? 0.9 : 1.3, Math.max(0.8, 1 + 0.06 * (depth - level - 1)))

export function makeEnemy(rng: Rng, depth: number, def: EnemyDef, kind: EnemyKind, hero?: Save['hero']): Enemy {
  const isBoss = kind === 'boss'
  const isElite = kind === 'elite'
  const isLegend = kind === 'legend'
  const reward = isBoss ? 5 : isLegend ? 4 : isElite ? 2 : 1
  // Linear growth keeps early zones gentle; the compounding term builds a wall the hero grinds against.
  const growth = GROWTH ** depth
  let hp = (16 + 7 * depth) * growth * def.hp * (isBoss ? 3 : isLegend ? 2.2 : isElite ? 1.6 : 1)
  let atk = (5 + 2.8 * depth) * growth * def.atk * (isBoss || isElite ? 1.3 : isLegend ? 1.4 : 1)
  let armour = (1 + 0.6 * depth) * def.def
  if (hero) {
    // A fair fight against Clawd as he is, pulled a third of the way toward a typical Clawd of this level
    // and depth: better gear still pays off, but cannot run away from the enemies.
    const real = heroStats(hero)
    const typical = heroStats(typicalHero(hero.level, depth))
    const blend = (a: number, b: number) => a ** (1 - TYPICAL_PULL) * b ** TYPICAL_PULL
    const st = { atk: blend(real.atk, typical.atk), maxHp: blend(real.maxHp, typical.maxHp), def: blend(real.def, typical.def) }
    const par = parFor(kind, depth)
    const push = pressure(depth, hero.level) * between(rng, 0.85, 1.15)
    armour = Math.min(armour, st.atk * 0.6)
    hp = Math.max(1, st.atk - armour * 0.5) * par.ttk * def.hp * push
    atk = (st.maxHp / par.ttd + st.def * 0.5) * def.atk * push
  }
  const maxHp = Math.max(1, Math.round(hp))
  const name = isElite ? `Elite ${def.name}` : def.name
  return {
    name,
    desc: def.desc,
    hp: maxHp,
    maxHp,
    atk: Math.max(1, Math.round(atk)),
    def: Math.round(armour),
    xp: Math.round((5 + 3 * depth) * reward),
    gold: Math.round((2 + 2 * depth) * reward * between(rng, 0.7, 1.3)),
    verbs: [...def.verbs],
    isBoss,
    isElite,
    defeat: 'defeat' in def && typeof def.defeat === 'string' ? def.defeat : `${the(name, true)} is defeated.`,
  }
}

function rollRarity(rng: Rng, luck: Luck, min: Rarity, max: Rarity = 'legendary'): Rarity {
  const weights = RARITY_WEIGHTS.map(([r, w]): [Rarity, number] => [
    r,
    RARITIES.indexOf(r) < RARITIES.indexOf(min) || RARITIES.indexOf(r) > RARITIES.indexOf(max) ? 0 : luck === 'lucky' && RARITIES.indexOf(r) >= 2 ? w * 1.5 : w,
  ])
  let roll = rng() * weights.reduce((sum, [, w]) => sum + w, 0)
  for (const [r, w] of weights) if ((roll -= w) < 0) return r
  return min
}

export function makeItem(rng: Rng, depth: number, luck: Luck, min: Rarity = 'common', max: Rarity = 'legendary'): Item {
  const slot = pick(rng, SLOTS)
  const rarity = rollRarity(rng, luck, min, max)
  const power = Math.max(1, Math.round((2 + depth * 1.5) * RARITY_MULT[rarity] * between(rng, 0.85, 1.15)))
  const pool = [...AFFIXES]
  const affixes: Affix[] = []
  for (let i = 0; i < RARITY_AFFIXES[rarity]; i++) affixes.push(pool.splice(Math.floor(rng() * pool.length), 1)[0]!)
  let name: string
  if (rarity === 'legendary') name = pick(rng, LEGENDARIES[slot])
  else {
    const bases = ITEM_BASES[slot]
    const base = bases[Math.min(bases.length - 1, Math.floor((depth - 1) / 3))]!
    const prefix = affixes.map(a => AFFIX_INFO[a].prefix).find(Boolean)
    const suffix = affixes.map(a => AFFIX_INFO[a].suffix).find(Boolean)
    name = [prefix, base, suffix].filter(Boolean).join(' ')
  }
  return { name, slot, rarity, power, affixes, score: power + affixes.length * 3 }
}

export function newSave(rng: Rng): Save {
  const zone = makeZone(rng, 1)
  const save: Save = {
    version: 1,
    hero: { name: 'Clawd', level: 1, xp: 0, hp: 0, gold: 0, potions: 2, gear: { weapon: null, armor: null, trinket: null } },
    zone,
    phase: 'exploring',
    enemy: null,
    fight: freshFight(),
    recoverLeft: 0,
    pendingLuck: 'neutral',
    log: [],
    achievements: [],
    stats: { ticks: 0, kills: 0, bosses: 0, knockouts: 0, luckyStreak: 0, unluckyStreak: 0, maxDepth: 1, epicFound: false, legendaryFound: false, wonAgainstOdds: false },
  }
  save.hero.hp = heroStats(save.hero).maxHp
  log(save, 'info', `Clawd sets out into ${zone.name}. ${zone.desc}`)
  return save
}

export function isSave(value: unknown): value is Save {
  return typeof value === 'object' && value !== null && (value as { version?: unknown }).version === 1
}

export const MAX_OMENS = 3

/**
 * Records how a Bash command went. A success makes the next tick lucky; a failure also leaves an omen,
 * which a later success does not wash away. Only a boolean leaves the tool call.
 */
export function setLuck(save: Save, hasFailed: boolean): Save {
  if (!hasFailed) return { ...save, pendingLuck: 'lucky' }
  return { ...save, pendingLuck: 'unlucky', omens: Math.min(MAX_OMENS, (save.omens ?? 0) + 1) }
}

/** What the next tick will be: an outstanding omen outranks any luck since. */
export const nextLuck = (save: Save): Luck => ((save.omens ?? 0) > 0 ? 'unlucky' : save.pendingLuck)

const PITY = 6

/** Loot with a floor: after PITY drops in a row that were no upgrade, the next one is. */
export function loot(s: Save, rng: Rng, luck: Luck, min: Rarity = 'common', max: Rarity = 'legendary'): Item {
  // Item level wanders around the depth, so some drops always outclass what Clawd wears.
  const ilvl = Math.max(1, s.zone.depth + Math.floor(between(rng, -1, 4)) + (luck === 'lucky' ? 1 : 0))
  let item = makeItem(rng, ilvl, luck, min, max)
  const dry = s.stats.dry ?? 0
  const current = s.hero.gear[item.slot]
  if (dry >= PITY && current && scoreOf(item) <= scoreOf(current)) {
    // Bad-luck protection: at least as rare as what it replaces, from a little deeper, and better.
    const rarer = RARITIES.indexOf(item.rarity) < RARITIES.indexOf(current.rarity) ? current.rarity : item.rarity
    item = makeItem(rng, s.zone.depth + 3, luck, rarer, rarer)
    item = { ...item, slot: current.slot, name: current.slot === item.slot ? item.name : current.name.replace(/ \+\d+$/, '') }
    if (scoreOf(item) <= scoreOf(current)) item = { ...item, power: item.power + scoreOf(current) - scoreOf(item) + 1 }
  }
  return item
}

function gainItem(s: Save, item: Item, toasts: string[], fx: Fx[]) {
  fx.push('loot')
  if (item.rarity === 'epic') s.stats.epicFound = true
  if (item.rarity === 'legendary') s.stats.legendaryFound = true
  if (item.rarity === 'epic' || item.rarity === 'legendary') toasts.push(`✨ ${item.rarity} loot: ${item.name}`)
  const current = s.hero.gear[item.slot]
  if (!current || scoreOf(item) > scoreOf(current)) {
    s.stats.dry = 0
    s.hero.gear[item.slot] = item
    const sold = current ? sellValue(current) : 0
    s.hero.gold += sold
    log(s, 'loot', `Found ${item.rarity} ${item.name}, equipped${current ? ` (sold ${itemLabel(current)} for ${sold}g)` : ''}.`)
  } else {
    s.stats.dry = (s.stats.dry ?? 0) + 1
    s.hero.gold += sellValue(item)
    log(s, 'loot', `Found ${item.rarity} ${item.name}, sold for ${sellValue(item)}g.`)
  }
  s.hero.hp = Math.min(s.hero.hp, heroStats(s.hero).maxHp)
}

function explore(s: Save, luck: Luck, rng: Rng, fx: Fx[], toasts: string[]) {
  const st = heroStats(s.hero)
  const p = luckPower(s, luck)
  const z = s.zone
  const biome = biomeOf(z)
  const tag = luckTag(luck)
  heal(s, st.maxHp * (luck === 'lucky' ? 0.06 : 0.03))
  z.progress = Math.min(z.length, z.progress + (luck === 'lucky' || (luck === 'neutral' && st.isSwift) ? 2 : 1))

  if (z.progress >= z.length) {
    const boss = pick(rng, biome.bosses)
    s.enemy = makeEnemy(rng, z.depth, boss, 'boss', s.hero)
    s.fight = freshFight()
    s.phase = 'fighting'
    fx.push('boss')
    log(s, 'boss', `${boss.intro} ${boss.name}: ${boss.desc}`)
    return
  }

  let encounter = luck === 'unlucky' ? 0.3 + 0.4 * p : luck === 'lucky' ? 0.25 : 0.3
  if (z.modifier === 'misty') encounter *= 0.6
  // One roll for whether Clawd meets anyone; a second, only then, for whether it is a wild character.
  const wild = wildCharacters(s)
  const meets = rng() < encounter
  if (meets && wild.length > 0 && rng() < LEGEND_CHANCE) {
    const legend = pick(rng, wild)
    s.enemy = { ...makeEnemy(rng, z.depth, legend, 'legend', s.hero), legend: legend.id, tint: PETS[legend.id].color }
    s.fight = freshFight()
    s.phase = 'fighting'
    fx.push('legend')
    log(s, 'boss', `A wild ${legend.name} appears! ${legend.desc}`)
    toasts.push(`A wild ${legend.name} appears!`)
  } else if (meets) {
    const elite = (luck === 'unlucky' ? 0.2 * p : 0.05) + (z.modifier === 'haunted' ? 0.15 : 0)
    s.enemy = makeEnemy(rng, z.depth, pick(rng, biome.enemies), rng() < elite ? 'elite' : 'normal', s.hero)
    s.fight = freshFight()
    s.phase = 'fighting'
    fx.push('encounter')
    log(s, luckKind(luck, 'combat'), `${luck === 'unlucky' ? 'Ambush! ' : ''}${s.enemy.name} appears. ${s.enemy.desc}${tag}`)
  } else if (rng() < 0.001) {
    gainPet(s, pick(rng, COMMON_PETS), [], fx)
  } else if (rng() < (luck === 'lucky' ? 0.15 * p : 0.05) + petBonus(s.hero, 'find') / 100) {
    gainItem(s, loot(s, rng, luck), [], fx)
  } else if (rng() < 0.25) {
    const gold = Math.round(between(rng, 1, 5) * z.depth * (luck === 'lucky' ? 2 * p : 1) * (z.modifier === 'bountiful' ? 1.5 : 1) * goldBonus(s))
    s.hero.gold += gold
    fx.push('gold')
    log(s, luckKind(luck, 'info'), `You find ${gold} gold in the dirt.${tag}`)
  } else {
    fx.push('explore')
    log(s, luckKind(luck, 'info'), `${pick(rng, biome.ambient)}${tag}`)
  }
}

/** The wild characters Clawd can meet now: his level is high enough, and he has not beaten them yet. */
export const wildCharacters = (s: Save) => LEGENDS.filter(l => s.hero.level >= l.minLevel && !(s.legendsBeaten ?? []).includes(l.id))

function win(s: Save, luck: Luck, rng: Rng, toasts: string[], fx: Fx[]) {
  fx.push('win')
  const e = s.enemy!
  const xp = Math.round(e.xp * (luck === 'lucky' && s.hero.level >= 8 ? 1.25 : 1) * (1 + petBonus(s.hero, 'xp') / 100))
  const gold = Math.round(e.gold * (s.zone.modifier === 'bountiful' ? 1.5 : 1) * goldBonus(s))
  s.hero.xp += xp
  s.hero.gold += gold
  s.stats.kills++
  if (s.fight.allUnlucky && s.fight.exchanges >= 2) s.stats.wonAgainstOdds = true
  log(s, e.isBoss ? 'boss' : 'combat', `${e.defeat} +${xp} XP, +${gold}g.`)
  const lootChance = (e.isBoss ? 1 : e.legend ? 0.5 : e.isElite ? 0.35 : luck === 'lucky' ? 0.2 : 0.1) + petBonus(s.hero, 'find') / 100
  if (rng() < lootChance) gainItem(s, loot(s, rng, luck, e.isBoss ? 'rare' : 'common'), toasts, fx)
  if (e.isBoss && rng() < 0.03) gainPet(s, pick(rng, COMMON_PETS), toasts, fx)
  // A beaten wild character joins as a pet, and never appears again.
  if (e.legend) {
    s.legendsBeaten = [...(s.legendsBeaten ?? []), e.legend]
    gainPet(s, e.legend, toasts, fx)
  }
  s.enemy = null
  s.fight = freshFight()
  if (e.isBoss) {
    s.stats.bosses++
    s.phase = 'camp'
    toasts.push(`👑 Boss defeated: ${e.name}`)
  } else s.phase = 'exploring'
}

function knockout(s: Save, fx: Fx[]) {
  fx.push('ko')
  log(s, 'ko', `Knocked out by ${s.enemy ? named(s.enemy) : 'something'}! Clawd crawls back to camp to recover.`)
  s.hero.hp = 0
  s.phase = 'recovering'
  s.recoverLeft = 3
  s.stats.knockouts++
  s.enemy = null
  s.fight = freshFight()
}

function fight(s: Save, luck: Luck, rng: Rng, toasts: string[], fx: Fx[]) {
  const e = s.enemy!
  const st = heroStats(s.hero)
  const p = luckPower(s, luck)
  const f = s.fight
  const tag = luckTag(luck)
  const kind = luckKind(luck, 'combat')
  const L = s.hero.level
  f.exchanges++
  if (luck !== 'unlucky') f.allUnlucky = false

  if (s.hero.hp < st.maxHp * 0.3 && s.hero.potions > 0) {
    s.hero.potions--
    fx.push('potion')
    heal(s, st.maxHp * 0.4 * (1 + petBonus(s.hero, 'potion') / 100))
    log(s, 'info', `Clawd gulps a potion. (${s.hero.potions} left)`)
  }

  if (rng() < (luck === 'unlucky' ? 0.25 * p * (st.isWarding ? 0.5 : 1) : 0)) {
    fx.push('miss')
    log(s, kind, `You swing at ${named(e)} and miss!${tag}`)
  } else {
    let dmg = Math.max(1, st.atk * between(rng, 0.85, 1.15) - e.def * 0.5)
    const isCrit = rng() < st.crit / 100
    const isPower = L >= 3 && f.exchanges % 4 === 0
    if (isCrit) dmg *= 2
    if (isPower) dmg *= 2
    if (luck === 'lucky') dmg *= 1 + 0.5 * p
    dmg = Math.round(dmg)
    e.hp -= dmg
    fx.push(isCrit ? 'crit' : 'hit')
    if (st.lifesteal) heal(s, dmg * st.lifesteal)
    const line = heroHitLine(rng, hitTier(dmg, e.maxHp, HERO_STEPS, isCrit), e, dmg, isCrit, isPower ? ' (Power Strike)' : '')
    log(s, kind, line.text + tag, line.style)
    if (L >= 16 && !e.isBoss && e.hp > 0 && e.hp < e.maxHp * 0.15) {
      e.hp = 0
      log(s, 'combat', `Execute! ${named(e, true)} is finished off.`)
    }
  }
  if (e.hp <= 0) return win(s, luck, rng, toasts, fx)

  if (rng() < (luck === 'lucky' ? Math.min(0.6, 0.3 * p) : 0)) {
    fx.push('dodge')
    log(s, kind, `${named(e, true)} misses you!${tag}`)
  } else {
    let dmg = Math.max(1, e.atk * between(rng, 0.85, 1.15) - st.def * 0.5)
    if (luck === 'unlucky') dmg *= 1 + 0.5 * p
    dmg = Math.round(dmg)
    s.hero.hp -= dmg
    fx.push('hurt')
    const line = foeHitLine(rng, hitTier(dmg, heroStats(s.hero).maxHp, FOE_STEPS, false, s.hero.hp <= 0), e, dmg)
    log(s, kind, line.text + tag, line.style)
    if (st.thorns) e.hp -= Math.max(1, Math.round(dmg * st.thorns))
    if (s.hero.hp > 0 && L >= 12 && rng() < 0.2) {
      const counter = Math.max(1, Math.round(st.atk * 0.6 - e.def * 0.5))
      e.hp -= counter
      log(s, 'combat', `Riposte! You counter for ${counter}.`)
    }
  }
  if (s.hero.hp <= 0) return knockout(s, fx)
  if (e.hp <= 0) return win(s, luck, rng, toasts, fx)
  if (L >= 5 && !f.secondWindUsed && s.hero.hp < st.maxHp * 0.25) {
    f.secondWindUsed = true
    heal(s, st.maxHp * 0.3)
    log(s, 'info', 'Second Wind! Clawd steadies and fights on.')
  }
}

function recover(s: Save, luck: Luck, fx: Fx[]) {
  // Back at camp to recover, Clawd also visits the blacksmith.
  s.recoverLeft -= luck === 'lucky' ? 2 : luck === 'unlucky' ? 0 : 1
  if (s.recoverLeft > 0) {
    fx.push('rest')
    log(s, luckKind(luck, 'info'), `Clawd rests by the fire… (${s.recoverLeft} to go)${luckTag(luck)}`)
    return
  }
  s.hero.hp = heroStats(s.hero).maxHp
  s.zone.progress = 0
  s.phase = 'exploring'
  s.recoverLeft = 0
  forge(s, fx)
  fx.push('recover')
  log(s, 'info', `Back on your feet at the edge of ${s.zone.name}.`)
}

function camp(s: Save, rng: Rng, toasts: string[], fx: Fx[]) {
  fx.push('camp')
  const price = potionPrice(s.zone.depth)
  let bought = 0
  while (s.hero.potions < 5 && s.hero.gold >= price) {
    s.hero.gold -= price
    s.hero.potions++
    bought++
  }
  s.hero.hp = heroStats(s.hero).maxHp
  if (bought) log(s, 'info', `The camp merchant sells you ${bought} potion${bought > 1 ? 's' : ''}.`)
  forge(s, fx)
  s.zone = makeZone(rng, s.zone.depth + 1, s.zone.biome)
  s.phase = 'exploring'
  s.stats.maxDepth = Math.max(s.stats.maxDepth, s.zone.depth)
  const mod = s.zone.modifier ? ` [${MODIFIERS[s.zone.modifier].label}: ${MODIFIERS[s.zone.modifier].desc}]` : ''
  log(s, 'boss', `Depth ${s.zone.depth}: ${s.zone.name}. ${s.zone.desc}${mod}`)
  toasts.push(`🗺 Depth ${s.zone.depth}: ${s.zone.name}`)
}

/** How far the blacksmith can push an item: rarer metal takes more work. */
export const UPGRADE_CAP: Record<Rarity, number> = { common: 2, uncommon: 4, rare: 6, epic: 8, legendary: 10 }

/** The blacksmith spends what gold is left on the weakest equipped piece, one upgrade at a time. */
function forge(s: Save, fx: Fx[]) {
  const done: Partial<Record<Slot, number>> = {}
  let spent = 0
  for (;;) {
    const worn = SLOTS.map(slot => s.hero.gear[slot]).filter((i): i is Item => i !== null && (i.upgrades ?? 0) < UPGRADE_CAP[i.rarity])
    if (worn.length === 0) break
    const weakest = worn.reduce((a, b) => (powerOf(b) < powerOf(a) ? b : a))
    const cost = upgradeCost(weakest, s.zone.depth)
    if (s.hero.gold < cost) break
    s.hero.gold -= cost
    spent += cost
    weakest.upgrades = (weakest.upgrades ?? 0) + 1
    done[weakest.slot] = (done[weakest.slot] ?? 0) + 1
  }
  if (spent === 0) return
  fx.push('forge')
  const what = SLOTS.filter(slot => done[slot]).map(slot => itemLabel(s.hero.gear[slot]!)).join(', ')
  log(s, 'loot', `The blacksmith hammers away for ${spent}g: ${what}.`)
}

/** A pet joins the collection; the first one found follows Clawd at once, a duplicate levels up. */
export function gainPet(s: Save, id: PetId, toasts: string[], fx: Fx[]) {
  const pet = PETS[id]
  const pets = s.hero.pets ?? []
  const owned = pets.find(p => p.id === id)
  fx.push('pet')
  if (owned && owned.level >= PET_MAX_LEVEL) {
    s.hero.gold += 50 * s.zone.depth
    log(s, 'loot', `Another ${pet.name}! Yours is already level ${PET_MAX_LEVEL}; it finds you ${50 * s.zone.depth}g instead.`)
    return
  }
  if (owned) {
    s.hero.pets = pets.map(p => (p.id === id ? { ...p, level: p.level + 1 } : p))
    log(s, 'loot', `Another ${pet.name} joins in: your ${pet.name} is now level ${owned.level + 1}.`)
    toasts.push(`${pet.name} reached level ${owned.level + 1}`)
    return
  }
  s.hero.pets = [...pets, { id, level: 1 }]
  if (!s.hero.activePet) s.hero.activePet = id
  const following = s.hero.activePet === id ? ', now following Clawd' : ''
  const isWild = LEGENDS.some(l => l.id === id)
  log(s, 'loot', isWild ? `${pet.name} joins as a pet! (+${pet.base}${pet.unit}${following})` : `A ${pet.name} wants to come along! (+${pet.base}${pet.unit}${following})`)
  toasts.push(`New pet: ${pet.name}`)
}

export function setActivePet(save: Save, id: PetId): Save {
  return save.hero.pets?.some(p => p.id === id) ? { ...save, hero: { ...save.hero, activePet: id } } : save
}

const goldBonus = (s: Save) => 1 + petBonus(s.hero, 'gold') / 100

/**
 * A successful `git commit` opens a chest. The first in 30 minutes is a good one and starts the
 * window; commits inside the window open small ones.
 */
export function chestKind(save: Save, now: number): ChestKind {
  return save.lastGoodChestAt === undefined || now - save.lastGoodChestAt >= CHEST_WINDOW_MS ? 'good' : 'small'
}

export function openChest(save: Save, now: number, rng: Rng): TickResult & { kind: ChestKind } {
  const s = clone(save)
  const toasts: string[] = []
  const fx: Fx[] = ['chest']
  const kind = chestKind(s, now)
  const depth = s.zone.depth
  // Opened on the road, it stays there; opened mid-fight, it only flashes by.
  s.chestOnRoad = s.phase === 'exploring'
  if (kind === 'good') {
    s.lastGoodChestAt = now
    const gold = Math.round((20 + 10 * depth) * between(rng, 0.8, 1.2) * goldBonus(s))
    s.hero.gold += gold
    log(s, 'loot', `A commit! Clawd pries open a treasure chest: ${gold}g.`)
    toasts.push(`Treasure chest! +${gold}g`)
    gainItem(s, loot(s, rng, 'lucky', 'uncommon'), toasts, fx)
    if (rng() < 0.15) gainPet(s, pick(rng, COMMON_PETS), toasts, fx)
  } else {
    const gold = Math.round((5 + 3 * depth) * between(rng, 0.8, 1.2) * goldBonus(s))
    s.hero.gold += gold
    log(s, 'loot', `Another commit: a small chest with ${gold}g.`)
    if (rng() < 0.35) gainItem(s, loot(s, rng, 'neutral', 'common', 'uncommon'), [], fx)
  }
  achievements(s, toasts)
  return { save: s, toasts, fx: fx.filter((f, i) => fx.indexOf(f) === i), kind }
}

function levelUps(s: Save, toasts: string[], fx: Fx[]) {
  while (s.hero.xp >= xpToNext(s.hero.level)) {
    s.hero.xp -= xpToNext(s.hero.level)
    s.hero.level++
    fx.push('level')
    heal(s, 12)
    const skill = SKILLS.find(k => k.level === s.hero.level)
    log(s, 'level', `Level up! Clawd is now level ${s.hero.level}.${skill ? ` New skill: ${skill.name}.` : ''}`)
    toasts.push(`⬆ Level ${s.hero.level}${skill ? `, new skill: ${skill.name}` : ''}`)
  }
}

function achievements(s: Save, toasts: string[]) {
  for (const a of ACHIEVEMENTS) {
    if (s.achievements.includes(a.id) || !a.check(s)) continue
    s.achievements = [...s.achievements, a.id]
    log(s, 'level', `🏆 Achievement unlocked: ${a.name}`)
    toasts.push(`🏆 ${a.name}: ${a.desc}`)
  }
}

/** One game tick: a prompt or a response. Consumes the pending luck. */
export function tick(save: Save, rng: Rng): TickResult {
  const s = clone(save)
  const toasts: string[] = []
  const fx: Fx[] = []
  const luck = nextLuck(s)
  if ((s.omens ?? 0) > 0) s.omens = s.omens! - 1
  s.pendingLuck = 'neutral'
  s.stats.ticks++
  if (luck === 'lucky') {
    s.stats.luckyStreak++
    s.stats.unluckyStreak = 0
  } else if (luck === 'unlucky') {
    s.stats.unluckyStreak++
    s.stats.luckyStreak = 0
  }

  if (s.phase === 'exploring') explore(s, luck, rng, fx, toasts)
  else if (s.phase === 'fighting' && s.enemy) fight(s, luck, rng, toasts, fx)
  else if (s.phase === 'recovering') recover(s, luck, fx)
  else if (s.phase === 'camp') camp(s, rng, toasts, fx)
  else s.phase = 'exploring'

  levelUps(s, toasts, fx)
  achievements(s, toasts)
  // A chest left on the road goes once anything but a quiet stretch of walking happens.
  if (s.chestOnRoad && (s.phase !== 'exploring' || fx.some(f => f !== 'explore'))) s.chestOnRoad = false
  if (titleOf(s) !== titleOf(save)) {
    log(s, 'level', `Word spreads of ${heroName(s)}.`)
    toasts.push(`New title: ${heroName(s)}`)
  }
  s.hero.hp = Math.max(0, Math.min(s.hero.hp, heroStats(s.hero).maxHp))
  return { save: s, toasts, fx }
}

export const bar = (value: number, max: number, width: number, full = '█', empty = '░') => {
  const n = max <= 0 ? 0 : Math.max(0, Math.min(width, Math.round((value / max) * width)))
  return full.repeat(n) + empty.repeat(width - n)
}

export function statusLine(s: Save): string {
  const st = heroStats(s.hero)
  const doing =
    s.phase === 'fighting' && s.enemy
      ? `vs ${s.enemy.name} ${Math.max(0, s.enemy.hp)}/${s.enemy.maxHp}`
      : s.phase === 'recovering'
        ? 'recovering'
        : s.phase === 'camp'
          ? 'at camp'
          : 'exploring'
  const next = nextLuck(s)
  const luck = next === 'lucky' ? ' · lucky' : next === 'unlucky' ? ` · unlucky${(s.omens ?? 0) > 1 ? ` ×${s.omens}` : ''}` : ''
  // Two spaces: terminals draw the sword two cells wide but lay it out as one, eating a space.
  return `⚔  ${heroName(s)} · Lv${s.hero.level} ${bar(s.hero.xp, xpToNext(s.hero.level), 5, '▰', '▱')} HP ${s.hero.hp}/${st.maxHp} · D${s.zone.depth} ${s.zone.name} ${bar(s.zone.progress, s.zone.length, 6, '▓', '░')} · ${doing}${luck}`
}
