export type Luck = 'lucky' | 'unlucky' | 'neutral'
export type Rarity = 'common' | 'uncommon' | 'rare' | 'epic' | 'legendary'
export type Slot = 'weapon' | 'armor' | 'trinket'
export type Affix = 'vampiric' | 'keen' | 'sturdy' | 'fortunate' | 'swift' | 'thorns' | 'warding'
export type ZoneModifier = 'misty' | 'cursed' | 'bountiful' | 'haunted' | 'blessed'
export type Phase = 'exploring' | 'fighting' | 'recovering' | 'camp'
export type Fx =
  | 'explore' | 'encounter' | 'boss' | 'hit' | 'crit' | 'miss' | 'hurt' | 'dodge'
  | 'win' | 'loot' | 'gold' | 'potion' | 'level' | 'ko' | 'rest' | 'recover' | 'camp'
  | 'forge' | 'chest' | 'pet' | 'legend'
export type LegendId = 'tim' | 'tarbolts' | 'freeman' | 'sam'
export type PetId = 'slime' | 'duck' | 'bat' | 'dragon' | 'turtle' | 'cat' | 'owl' | 'wisp' | LegendId
export type OwnedPet = { id: PetId; level: number }
export type ChestKind = 'good' | 'small'
export type LogKind = 'info' | 'lucky' | 'unlucky' | 'loot' | 'combat' | 'level' | 'boss' | 'ko'

export type Item = {
  name: string
  slot: Slot
  rarity: Rarity
  power: number
  affixes: Affix[]
  score: number
  /** Blacksmith upgrades, each +1 power. */
  upgrades?: number
}

export type Enemy = {
  name: string
  desc: string
  hp: number
  maxHp: number
  atk: number
  def: number
  xp: number
  gold: number
  verbs: string[]
  isBoss: boolean
  isElite: boolean
  defeat: string
  /** A wild character: who it is, and the colour it is drawn in. */
  legend?: LegendId
  tint?: string
}

export type Zone = {
  depth: number
  biome: string
  name: string
  desc: string
  length: number
  progress: number
  modifier: ZoneModifier | null
}

export type Hero = {
  name: string
  level: number
  xp: number
  hp: number
  gold: number
  potions: number
  gear: { weapon: Item | null; armor: Item | null; trinket: Item | null }
  pets?: OwnedPet[]
  activePet?: PetId | null
}

export type Fight = { exchanges: number; allUnlucky: boolean; secondWindUsed: boolean }

export type Stats = {
  ticks: number
  kills: number
  bosses: number
  knockouts: number
  luckyStreak: number
  unluckyStreak: number
  maxDepth: number
  epicFound: boolean
  legendaryFound: boolean
  wonAgainstOdds: boolean
  /** Drops in a row that were no upgrade; at PITY the next one is. */
  dry?: number
}

/** A log line; `tone` (a colour) and `strong` (bold) dress up the hardest hits. */
export type LogEntry = { kind: LogKind; text: string; tone?: string; strong?: boolean }

export type Save = {
  version: 1
  /** Bumped on every write, so sessions can tell another one changed it. */
  rev?: number
  /** Failures not yet paid for: each makes a coming tick unlucky, whatever succeeded since (max 3). */
  omens?: number
  /** Wild characters beaten, who therefore never appear again. */
  legendsBeaten?: LegendId[]
  /** A chest opened while exploring stays beside Clawd until anything else happens. */
  chestOnRoad?: boolean
  /** When the last good chest opened (ms since epoch); commits within 30 minutes open small ones. */
  lastGoodChestAt?: number
  hero: Hero
  zone: Zone
  phase: Phase
  enemy: Enemy | null
  fight: Fight
  recoverLeft: number
  pendingLuck: Luck
  log: LogEntry[]
  achievements: string[]
  stats: Stats
}

/** How the animated band is drawn: pixel art (the default) or text art. */
export type ArtStyle = 'ascii' | 'pixel'

/** What the band is playing after a tick: its effects in order, from `at` (a frame), against `enemy`. */
export type Burst = { fx: Fx[]; at: number; enemy: Enemy | null }

declare module 'claude-code' {
  interface PluginState {
    'clawd-rpg': { save: Save; animOn: boolean; frame: number; burst: Burst | null; style: ArtStyle; hidden: boolean }
  }
}
