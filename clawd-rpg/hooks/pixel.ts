import type { Burst, Save } from '../types'
import { PETS } from './content'
import { heroStats, nextLuck } from './engine'
import {
  ANVIL_Q,
  BEAK,
  CAMPFIRE_Q,
  CHEST_Q,
  DARK,
  EYE,
  type Grid,
  type Palette,
  PET_Q,
  QUARTER_LOOKS,
  type Skyline,
  SWORD_Q,
} from './quarterart'
import {
  activeFx,
  ARCHETYPES,
  archetypeOf,
  CLAWD,
  FX_FRAMES,
  KIND_COLOR,
  marquee,
  QUADRANTS,
  SCENE_ROWS,
  type Segment,
  SHOUTS,
  type Sprite,
} from './scene'

/** Pixel rows: two per text row, over every row but the caption. */
const H = (SCENE_ROWS - 1) * 2
/** The row creatures stand on: the first ground row. */
const FEET = H - 2
/** Pixels per text cell across. */
const SX = 2

/** Paint order, back to front; each cell keeps its frontmost colour as the glyph. */
const Z = { Back: 0, Prop: 1, Actor: 2 } as const

/** A 2×2 ordered dither: a pixel takes the next tone once the fraction passes its threshold. */
const BAYER = [
  [0.125, 0.625],
  [0.875, 0.375],
]

/** A darker shade for limbs and outlines; a theme colour (no hex) stays as it is. */
function shade(color: string): string {
  if (!/^#[0-9a-f]{6}$/i.test(color)) return color
  return '#' + [0, 1, 2].map(i => Math.round(parseInt(color.slice(1 + 2 * i, 3 + 2 * i), 16) * 0.65).toString(16).padStart(2, '0')).join('')
}

/** Near-black ink on light colours, near-white on dark ones; theme colours (no hex) get near-black. */
function inkOn(color: string): string {
  const hex = /^#([0-9a-f]{6})$/i.exec(color)?.[1]
  if (!hex) return DARK
  const [r, g, b] = [0, 2, 4].map(i => parseInt(hex.slice(i, i + 2), 16) / 255) as [number, number, number]
  return 0.2126 * r + 0.7152 * g + 0.0722 * b > 0.45 ? DARK : '#f5f5f5'
}

const creature = (body: string): Palette => ({ b: body, d: shade(body), e: EYE, k: DARK, o: BEAK })

/** A skyline's height at canvas pixel `x`, joined between its control points by its shape. */
function skylineAt(line: Skyline, x: number): number {
  const at = x / line.spacing
  const i = Math.floor(at)
  const n = line.points.length
  const a = line.points[((i % n) + n) % n]!
  const b = line.points[(((i + 1) % n) + n) % n]!
  const f = at - i
  const h = line.shape === 'step' ? a : line.shape === 'sharp' ? a + (b - a) * f : a + ((b - a) * (1 - Math.cos(Math.PI * f))) / 2
  return Math.round(h)
}

/** Quarter-block glyph art back to pixels (`#` filled); `\` and `/` read as diagonals. */
const PATTERN_OF: Record<string, string> = { ...Object.fromEntries(Object.entries(QUADRANTS).map(([bits, ch]) => [ch, bits])), '\\': '1001', '/': '0110' }
export function fromGlyphs(sprite: Sprite): Grid {
  const rows: string[] = []
  for (const line of sprite) {
    const cells = [...line].map(ch => PATTERN_OF[ch] ?? '0000')
    const half = (a: number, b: number) => cells.map(bits => (bits[a] === '1' ? '#' : '.') + (bits[b] === '1' ? '#' : '.')).join('')
    rows.push(half(0, 1), half(2, 3))
  }
  return rows
}

/** Rows of `grid` from its first painted one; quarter-block sprites carry empty rows at their top. */
const trim = (grid: Grid) => {
  const first = grid.findIndex(row => /[^.]/.test(row))
  return first <= 0 ? grid : grid.slice(first)
}

/** Clawd and the enemies in their quarter-block shapes, as pixels. */
const CLAWD_PX: Record<keyof typeof CLAWD, Grid> = {
  walkA: trim(fromGlyphs(CLAWD.walkA)),
  walkB: trim(fromGlyphs(CLAWD.walkB)),
  cheer: trim(fromGlyphs(CLAWD.cheer)),
  down: trim(fromGlyphs(CLAWD.down)),
}
const ENEMY_PX = Object.fromEntries(Object.entries(ARCHETYPES).map(([kind, frames]) => [kind, frames.map(f => trim(fromGlyphs(f)))])) as Record<string, Grid[]>

type Overlay = { ch: string; color?: string; bold?: boolean; plate?: string }

class Canvas {
  readonly px: string[][]
  readonly z: number[][]
  readonly text = new Map<string, Overlay>()
  /** Text cells across; the canvas is twice as many pixels wide. */
  readonly cols: number
  constructor(cols: number, fill: string) {
    this.cols = cols
    this.px = Array.from({ length: H }, () => Array.from({ length: cols * SX }, () => fill))
    this.z = Array.from({ length: H }, () => Array.from({ length: cols * SX }, () => Z.Back))
  }
  dot(x: number, y: number, color: string, z: number = Z.Back) {
    if (y >= 0 && y < H && x >= 0 && x < this.cols * SX) {
      this.px[y]![x] = color
      this.z[y]![x] = z
    }
  }
  /** Draws `grid` with its bottom row on `bottom`; `.` leaves what is behind. */
  stamp(x: number, bottom: number, grid: Grid, palette: Palette, z: number) {
    const top = bottom - grid.length + 1
    grid.forEach((row, dy) => [...row].forEach((c, dx) => c !== '.' && palette[c] && this.dot(x + dx, top + dy, palette[c]!, z)))
  }
  /** Repeats a strip of art rows across the canvas from `y`, shifted by `offset` pixels. */
  strip(y: number, grid: Grid, palette: Palette, offset: number) {
    const period = Math.max(...grid.map(r => r.length))
    grid.forEach((row, dy) => {
      for (let x = 0; x < this.cols * SX; x++) {
        const c = row[(((x + offset) % period) + period) % period] ?? '.'
        if (c !== '.' && palette[c]) this.dot(x, y + dy, palette[c]!)
      }
    })
  }
  /** A skyline rising from the ground, scrolled by `offset` pixels: caps on its peaks, lit windows in tall blocks. */
  skyline(line: Skyline, offset: number) {
    for (let x = 0; x < this.cols * SX; x++) {
      const wx = x + offset
      const h = skylineAt(line, wx)
      for (let y = FEET - h; y < FEET; y++) {
        const depth = y - (FEET - h)
        const isCap = line.cap && h >= line.cap.from && depth < line.cap.depth
        const isWindow = line.windows && h >= 3 && y < FEET - 1 && depth >= 1 && ((wx % 3) + 3) % 3 === 1 && depth % 3 === 1
        this.dot(x, y, isCap ? line.cap!.color : isWindow ? line.windows! : line.color)
      }
    }
  }
  /** Text in cell `x` of text row `row`; it takes `plate` as background, or the colour beneath it. */
  say(x: number, row: number, words: string, color?: string, bold?: boolean, plate?: string) {
    ;[...words].forEach((ch, i) => x + i >= 0 && x + i < this.cols && this.text.set(`${row}:${x + i}`, { ch, color, bold, plate }))
  }

  /**
   * One cell: its four pixels in two colours. The frontmost colour becomes the glyph and the
   * commonest other colour the background; a third colour, where there is one, joins the background.
   */
  private cell(r: number, c: number): Segment {
    const pixels = [
      [2 * r, 2 * c],
      [2 * r, 2 * c + 1],
      [2 * r + 1, 2 * c],
      [2 * r + 1, 2 * c + 1],
    ].map(([y, x]) => ({ color: this.px[y!]![x!]!, z: this.z[y!]![x!]! }))
    if (pixels.every(p => p.color === pixels[0]!.color)) return { text: ' ', bg: pixels[0]!.color }
    const count = (color: string) => pixels.filter(p => p.color === color).length
    const front = [...pixels].sort((a, b) => b.z - a.z || count(a.color) - count(b.color))[0]!.color
    const bg = pixels
      .filter(p => p.color !== front)
      .map(p => p.color)
      .sort((a, b) => count(b) - count(a))[0]!
    return { text: QUADRANTS[pixels.map(p => (p.color === front ? '1' : '0')).join('')]!, color: front, bg }
  }

  segments(caption: Segment[]): Segment[][] {
    const rows: Segment[][] = []
    for (let r = 0; r < SCENE_ROWS - 1; r++) {
      const out: Segment[] = []
      for (let x = 0; x < this.cols; x++) {
        const said = this.text.get(`${r}:${x}`)
        const seg: Segment = said ? { text: said.ch, color: said.color, bold: said.bold, bg: said.plate ?? this.px[2 * r + 1]![x * SX]! } : this.cell(r, x)
        const last = out[out.length - 1]
        if (last && last.color === seg.color && last.bg === seg.bg && last.bold === seg.bold) last.text += seg.text
        else out.push(seg)
      }
      rows.push(out)
    }
    rows.push(caption)
    return rows
  }
}

/**
 * The band in pixel art: quarter blocks, each text cell 2×2 pixels in at most two colours, on a
 * canvas 10 pixels tall and twice the band's width. Clawd and the enemies keep their quarter-block
 * shapes; the scenery has its own art (`quarterart.ts`): a dithered sky, shaped skylines, props and
 * every layer scrolling in half-cell steps. The nameplate, shouts and caption stay text. Positions
 * are in text cells, so moves, timings and effects follow the text-art scene.
 *
 * `captionAge`: frames since the caption's line first showed, for the marquee.
 */
export function composePixelScene(save: Save, frame: number, burst: Burst | null, width: number, captionAge = 0): Segment[][] {
  const W = Math.max(30, Math.min(width, 72))
  const look = QUARTER_LOOKS[save.zone.biome] ?? QUARTER_LOOKS.meadow!
  const p = new Canvas(W, Object.values(look.ground.palette)[0]!)
  const active = activeFx(burst, frame)
  const fx = active?.fx
  const lf = active?.local ?? 0
  const enemy = (active ? burst?.enemy : null) ?? save.enemy
  const isWalking = !active && save.phase === 'exploring'
  const walk = isWalking ? frame : 0

  const showEnemy =
    enemy !== null &&
    (save.phase === 'fighting' || (active !== null && !['camp', 'recover', 'loot', 'level', 'gold', 'chest', 'pet', 'forge'].includes(fx!)))
  // A pet only a newer version knows is not drawn.
  const pet = save.hero.activePet && save.hero.activePet in PETS ? PETS[save.hero.activePet] : null
  const home = pet ? 7 : 2
  const propsEnd = showEnemy ? W - 16 : W

  // Backdrop, back to front: a pixel a frame up close, slower with distance.
  for (let y = 0; y < FEET; y++) {
    const t = (y / (FEET - 1)) * (look.sky.length - 1)
    const base = Math.floor(t)
    for (let x = 0; x < W * SX; x++) p.dot(x, y, look.sky[Math.min(look.sky.length - 1, t - base > BAYER[y % 2]![x % 2]! ? base + 1 : base)]!)
  }
  p.strip(0, look.skyArt.grid, look.skyArt.palette, Math.floor(walk / 4))
  p.skyline(look.far, Math.floor(walk / 2))
  if (look.near) p.skyline(look.near, Math.floor((walk * 3) / 4))
  p.strip(FEET - 2, look.mid.grid, look.mid.palette, walk)
  p.strip(FEET, look.ground.grid, look.ground.palette, walk)
  const SPACING = 26
  for (let slot = Math.floor(walk / SPACING); ; slot++) {
    const x = slot * SPACING - walk + 12
    if (x >= (propsEnd - 5) * SX) break
    if (x <= (home + 11) * SX) continue
    const prop = look.props[slot % look.props.length]!
    p.stamp(x, FEET - 1, prop.grid, prop.palette, Z.Prop)
  }

  // The active pet, hopping behind Clawd.
  if (pet && save.hero.activePet) {
    const hop = (isWalking && frame % 2 === 1 ? 1 : 0) + ((fx === 'pet' || fx === 'level' || fx === 'win') && lf === 1 ? 2 : 0)
    p.stamp(0, FEET - hop, PET_Q[save.hero.activePet], creature(pet.color), Z.Actor)
  }

  // Clawd.
  let cx = home
  let lift = 0
  let pose: keyof typeof CLAWD_PX = (isWalking ? frame : Math.floor(frame / 2)) % 2 === 0 ? 'walkA' : 'walkB'
  let clawdTint = 'claude'
  if (save.phase === 'recovering' && !active) pose = 'down'
  if (fx === 'hit' || fx === 'crit' || fx === 'miss') cx += lf === 1 ? 3 : 1
  if (fx === 'hurt') {
    cx -= lf === 1 ? 1 : 0
    if (lf === 1) clawdTint = 'error'
  }
  if ((fx === 'dodge' || fx === 'level') && lf === 1) lift = 2
  if (fx === 'win' || fx === 'level') pose = 'cheer'
  if (fx === 'ko') pose = 'down'
  p.stamp(cx * SX, FEET - lift, CLAWD_PX[pose], { '#': clawdTint }, Z.Actor)
  if ((fx === 'hit' || fx === 'crit' || fx === 'miss') && lf === 1) p.stamp((cx + 9) * SX, FEET - lift - 3, SWORD_Q.grid, SWORD_Q.palette, Z.Actor)

  // Camp, chests and the blacksmith, just ahead of Clawd.
  if (save.phase === 'camp' || save.phase === 'recovering' || fx === 'camp' || fx === 'ko') {
    const fire = CAMPFIRE_Q[frame % 2]!
    p.stamp((cx + 11) * SX, FEET, fire.grid, fire.palette, Z.Prop)
    if (save.phase === 'recovering' || fx === 'ko') p.say(cx + 3, 0, frame % 2 ? ' z Z ' : ' Zz ', '#f5f5f5', false, '#1b1b1b')
  }
  // One chest, standing still beside Clawd while the road scrolls by, until anything else happens.
  if (fx === 'chest' || (save.chestOnRoad && save.phase === 'exploring' && !showEnemy && !active)) {
    const chest = CHEST_Q[fx === 'chest' && lf === 0 ? 0 : 1]!
    p.stamp((cx + 11) * SX, FEET, chest.grid, chest.palette, Z.Prop)
  }
  if (fx === 'forge') p.stamp((cx + 17) * SX, FEET, ANVIL_Q.grid, ANVIL_Q.palette, Z.Prop)

  // The enemy.
  if (enemy && showEnemy) {
    const body = enemy.tint ?? (enemy.isBoss ? look.boss : look.foe)
    const archetype = archetypeOf(enemy)
    const grid = ENEMY_PX[archetype]![Math.floor(frame / 2) % 2]!
    // Width in text cells.
    const w = Math.ceil(Math.max(...grid.map(r => r.length)) / SX)
    let ex = W - w - 3
    let tint = body
    if (fx === 'encounter' || fx === 'boss' || fx === 'legend') ex += (FX_FRAMES - 1 - lf) * 6
    if ((fx === 'hit' || fx === 'crit') && lf === 1) tint = fx === 'crit' ? 'warning' : 'error'
    if ((fx === 'hit' || fx === 'crit') && lf === 2) ex += 1
    if (fx === 'miss' && lf >= 1) ex += 2
    if ((fx === 'hurt' || fx === 'dodge') && lf === 1) ex -= 3
    const floats = archetype === 'flyer' || archetype === 'spirit' || archetype === 'swarm' ? 1 + (Math.floor(frame / 2) % 2) : 0
    const isGone = fx === 'win' && lf > 0
    if (isGone) {
      for (const [dx, dy] of lf === 1 ? [[2, -4], [5, -2], [8, -5], [4, -6]] : [[1, -6], [7, -7], [9, -3]]) p.dot((ex + dx!) * SX, FEET + dy!, '#fff59d', Z.Actor)
    } else {
      p.stamp(ex * SX, FEET - floats, grid, { '#': tint }, Z.Actor)
    }
    // A nameplate in the enemy's colour, close to it but never over it: centred above an enemy that
    // leaves the top text row free, or just left of one tall enough to reach it. Placed by where the
    // enemy rests, so it holds still while the enemy lunges and bobs.
    const hp = ` ${Math.max(0, isGone ? 0 : enemy.hp)}/${enemy.maxHp} `
    const rest = W - w - 3
    const highest = FEET - (floats > 0 ? 2 : 0) - grid.length + 1
    const isAbove = highest >= 2
    const left = home + 12
    const room = isAbove ? W - left : rest - 1 - left
    const name = ` ${enemy.name}`
    const fits = [...name].length + hp.length <= room ? name : [...name].slice(0, Math.max(2, room - hp.length - 1)).join('') + '…'
    const label = fits + hp
    const len = [...label].length
    const x = isAbove ? Math.min(W - len, Math.max(left, rest + Math.floor(w / 2) - Math.floor(len / 2))) : rest - 1 - len
    if (room > hp.length + 2) p.say(x, 0, label, inkOn(body), true, body)
  } else if (!active || fx === 'explore') {
    const label = ` D${save.zone.depth} ${save.zone.name} `
    p.say(Math.max(0, W - [...label].length - 1), 0, label, '#f5f5f5', true, '#1b1b1b')
  }

  // Effect shouts and sparkles.
  const said = fx ? SHOUTS[fx] : undefined
  if (said) p.say(cx + 10, fx === 'chest' || fx === 'forge' ? 0 : 1, said[0], said[1], true)
  if ((fx === 'loot' || fx === 'gold' || fx === 'level' || fx === 'chest' || fx === 'forge') && lf !== 1) {
    const spark = fx === 'gold' || fx === 'chest' ? '#ffd54f' : fx === 'level' ? '#ffffff' : '#fff59d'
    for (const [dx, dy] of [[-1 + lf * 2, -6], [9 - lf, -2], [4, -8 + lf]]) p.dot((cx + dx!) * SX, FEET + dy!, spark, Z.Actor)
  }

  // Caption, as in the text-art scene.
  const st = heroStats(save.hero)
  // The level is on the status line above; here, just health.
  const hp = `♥${save.hero.hp}/${st.maxHp} │ `
  const last = save.log[save.log.length - 1]
  const next = nextLuck(save)
  const luck = next === 'lucky' ? ' +luck' : next === 'unlucky' ? ' -luck' : ''
  const room = W - [...hp].length - [...luck].length
  const text = marquee(last?.text ?? '', room, captionAge)
  const caption: Segment[] = [
    { text: hp, color: save.hero.hp < st.maxHp * 0.3 ? 'error' : 'success', bold: true },
    { text: text.padEnd(Math.max(0, room)), color: last ? (last.tone ?? KIND_COLOR[last.kind]) : undefined, bold: last?.strong },
  ]
  if (luck) caption.push({ text: luck, color: next === 'lucky' ? 'success' : 'error', bold: true })
  return p.segments(caption)
}
