import type { Burst, Enemy, Fx, LogKind, Save } from '../types'
import { PETS } from './content'
import { heroStats, nextLuck } from './engine'

export const SCENE_ROWS = 6
/** Frames each effect of a burst plays for; at ~3 fps, one effect is about a second. */
export const FX_FRAMES = 3
export const MAX_BURST_FX = 4

export type Segment = { text: string; color?: string; bold?: boolean; bg?: string }
type Cell = { ch: string; color?: string; bold?: boolean; bg?: string }
export type Sprite = string[]

// Spaces in a sprite are transparent: scenery behind shows through.
export const CLAWD = {
  walkA: [' ▐▛███▜▌ ', '▝▜█████▛▘', '  ▘▘ ▝▝  '],
  walkB: [' ▐▛███▜▌ ', '▝▜█████▛▘', ' ▘▘   ▝▝ '],
  cheer: ['\\▐▛███▜▌/', ' ▜█████▛ ', '  ▘▘ ▝▝  '],
  down: ['         ', '  ▄▄▄▄▄  ', '▝▀▀▀▀▀▀▀▘'],
}
const SWORD = '━━╸'

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
  [/scarecrow|mimic|golem|armor|automaton|sentinel|steam|avalanche|guardian|null knight|clockwork|twigling/i, 'construct'],
  [/wraith|banshee|specter|elemental|echo|stalker|paradox|ghost/i, 'spirit'],
  [/badger|boar|wolf|stag|frog|jackal|shark|salamander|hound|ram|yeti/i, 'beast'],
]
const BOSS_WYRM = /wyrm|worm|ouroth|gulper|kraken|phoenix|roc|maw/i

export function archetypeOf(enemy: Pick<Enemy, 'name' | 'isBoss'>): Archetype {
  if (enemy.isBoss) return BOSS_WYRM.test(enemy.name) ? 'wyrm' : 'giant'
  return ARCHETYPE_RULES.find(([rule]) => rule.test(enemy.name))?.[1] ?? 'humanoid'
}

/** A layer that repeats and scrolls: its text, and the colour its marks are drawn in. */
type Strip = { art: string; color: string }
type Prop = { art: Sprite; color: string }

/**
 * How a biome looks, back to front. Rows 0–4 are filled with `fill` (sky, sky, horizon, mid, ground);
 * the sky strip scrolls at a quarter of the walk, the far silhouette at half, everything nearer at full.
 */
type Look = {
  fill: [string, string, string, string, string]
  sky: Strip
  far: { art: [string, string]; color: string }
  mid: Strip
  ground: Strip
  props: Prop[]
  label: string
  foe: string
  boss: string
}

const LOOKS: Record<string, Look> = {
  meadow: {
    fill: ['#4a86c5', '#6aa3d8', '#8cbfe3', '#5c9e47', '#6fae4f'],
    sky: { art: '      .-~~-.        (O)          .-~-.             ', color: '#ffffff' },
    far: { art: ['         _.-~~-._                  _.--._         ', '  _.-~~-\'        \'~-._     _.-~~-\'      \'~~-._ _.-'], color: '#4f8a4a' },
    mid: { art: '  ,  * .  ,, *  . ,  *  .,  *  ', color: '#f4e04d' },
    ground: { art: '"\',.\'^"\'.,^\'.,', color: '#3d6b2a' },
    props: [
      { art: [' (@@) ', '(@@@@)', '  ||  '], color: '#1f5e1f' },
      { art: ['      ', '|-|-|-|', '| | | |'], color: '#8d6e63' },
      { art: ['  *   ', ' \\|/  ', '  |   '], color: '#e91e63' },
    ],
    label: '#ffffff',
    foe: '#5d2e0f',
    boss: '#3e1f0a',
  },
  caves: {
    fill: ['#1a1513', '#231d1a', '#2b2421', '#332b27', '#3d342e'],
    sky: { art: 'V  v vV   V v  vV    v  V vv  V ', color: '#6d625a' },
    far: { art: ['  /^\\    _____    /^^\\    ___   ', ' /   \\__/     \\__/    \\__/   \\_'], color: '#4a403a' },
    mid: { art: '  o .  ,  o.   .  o  ,   ', color: '#6a5c52' },
    ground: { art: '_.-._.-\'-._', color: '#8a7a6c' },
    props: [
      { art: ['  ^  ', ' /#\\ ', '/###\\'], color: '#8d7e72' },
      { art: [' )  ', ' #  ', ' |  '], color: '#ffb74d' },
      { art: [' /\\ ', '<**>', ' \\/ '], color: '#80deea' },
    ],
    label: '#e0d6cc',
    foe: '#9ccc65',
    boss: '#c5e1a5',
  },
  woods: {
    fill: ['#2e2840', '#3b3352', '#3a4448', '#2f3d33', '#3b4a2f'],
    sky: { art: '      v        )         v          .    ', color: '#e8e0b8' },
    far: { art: ['  ^    ^^   ^    ^ ^   ^^   ^  ', ' /|\\  /||\\ /|\\  /|/|\\ /||\\ /|\\ '], color: '#1e2a22' },
    mid: { art: '~ ~~  ~ ~~~ ~  ~~   ~~ ', color: '#8a9a90' },
    ground: { art: '._,.;_.,_;', color: '#7a8a52' },
    props: [
      { art: ['\\ | /', ' \\|/ ', '  |  '], color: '#9a8470' },
      { art: [' .-. ', '(___)', '  |  '], color: '#c39bf0' },
      { art: [' .-. ', ' |R| ', ' |_| '], color: '#9e9e9e' },
    ],
    label: '#e8e0b8',
    foe: '#d1b3ff',
    boss: '#f48fb1',
  },
  swamp: {
    fill: ['#3d4630', '#4b5639', '#4f5e48', '#3e5a4c', '#4b4630'],
    sky: { art: '  .     *    .   *     .     *  ', color: '#e6ee9c' },
    far: { art: [' _/\\_     __    _/\\_    _    ', '/ || \\   /  \\  / || \\  / \\   '], color: '#2a3220' },
    mid: { art: '~≈~ ~≈~~ ≈ ~~≈~  ≈~', color: '#8fb0a0' },
    ground: { art: '.,~.,.~,.', color: '#7a7248' },
    props: [
      { art: [' ,  ,', '\\|/\\|', ' | | '], color: '#aed581' },
      { art: ['  /\\  ', ' /__\\ ', ' |[]| '], color: '#a1887f' },
      { art: ['_\\ /_', '  |  ', '  |  '], color: '#6d5a48' },
    ],
    label: '#f0f4c3',
    foe: '#dce775',
    boss: '#fff176',
  },
  desert: {
    fill: ['#e8a24a', '#f0b862', '#f3c77e', '#e3b46a', '#d9a85c'],
    sky: { art: '    ~       ( O )        ~        -    ', color: '#fff8e1' },
    far: { art: ['      /\\          _.-~-._        ', '_.-~ /  \\ ~-.__.-\'       \'~-._.-~'], color: '#b8742a' },
    mid: { art: '.  :  .   ..  :   .  ', color: '#a8702e' },
    ground: { art: '. . : ._.:. .', color: '#9a6528' },
    props: [
      { art: [' (|  ', '\\(|)/', '  |  '], color: '#2e7d32' },
      { art: ['_[_]_', ' | | ', ' |_| '], color: '#f5ecd6' },
      { art: ['     ', ' .-. ', '(x.x)'], color: '#fafafa' },
    ],
    label: '#4e2a0a',
    foe: '#7f1d0a',
    boss: '#4a0e05',
  },
  frost: {
    fill: ['#8fb4d9', '#a9c9e8', '#c4dcf0', '#dceaf5', '#eef5fb'],
    sky: { art: '*  .   *   .  *    .    *   ', color: '#ffffff' },
    far: { art: ['   /\\        /\\/\\       /\\  ', '  /**\\  /\\  /****\\  /\\ /**\\ '], color: '#5f7f9f' },
    mid: { art: '  ^  ^^   ^  ^^^    ^ ', color: '#6f8fa8' },
    ground: { art: '--- __ -- ___ ', color: '#9db8cc' },
    props: [
      { art: ['  *  ', ' /*\\ ', '/***\\'], color: '#1f5c44' },
      { art: [' \\|/ ', '-<*>-', ' /|\\ '], color: '#0288d1' },
      { art: [' (") ', '( : )', '(___)'], color: '#78909c' },
    ],
    label: '#0d3a5c',
    foe: '#0d47a1',
    boss: '#1a237e',
  },
  volcano: {
    fill: ['#2a1612', '#3d1d16', '#6a2a18', '#8a2f12', '#2a1a16'],
    sky: { art: '\'  .  \'   *  .  \'     .   * ', color: '#ff8a50' },
    far: { art: ['        _/\\_          ', '  /\\__/    \\__/\\      '], color: '#160b08' },
    mid: { art: '~^~  ~~^~ ~^^~   ^~ ', color: '#ffcc80' },
    ground: { art: '~^~^^~^~~', color: '#ff5722' },
    props: [
      { art: [' ) ( ', '( ) )', '/###\\'], color: '#ff7043' },
      { art: ['  ^  ', ' /#\\ ', '/###\\'], color: '#5a4a50' },
      { art: ['     ', ' .-. ', '(o_o)'], color: '#bcaaa4' },
    ],
    label: '#ffccbc',
    foe: '#ffab91',
    boss: '#ffeb3b',
  },
  crypt: {
    fill: ['#17171c', '#1e1e24', '#26262e', '#2a2a33', '#33333d'],
    sky: { art: '-v--v-----v---v----v--', color: '#5a5a66' },
    far: { art: [' _____    _____    ___  ', '|  _  |__|  _  |__| _ |_'], color: '#3e3e4c' },
    mid: { art: '  ~   o=o   .   ~    ', color: '#bdbdbd' },
    ground: { art: '=_=_==_=_', color: '#55556a' },
    props: [
      { art: [' .-. ', ' |+| ', ' |_| '], color: '#9e9e9e' },
      { art: [' ,  ', ' |  ', '_|_ '], color: '#ffd54f' },
      { art: [' ___ ', '/ + \\', '\\___/'], color: '#8d6e63' },
    ],
    label: '#cfcfdf',
    foe: '#b9f6ca',
    boss: '#69f0ae',
  },
  sky: {
    fill: ['#3f7fcf', '#5f98de', '#7fb2ea', '#a8d0f5', '#c5e1fa'],
    sky: { art: '  .-~-.       .-~~-.            ', color: '#ffffff' },
    far: { art: ['    ____          ___       ', '    \\__/    ~~~   \\_/   ~~  '], color: '#3e6b3a' },
    mid: { art: '~~~~  ~~~~~   ~~~   ', color: '#ffffff' },
    ground: { art: '.oOo.oO0Oo.oOo.', color: '#90b8de' },
    props: [
      { art: ['  |> ', '  |  ', ' _|_ '], color: '#e65100' },
      { art: [' (@) ', '  |  ', '\\___/'], color: '#2e7d32' },
      { art: [' o ', ' o ', ' o '], color: '#546e7a' },
    ],
    label: '#ffffff',
    foe: '#4a148c',
    boss: '#b71c1c',
  },
  sunken: {
    fill: ['#0a2f48', '#0d3b5a', '#11506f', '#176a80', '#6b6040'],
    sky: { art: '  o   .  O   .  o    .  ', color: '#80deea' },
    far: { art: ['   _  |^|     _[]_     ', '  | |_| |_   |    |_   '], color: '#3a8fa6' },
    mid: { art: '  Y  ww  Y  w  Y   ', color: '#ff8a80' },
    ground: { art: '.  ,  . ,  .', color: '#d8c890' },
    props: [
      { art: [' )  ', '(   ', ' )  '], color: '#4db6ac' },
      { art: ['     ', ' \\|/ ', '--*--'], color: '#ff8a65' },
      { art: ['  o  ', ' -|- ', ' \\_/ '], color: '#b0bec5' },
    ],
    label: '#b2ebf2',
    foe: '#ffcc80',
    boss: '#ff8a65',
  },
  clockwork: {
    fill: ['#2e241e', '#3a2e26', '#4a3a2e', '#4f4033', '#3a3028'],
    sky: { art: '=|===|====|===|=', color: '#b08d57' },
    far: { art: ['   _|_    (*)    |_|  ', '  |___|  (*o*)  |___| '], color: '#5e4c3c' },
    mid: { art: '>>  >>  >>  >>  ', color: '#c0a060' },
    ground: { art: '#=#=#=#=#', color: '#8d7a60' },
    props: [
      { art: ['.-*-.', '* o *', "'-*-'"], color: '#e0b030' },
      { art: [' _|_ ', '(_X_)', '  |  '], color: '#c87f45' },
      { art: [' [o] ', '  |  ', ' _|_ '], color: '#ffe082' },
    ],
    label: '#f0dcb0',
    foe: '#80deea',
    boss: '#ff5252',
  },
  void: {
    fill: ['#07040e', '#0e0719', '#160b28', '#190d2e', '#120a22'],
    sky: { art: ' .  *    +   .   *    .  ', color: '#ffffff' },
    far: { art: ['    .-.         *     ', '   (   )   ~~~~       '], color: '#6a4bb0' },
    mid: { art: '   .    +    .     ', color: '#b39ddb' },
    ground: { art: '.  .  .  .  ', color: '#7e57c2' },
    props: [
      { art: ['  ^  ', ' /|\\ ', ' \\|/ '], color: '#e1bee7' },
      { art: [' .-. ', '( @ )', " '-' "], color: '#ba68c8' },
      { art: ['     ', ' ___ ', ' \\_/ '], color: '#7c6cd8' },
    ],
    label: '#e1d5ff',
    foe: '#f8bbd0',
    boss: '#ff80ab',
  },
}

/** The colours a biome's enemies and bosses take, shared by every art style. */
export const biomeFoeColors = (biome: string) => {
  const look = LOOKS[biome] ?? LOOKS.meadow!
  return { foe: look.foe, boss: look.boss }
}

export const KIND_COLOR: Partial<Record<LogKind, string>> = {
  lucky: 'success',
  unlucky: 'error',
  ko: 'error',
  loot: 'warning',
  level: 'claude',
  boss: 'merged',
}

class Canvas {
  readonly cells: Cell[][]
  /** `fills` paints each row's background; a row without one keeps the terminal's. */
  constructor(width: number, fills: readonly (string | undefined)[]) {
    this.cells = Array.from({ length: SCENE_ROWS }, (_, y) => Array.from({ length: width }, () => ({ ch: ' ', bg: fills[y] })))
  }
  /** Marks keep the background under them: only the glyph and its colour change. */
  put(x: number, y: number, text: string, color?: string, bold?: boolean, isOpaque = false) {
    const row = this.cells[y]
    if (!row) return
    ;[...text].forEach((ch, i) => {
      const cell = row[x + i]
      if (cell && (isOpaque || ch !== ' ')) Object.assign(cell, { ch, color, bold })
    })
  }
  /** Solid between each line's first and last mark, so nothing behind shows through a body. */
  sprite(x: number, y: number, sprite: Sprite, color?: string, bold?: boolean) {
    sprite.forEach((line, i) => {
      const chars = [...line]
      const start = chars.findIndex(ch => ch !== ' ')
      if (start < 0) return
      const end = chars.length - [...chars].reverse().findIndex(ch => ch !== ' ')
      this.put(x + start, y + i, chars.slice(start, end).join(''), color, bold, true)
    })
  }
  /** Repeats `art` across row `y`, shifted by `offset`; its spaces let what is behind show. */
  pattern(y: number, art: string, offset: number, color: string) {
    const chars = [...art]
    const row = this.cells[y]!
    row.forEach((cell, x) => {
      const ch = chars[(((x + offset) % chars.length) + chars.length) % chars.length]!
      if (ch !== ' ') Object.assign(cell, { ch, color, bold: false })
    })
  }
  segments(): Segment[][] {
    return this.cells.map(row => {
      const out: Segment[] = []
      for (const cell of row) {
        const last = out[out.length - 1]
        if (last && last.color === cell.color && last.bold === cell.bold && last.bg === cell.bg) last.text += cell.ch
        else out.push({ text: cell.ch, color: cell.color, bold: cell.bold, bg: cell.bg })
      }
      return out
    })
  }
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

const CHEST: [Sprite, Sprite] = [
  ['      ', ' ____ ', '[_[]_]'],
  [' \$$/ ', ' /__\ ', '[_[]_]'],
]
const ANVIL: Sprite = ['      ', ' ____ ', '  ][  ']

const CAMPFIRE: [Sprite, Sprite] = [
  [' ( ', '(\\)', '/^\\'],
  ['  )', '(/)', '/^\\'],
]

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

/** `captionAge`: frames since the caption's line first showed, for the marquee. */
export function composeScene(save: Save, frame: number, burst: Burst | null, width: number, captionAge = 0): Segment[][] {
  const W = Math.max(30, Math.min(width, 72))
  const look = LOOKS[save.zone.biome] ?? LOOKS.meadow!
  const c = new Canvas(W, look.fill)
  const active = activeFx(burst, frame)
  const fx = active?.fx
  const lf = active?.local ?? 0
  const enemy = (active ? burst?.enemy : null) ?? save.enemy
  const isWalking = !active && save.phase === 'exploring'
  const offset = isWalking ? frame : 0

  // Backdrop, back to front, each layer slower the farther it is.
  c.pattern(0, look.sky.art, Math.floor(offset / 4), look.sky.color)
  c.pattern(1, look.far.art[0], Math.floor(offset / 2), look.far.color)
  c.pattern(2, look.far.art[1], Math.floor(offset / 2), look.far.color)
  c.pattern(3, look.mid.art, offset, look.mid.color)
  c.pattern(4, look.ground.art, offset, look.ground.color)
  // Near props stand only where no actor does: right of Clawd, left of the enemy.
  // Each keeps its place in the world as it scrolls by, so a torch stays a torch.
  const showEnemy =
    enemy !== null &&
    (save.phase === 'fighting' || (active !== null && !['camp', 'recover', 'loot', 'level', 'gold', 'chest', 'pet', 'forge'].includes(fx!)))
  const pet = save.hero.activePet ? PETS[save.hero.activePet] : null
  const home = pet ? 7 : 2
  const propsEnd = showEnemy ? W - 16 : W
  const SPACING = 13
  for (let slot = Math.floor(offset / SPACING); ; slot++) {
    const x = slot * SPACING - offset + 6
    if (x >= propsEnd - 5) break
    if (x <= home + 11) continue
    const prop = look.props[slot % look.props.length]!
    c.sprite(x, 1, prop.art, prop.color)
  }

  // The active pet trots behind Clawd, hopping while they walk.
  if (pet) {
    const hop = isWalking && frame % 2 === 1 ? 1 : 0
    const cheer = (fx === 'pet' || fx === 'level' || fx === 'win') && lf === 1 ? 1 : 0
    c.sprite(0, 2 - hop - cheer, pet.art, pet.color, true)
  }

  // Clawd.
  let cx = home
  let cy = 1
  let body: Sprite = frame % 2 === 0 ? CLAWD.walkA : CLAWD.walkB
  let clawdColor = 'claude'
  if (!isWalking && !active) body = Math.floor(frame / 2) % 2 === 0 ? CLAWD.walkA : CLAWD.walkB
  if (save.phase === 'recovering' && !active) body = CLAWD.down
  if (fx === 'hit' || fx === 'crit' || fx === 'miss') cx += lf === 1 ? 3 : 1
  if (fx === 'hurt') {
    cx -= lf === 1 ? 1 : 0
    clawdColor = lf === 1 ? 'error' : clawdColor
  }
  if (fx === 'dodge' && lf === 1) cy -= 1
  if (fx === 'level' && lf === 1) cy -= 1
  if (fx === 'win' || fx === 'level') body = CLAWD.cheer
  if (fx === 'ko') body = CLAWD.down
  c.sprite(cx, cy, body, clawdColor, true)
  if ((fx === 'hit' || fx === 'crit' || fx === 'miss') && lf === 1) c.put(cx + 9, cy + 1, SWORD, look.label, true)

  // A chest springs open, or the blacksmith's anvil rings, just ahead of Clawd.
  // One chest, standing still beside Clawd while the road scrolls by, until anything else happens.
  const showChest = fx === 'chest' || (!!save.chestOnRoad && save.phase === 'exploring' && !showEnemy && !active)
  if (showChest) c.sprite(cx + 11, 1, CHEST[fx === 'chest' && lf === 0 ? 0 : 1]!, 'warning', true)
  // The anvil stands past the campfire, which takes the spot beside Clawd at camp.
  if (fx === 'forge') c.sprite(cx + 16, 1, ANVIL, look.label, true)

  // Campfire beside a resting hero.
  if (save.phase === 'camp' || save.phase === 'recovering' || fx === 'camp' || fx === 'ko') {
    c.sprite(cx + 11, 1, CAMPFIRE[frame % 2]!, 'warning', true)
    if (save.phase === 'recovering' || fx === 'ko') c.put(cx + 3, 0, frame % 2 ? 'z Z' : ' Zz', 'subtle', false, true)
  }

  // The enemy.
  if (enemy && showEnemy) {
    const frames = ARCHETYPES[archetypeOf(enemy)]
    const sprite = frames[Math.floor(frame / 2) % 2]!
    const w = Math.max(...sprite.map(l => [...l].length))
    let ex = W - w - 3
    let color = enemy.tint ?? (enemy.isBoss ? look.boss : look.foe)
    if (fx === 'encounter' || fx === 'boss' || fx === 'legend') ex += (FX_FRAMES - 1 - lf) * 6
    if ((fx === 'hit' || fx === 'crit') && lf === 1) color = fx === 'crit' ? 'warning' : 'error'
    if ((fx === 'hit' || fx === 'crit') && lf === 2) ex += 1
    if (fx === 'miss' && lf >= 1) ex += 2
    if ((fx === 'hurt' || fx === 'dodge') && lf === 1) ex -= 3
    const isGone = fx === 'win' && lf > 0
    if (isGone) c.put(ex + 2, 2, lf === 1 ? '* . *' : '.   .', color)
    else c.sprite(ex, 1, sprite, color, true)
    const hp = ` ${Math.max(0, isGone ? 0 : enemy.hp)}/${enemy.maxHp}`
    const room = W - (cx + 12) - 1
    const name = [...enemy.name].length + hp.length <= room ? enemy.name : [...enemy.name].slice(0, Math.max(1, room - hp.length - 1)).join('') + '…'
    const label = name + hp
    c.put(Math.max(cx + 12, W - [...label].length - 1), 0, label, color, true, true)
  } else if (!active || fx === 'explore') {
    const label = `D${save.zone.depth} ${save.zone.name}`
    c.put(Math.max(0, W - [...label].length - 1), 0, label, look.label, true, true)
  }

  // Effect captions and sparkles.
  const shout = SHOUTS
  const said = fx ? shout[fx] : undefined
  if (said) c.put(cx + 10, fx === 'chest' || fx === 'forge' ? 0 : 1, said[0], said[1], true, true)
  if ((fx === 'loot' || fx === 'gold' || fx === 'level' || fx === 'chest' || fx === 'forge') && lf !== 1) {
    const spark = fx === 'gold' || fx === 'chest' ? '$' : fx === 'level' ? '^' : '*'
    c.put(cx - 1 + lf * 2, 1, spark, said?.[1], true)
    c.put(cx + 9 - lf, 3, spark, said?.[1], true)
  }

  // Caption: HP, then what just happened.
  const st = heroStats(save.hero)
  const hp = `♥${save.hero.hp}/${st.maxHp} Lv${save.hero.level} │ `
  const last = save.log[save.log.length - 1]
  const next = nextLuck(save)
  const luck = next === 'lucky' ? ' +luck' : next === 'unlucky' ? ' -luck' : ''
  const room = W - [...hp].length - [...luck].length
  const text = marquee(last?.text ?? '', room, captionAge)
  c.put(0, 5, hp, save.hero.hp < st.maxHp * 0.3 ? 'error' : 'success', true, true)
  c.put([...hp].length, 5, text, last ? (last.tone ?? KIND_COLOR[last.kind]) : undefined, last?.strong ?? false, true)
  if (luck) c.put(W - [...luck].length, 5, luck, next === 'lucky' ? 'success' : 'error', true, true)

  return c.segments()
}
