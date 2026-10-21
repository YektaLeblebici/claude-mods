import type { Burst, Enemy, Fx, LogKind } from '../types'

/**
 * What the pixel-art band (`pixel.ts`) shares with the rest of the mod: the band's size and effect
 * timing, Clawd and the enemies as quarter-block glyph art, which enemy takes which shape, effect
 * shouts, log colours and the caption marquee.
 */

export const SCENE_ROWS = 6
/** Frames each effect of a burst plays for; at ~3 fps, one effect is about a second. */
export const FX_FRAMES = 3
export const MAX_BURST_FX = 4

export type Segment = { text: string; color?: string; bold?: boolean; bg?: string }
export type Sprite = string[]

// Spaces in a sprite are transparent: scenery behind shows through.
export const CLAWD = {
  walkA: [' ▐▛███▜▌ ', '▝▜█████▛▘', '  ▘▘ ▝▝  '],
  walkB: [' ▐▛███▜▌ ', '▝▜█████▛▘', ' ▘▘   ▝▝ '],
  cheer: ['\\▐▛███▜▌/', ' ▜█████▛ ', '  ▘▘ ▝▝  '],
  down: ['         ', '  ▄▄▄▄▄  ', '▝▀▀▀▀▀▀▀▘'],
}

export type Archetype = 'beast' | 'humanoid' | 'flyer' | 'swarm' | 'blob' | 'construct' | 'spirit' | 'crawler' | 'giant' | 'wyrm'

/** Quarter blocks by which of their four pixels are filled: top-left, top-right, bottom-left, bottom-right. */
export const QUADRANTS: Record<string, string> = {
  '0000': ' ', '1000': '▘', '0100': '▝', '0010': '▖', '0001': '▗', '1100': '▀', '0011': '▄', '1010': '▌',
  '0101': '▐', '1001': '▚', '0110': '▞', '1110': '▛', '1101': '▜', '1011': '▙', '0111': '▟', '1111': '█',
}

/**
 * Pixel art the way Clawd is drawn: `#` is a filled pixel, `.` an empty one, six rows of pixels to
 * three rows of text, each 2×2 pixels one quarter-block character. Empty pixels inside the body
 * (eyes, gaps between legs) show the scenery's background, as Clawd's eyes do.
 */
export function pixels(grid: string[]): Sprite {
  const width = grid[0]!.length
  if (grid.length !== 6 || width % 2 !== 0 || grid.some(row => row.length !== width))
    throw new Error(`pixel sprite must be 6 rows of one even width: ${grid.join('|')}`)
  const at = (y: number, x: number) => (grid[y]![x] === '#' ? '1' : '0')
  return [0, 2, 4].map(y =>
    Array.from({ length: width / 2 }, (_, i) => QUADRANTS[at(y, 2 * i) + at(y, 2 * i + 1) + at(y + 1, 2 * i) + at(y + 1, 2 * i + 1)]!).join(''),
  )
}

// Two idle frames each, all facing left toward Clawd.
export const ARCHETYPES: Record<Archetype, [Sprite, Sprite]> = {
  beast: [
    pixels([
      '..#.#...........',
      '.#####.........#',
      '#.############..',
      '.#############..',
      '..##.##..##.##..',
      '..#...#..#...#..',
    ]),
    pixels([
      '..#.#...........',
      '.#####.........#',
      '#.############.#',
      '.#############..',
      '..##.##..##.##..',
      '...#.#....#.#...',
    ]),
  ],
  humanoid: [
    pixels([
      '....####....',
      '...#.##.#...',
      '....####....',
      '..########..',
      '.#.######.#.',
      '...##..##...',
    ]),
    pixels([
      '....####....',
      '...#.##.#...',
      '....####....',
      '.##########.',
      '...######...',
      '..##....##..',
    ]),
  ],
  flyer: [
    pixels([
      '#..............#',
      '##....####....##',
      '.###.#.##.#.###.',
      '..############..',
      '......####......',
      '.......##.......',
    ]),
    pixels([
      '................',
      '......####......',
      '##...#.##.#...##',
      '.##############.',
      '..###.####.###..',
      '.......##.......',
    ]),
  ],
  swarm: [
    pixels([
      '.#....#.....#...',
      '...##....#....#.',
      '#....#.##...#...',
      '..#.....#..#..#.',
      '.....#.#....#...',
      '.#..#.....#.....',
    ]),
    pixels([
      '...#....#.....#.',
      '.#....##....#...',
      '...#.....#.##...',
      '#....#.#.....#..',
      '..#.....#..#....',
      '....#.#.....#.#.',
    ]),
  ],
  blob: [
    pixels([
      '..............',
      '.....####.....',
      '...########...',
      '..##.####.##..',
      '.############.',
      '##############',
    ]),
    pixels([
      '..............',
      '..............',
      '....######....',
      '.###.####.###.',
      '##############',
      '##############',
    ]),
  ],
  construct: [
    pixels([
      '...########...',
      '...#..##..#...',
      '...########...',
      '##.########.##',
      '##.########.##',
      '...###..###...',
    ]),
    pixels([
      '...########...',
      '...#..##..#...',
      '...########...',
      '.#.########.#.',
      '#..########..#',
      '...###..###...',
    ]),
  ],
  spirit: [
    pixels([
      '...######...',
      '..########..',
      '..#..##..#..',
      '..########..',
      '..########..',
      '..#.##.##.#.',
    ]),
    pixels([
      '...######...',
      '..########..',
      '..#..##..#..',
      '..########..',
      '..########..',
      '...##.##.##.',
    ]),
  ],
  crawler: [
    pixels([
      '.#............#.',
      '#.#..######..#.#',
      '...#.#.##.#.#...',
      '....########....',
      '..##.######.##..',
      '.#...#....#...#.',
    ]),
    pixels([
      '#..............#',
      '.#...######...#.',
      '..##.#.##.#.##..',
      '....########....',
      '.#..########..#.',
      '#...#......#...#',
    ]),
  ],
  giant: [
    pixels([
      '.......########.......',
      '......#..####..#......',
      '.......########.......',
      '...################...',
      '..##.############.##..',
      '.......###....###.....',
    ]),
    pixels([
      '.......########.......',
      '##....#..####..#....##',
      '.##....########....##.',
      '..################.#..',
      '....############......',
      '.......###....###.....',
    ]),
  ],
  wyrm: [
    pixels([
      '...##......#...#...#....',
      '.#####...#############..',
      '#.######################',
      '#####..###############.#',
      '........##############..',
      '.........##...##...##...',
    ]),
    pixels([
      '...##......#...#...#....',
      '.#####...#############..',
      '#.######################',
      '####...################.',
      '........##############.#',
      '.........##...##...##...',
    ]),
  ],
}

const ARCHETYPE_RULES: [RegExp, Archetype][] = [
  [/swarm/i, 'swarm'],
  [/spider|scorpion|crab|hermit|turtle/i, 'crawler'],
  [/bee|pixie|crow|hawk|harpy|wisp|lantern|sprite|gaze|bat/i, 'flyer'],
  [/leech|slug|glowworm|star eater|anglerfiend/i, 'blob'],
  [/scarecrow|mimic|golem|armor|automaton|sentinel|steam|avalanche|guardian|null knight|clockwork|twigling|snowman/i, 'construct'],
  [/wraith|banshee|specter|elemental|echo|stalker|paradox|ghost/i, 'spirit'],
  [/badger|boar|wolf|stag|frog|jackal|shark|salamander|hound|ram|yeti/i, 'beast'],
]
const BOSS_WYRM = /wyrm|worm|ouroth|gulper|kraken|phoenix|roc|maw/i

export function archetypeOf(enemy: Pick<Enemy, 'name' | 'isBoss'>): Archetype {
  if (enemy.isBoss) return BOSS_WYRM.test(enemy.name) ? 'wyrm' : 'giant'
  return ARCHETYPE_RULES.find(([rule]) => rule.test(enemy.name))?.[1] ?? 'humanoid'
}

/** A layer that repeats and scrolls: its text, and the colour its marks are drawn in. */
export const KIND_COLOR: Partial<Record<LogKind, string>> = {
  lucky: 'success',
  unlucky: 'error',
  ko: 'error',
  loot: 'warning',
  level: 'claude',
  boss: 'merged',
}

/** The effect a burst plays at `frame`, with the frame inside that effect, or null once it has ended. */
export function activeFx(burst: Burst | null, frame: number): { fx: Fx; local: number } | null {
  if (!burst) return null
  const elapsed = frame - burst.at
  const index = Math.floor(elapsed / FX_FRAMES)
  if (elapsed < 0 || index >= burst.fx.length) return null
  return { fx: burst.fx[index]!, local: elapsed % FX_FRAMES }
}

/** The effects worth a burst, in the order they happened; walking and resting are the idle loop's. */
export function burstFx(fx: Fx[]): Fx[] {
  return fx.filter(f => f !== 'explore' && f !== 'rest').slice(0, MAX_BURST_FX)
}

/** What each effect shouts, and in which colour. */
export const SHOUTS: Partial<Record<Fx, [string, string]>> = {
  crit: ['CRIT!', 'warning'],
  miss: ['miss', 'subtle'],
  dodge: ['dodge!', 'success'],
  win: ['VICTORY', 'success'],
  loot: ['LOOT!', 'warning'],
  gold: ['$$$', 'warning'],
  level: ['LEVEL UP!', 'claude'],
  potion: ['+ gulp +', 'success'],
  encounter: ['!', 'error'],
  boss: ['BOSS!', 'merged'],
  legend: ['WILD!', 'merged'],
  recover: ['back up!', 'success'],
  camp: ['camp', 'warning'],
  forge: ['CLANG!', 'warning'],
  chest: ['CHEST!', 'warning'],
  pet: ['NEW PET!', 'success'],
  hurt: ['ouch', 'error'],
}

/** Frames a too-long caption holds still at its start and at its end. */
export const MARQUEE_HOLD = 6

/**
 * `text` fitted to `room` cells. Text that fits stands still; longer text shows its start, slides
 * along a character a frame, holds its end, and starts over, `age` being frames since it appeared.
 * A `…` at either edge says more lies that way.
 */
export function marquee(text: string, room: number, age: number): string {
  const chars = [...text]
  if (room <= 0) return ''
  if (chars.length <= room) return text
  const steps = chars.length - room
  const cycle = MARQUEE_HOLD * 2 + steps
  const t = ((age % cycle) + cycle) % cycle
  const start = Math.min(steps, Math.max(0, t - MARQUEE_HOLD))
  const window = chars.slice(start, start + room)
  if (start > 0) window[0] = '…'
  if (start < steps) window[window.length - 1] = '…'
  return window.join('')
}
