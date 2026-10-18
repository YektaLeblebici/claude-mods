import type { PetId } from '../types'

/**
 * A grid is rows of letters, one per pixel; `.` is see-through and every other letter is a colour
 * from the grid's palette.
 */
export type Grid = string[]
export type Palette = Record<string, string>
export type Stamp = { grid: Grid; palette: Palette }

/** Creature letters: `b` body, `d` a darker shade, `e` white eyes, `k` dark eyes, `o` a beak. */
export const EYE = '#ffffff'
export const DARK = '#1b1b1b'
export const BEAK = '#ff9800'

/**
 * Art for the quarter-block mode, drawn at its own resolution: every art pixel is a quarter of a
 * text cell (half a cell wide, half a cell tall), so a cell holds a 2×2 of them in at most two
 * colours. Shapes lean on silhouettes and negative space the way Clawd does, keep to one or two
 * colours per 2×2 block where they can, and use checkerboards to blend tones.
 */

/** Lays small pieces of art into one strip `period` pixels wide that repeats across the sky. */
function strip(period: number, rows: number, pieces: [x: number, y: number, art: Grid][]): Grid {
  const grid = Array.from({ length: rows }, () => Array.from({ length: period }, () => '.'))
  for (const [x, y, art] of pieces)
    art.forEach((row, dy) => [...row].forEach((c, dx) => c !== '.' && grid[y + dy] && (grid[y + dy]![(x + dx) % period] = c)))
  return grid.map(row => row.join(''))
}

/**
 * A skyline: heights (0–7 pixels above the ground) at control points `spacing` pixels apart, joined
 * as soft curves, straight slopes, or flat-topped blocks. A cap colours its top pixels (snow, a lava
 * rim); windows punch a lit grid into tall blocks.
 */
export type Skyline = {
  points: number[]
  spacing: number
  shape: 'smooth' | 'sharp' | 'step'
  color: string
  cap?: { color: string; depth: number; from: number }
  windows?: string
}

export type QuarterLook = {
  /** Sky tones top to horizon, dithered between. */
  sky: string[]
  skyArt: Stamp
  far: Skyline
  near?: Skyline
  /** Two rows standing on the ground (rows 6–7). */
  mid: Stamp
  /** The two ground rows (8–9). */
  ground: Stamp
  props: Stamp[]
}

// ── Shared pieces ────────────────────────────────────────────────────

const CLOUD_BIG: Grid = ['....wwww......', '..wwwwwwww.ww.', '.wwwwwwwwwwwww', 'wwwwwwwwwwwwww']
const CLOUD_SMALL: Grid = ['..www...', '.wwwwww.', 'wwwwwwww']
const SUN: Grid = ['....ssss....', '..ssssssss..', '.ssssssssss.', '.ssssssssss.', '..ssssssss..', '....ssss....']
const MOON: Grid = ['...mmmm.', '.mmm....', 'mmm.....', 'mmm.....', '.mmm....', '...mmmm.']
const DOT: Grid = ['x']

export const QUARTER_LOOKS: Record<string, QuarterLook> = {
  meadow: {
    sky: ['#3a74bd', '#5b93d4', '#82b3e6', '#b0d4f2'],
    skyArt: {
      grid: strip(96, 6, [[30, 0, SUN], [52, 0, CLOUD_BIG], [76, 1, CLOUD_SMALL], [4, 0, CLOUD_SMALL]]),
      palette: { s: '#ffe066', w: '#ffffff' },
    },
    far: { points: [3, 4, 5, 4, 3, 2, 3, 5, 6, 5, 3, 2], spacing: 10, shape: 'smooth', color: '#6aa85f' },
    near: { points: [1, 2, 3, 2, 1, 1, 2, 3, 2, 1], spacing: 8, shape: 'smooth', color: '#4f9145' },
    mid: { grid: ['....y.......p..........r......', 'g.g.ggg.g.g..gg.g.g.g.gg.g.gg.'], palette: { y: '#ffeb3b', p: '#f48fb1', r: '#e53935', g: '#3f8f35' } },
    ground: { grid: ['gGgGgggGgGgGgGGg', 'GgGgGgGgGGgGgGgG'], palette: { g: '#5fae45', G: '#4a9436' } },
    props: [
      { grid: ['...llllll...', '.llllllllll.', 'llllllllllll', '.llllllllll.', '.....tt.....', '.....tt.....', '.....tt.....', '....tttt....'], palette: { l: '#2e7d32', t: '#6d4c41' } },
      { grid: ['p..p..p..p', 'pppppppppp', 'p..p..p..p', 'pppppppppp'], palette: { p: '#8d6e63' } },
      { grid: ['..llllll..', '.llfllllf.', 'llllllllll', 'lflllllfll'], palette: { l: '#388e3c', f: '#f06292' } },
    ],
  },
  caves: {
    sky: ['#0f0b0a', '#16110f', '#1e1814', '#2a221e'],
    skyArt: {
      grid: strip(60, 4, [
        [0, 0, ['rrrr', '.rr.', '.r..']], [9, 0, ['rr', 'r.']], [16, 0, ['rrrrrr', '.rrrr.', '..rr..', '..r...']],
        [28, 0, ['rrr', '.r.']], [36, 0, ['rrrrr', '.rrr.', '..r..']], [47, 0, ['rr', '.r', '.r']], [54, 0, ['rrrr', '.rr.']],
        [22, 3, DOT], [42, 2, DOT],
      ]),
      palette: { r: '#4a3f38', x: '#80deea' },
    },
    far: { points: [2, 3, 2, 4, 3, 2, 3, 5, 3, 2], spacing: 6, shape: 'sharp', color: '#3a302a' },
    near: { points: [1, 1, 2, 1, 1, 2, 2, 1], spacing: 5, shape: 'sharp', color: '#2f2622' },
    mid: { grid: ['..........................', '.r...rr.......r.....r.r...'], palette: { r: '#5a4e46' } },
    ground: { grid: ['aAaAaaAaAaAA', 'AaAaAaAAaAaA'], palette: { a: '#4a3f38', A: '#3d342e' } },
    props: [
      { grid: ['..rr..', '..rr..', '.rrrr.', '.rrrr.', 'rrrrrr', 'rrrrrr'], palette: { r: '#7d6e62' } },
      { grid: ['.yy.', 'yooy', '.oo.', '.oo.', '.ww.', '.ww.', '.ww.', '.ww.'], palette: { y: '#ffd54f', o: '#ff7043', w: '#8d6e63' } },
      { grid: ['...c....', '..cC..c.', '..cC.cC.', '.ccCccC.', 'ccccccCc', 'cccccccc'], palette: { c: '#4dd0e1', C: '#b2ebf2' } },
    ],
  },
  woods: {
    sky: ['#1f1a33', '#2a2340', '#3b3152', '#4e4266'],
    skyArt: {
      grid: strip(84, 6, [[14, 0, MOON], [4, 1, DOT], [30, 0, DOT], [44, 3, DOT], [58, 1, DOT], [70, 4, DOT], [78, 0, DOT], [38, 1, DOT]]),
      palette: { m: '#f4ecc2', x: '#ffffff' },
    },
    far: { points: [2, 6, 2, 5, 2, 6, 3, 5, 2], spacing: 3, shape: 'sharp', color: '#24302a' },
    near: { points: [1, 3, 1, 4, 1, 3, 1], spacing: 3, shape: 'sharp', color: '#18221c' },
    mid: { grid: ['h.h.h...h.h.....h.h.h.......', '.h.h.hhh.h.h...h.h.hhh.h....'], palette: { h: '#6a7a86' } },
    ground: { grid: ['gGgGggGgGgGG', 'GgGgGgGGgGgG'], palette: { g: '#3e4a2c', G: '#2f3a22' } },
    props: [
      { grid: ['b.....b.', '.b...b..', '..b.b..b', '...bb.b.', '....bb..', '....bb..', '....bb..', '...bbbb.'], palette: { b: '#7a6654' } },
      { grid: ['..rrrrrr..', '.rrwrrrwr.', 'rrrrrrrrrr', '....ss....', '....ss....', '...ssss...'], palette: { r: '#c62828', w: '#ffffff', s: '#e0d6c8' } },
      { grid: ['..gggggg..', '.gggggggg.', 'ggggkkgggg', 'gggkkkkggg', 'ggggkkgggg', 'gggggggggg'], palette: { g: '#9e9e9e', k: '#5f5f5f' } },
    ],
  },
  swamp: {
    sky: ['#2c3825', '#3a4730', '#4f5f3c', '#6b7a52'],
    skyArt: {
      grid: strip(64, 5, [[3, 1, DOT], [15, 3, DOT], [24, 0, DOT], [33, 4, DOT], [41, 2, DOT], [52, 1, DOT], [60, 3, DOT]]),
      palette: { x: '#e6ee9c' },
    },
    far: { points: [1, 3, 3, 1, 0, 3, 3, 0, 1, 3], spacing: 4, shape: 'step', color: '#2a3220' },
    near: { points: [0, 1, 2, 1, 0, 0, 1, 2], spacing: 5, shape: 'smooth', color: '#222a1a' },
    mid: { grid: ['wWwWwwWw.wWwWw', 'WwWwWWwWwWwWwW'], palette: { w: '#3e6b5c', W: '#5f8f7a' } },
    ground: { grid: ['mMmMmmMmMmMM', 'MmMmMmMMmMmM'], palette: { m: '#4b4630', M: '#3a3524' } },
    props: [
      { grid: ['.b..b...', '.b..b.b.', '.g..g.b.', '.g.gg.g.', 'gg.g..g.', '.g.g.gg.', '.ggg.g..', 'gggggggg'], palette: { g: '#8bc34a', b: '#6d4c41' } },
      { grid: ['......rr......', '....rrrrrr....', '..rrrrrrrrrr..', 'rrrrrrrrrrrrrr', '..wwwwddwwww..', '..wwwwddwwww..', '..w........w..', '..w........w..'], palette: { r: '#795548', w: '#a1887f', d: '#3e2723' } },
    ],
  },
  desert: {
    sky: ['#d9792f', '#e8913f', '#f2ac5c', '#f7cd8a'],
    skyArt: { grid: strip(90, 6, [[38, 0, SUN]]), palette: { s: '#fff3c4' } },
    far: { points: [2, 3, 4, 3, 2, 2, 3, 5, 4, 2], spacing: 12, shape: 'smooth', color: '#d39548' },
    near: { points: [0, 0, 0, 1, 3, 5, 3, 1, 0, 0, 0, 0, 0, 0], spacing: 3, shape: 'sharp', color: '#b8742a' },
    mid: { grid: ['............................', '..k......k.......kk.....k...'], palette: { k: '#b07a35' } },
    ground: { grid: ['sSsSssSsSsSS', 'SsSsSsSSsSsS'], palette: { s: '#e0b062', S: '#d4a050' } },
    props: [
      { grid: ['...gg...', 'g..gg...', 'g..gg..g', 'gggggg.g', '...ggggg', '...gg...', '...gg...', '...gg...'], palette: { g: '#2e7d32' } },
      { grid: ['pppppp', '.pPpP.', '.pPpP.', '.pPpP.', '.pPpP.', '.pPpP.', '.pPpP.', 'pppppp'], palette: { p: '#efe3c8', P: '#cbbd9f' } },
      { grid: ['.wwww.', 'wkwwkw', '.wwww.', '.w..w.'], palette: { w: '#f5f5f5', k: '#3e2723' } },
    ],
  },
  frost: {
    sky: ['#6f9ccc', '#8db2d9', '#b0cbe6', '#d5e5f4'],
    skyArt: {
      grid: strip(72, 4, [
        [0, 0, ['aa.a..aaa.a..', '.a.aa.a.aa.aa']], [40, 0, ['.aa.a..aa', 'a.aa.aa.a']],
        [6, 2, DOT], [20, 3, DOT], [31, 1, DOT], [48, 2, DOT], [58, 3, DOT], [66, 1, DOT],
      ]),
      palette: { a: '#8ee6c0', x: '#ffffff' },
    },
    far: { points: [1, 3, 6, 3, 1, 2, 5, 7, 4, 2], spacing: 6, shape: 'sharp', color: '#6f8fae', cap: { color: '#ffffff', depth: 2, from: 4 } },
    near: { points: [1, 2, 3, 2, 1, 2, 4, 2], spacing: 5, shape: 'sharp', color: '#56749a', cap: { color: '#e8f1f8', depth: 1, from: 3 } },
    mid: { grid: ['............................', '..i.....i.......i.....i.....'], palette: { i: '#81d4fa' } },
    ground: { grid: ['wWwWwwWwWwWW', 'WwWwWwWWwWwW'], palette: { w: '#f2f7fb', W: '#dde9f3' } },
    props: [
      { grid: ['...ww...', '..gggg..', '.wggggw.', 'gggggggg', '.gggggg.', 'wggggggw', '...tt...', '...tt...'], palette: { g: '#1f5c44', w: '#ffffff', t: '#5d4037' } },
      { grid: ['...kkkk...', '..kkkkkk..', '...wwww...', '..wkwwkw..', '.wwwwwwww.', 'wwwwwwwwww', 'wwwwwwwwww', '.wwwwwwww.'], palette: { w: '#e3eef7', k: '#263238' } },
      { grid: ['..ii..', 'i.ii.i', '.iiii.', '.iiii.', 'i.ii.i', '..ii..'], palette: { i: '#4fc3f7' } },
    ],
  },
  volcano: {
    sky: ['#1f0d0b', '#2e1310', '#4a1c14', '#7a2e1a'],
    skyArt: {
      grid: strip(60, 5, [[2, 1, DOT], [9, 4, ['y']], [17, 0, DOT], [26, 3, DOT], [34, 1, ['y']], [43, 4, DOT], [51, 2, DOT], [57, 0, ['y']]]),
      palette: { x: '#ff8a50', y: '#ffcc80' },
    },
    far: { points: [1, 2, 3, 5, 7, 7, 5, 3, 2, 1, 1, 2], spacing: 4, shape: 'sharp', color: '#1a0d0a', cap: { color: '#ff5722', depth: 1, from: 6 } },
    near: { points: [1, 2, 1, 1, 3, 2, 1], spacing: 4, shape: 'sharp', color: '#120807' },
    mid: { grid: ['.y....y....y...y....', 'rRrRrrRryRrRrRrRrrRr'], palette: { r: '#ff5722', R: '#ffab40', y: '#ffd54f' } },
    ground: { grid: ['bBbBbrbBbBbB', 'BbBbBbBBbrbB'], palette: { b: '#2a1a16', B: '#3a2420', r: '#e64a19' } },
    props: [
      { grid: ['..kk..', '..kk..', '.kkkk.', '.kKkk.', 'kkKkkk', 'kkkkkk', 'kkkkkk', 'kkkkkk'], palette: { k: '#3a2a30', K: '#6a5560' } },
      { grid: ['..y...', '.yo.y.', '..oo..', '..oo..', '.rrrr.', '.rrrr.', 'rrrrrr', 'rrrrrr'], palette: { y: '#ffd54f', o: '#ff7043', r: '#5a2a20' } },
    ],
  },
  crypt: {
    sky: ['#101014', '#16161b', '#1d1d23', '#24242c'],
    skyArt: {
      grid: strip(48, 4, [[0, 0, ['gggg.gggggg.gggg.ggggg.gggggg.gggg.ggggg.gggggg.', 'g..g.g....g.g..g.g...g.g....g.g..g.g...g.g....g.']], [10, 2, ['c', 'c']], [34, 2, ['c', 'c']]]),
      palette: { g: '#3a3a46', c: '#6a6a78' },
    },
    far: { points: [3, 3, 3, 0, 3, 3, 3, 0], spacing: 3, shape: 'step', color: '#2e2e38', windows: '#1a1a22' },
    mid: { grid: ['.......................', 'w..ww...w.....w.ww.....'], palette: { w: '#bdbdbd' } },
    ground: { grid: ['aAaAaaAaAaAA', 'AaAaAaAAaAaA'], palette: { a: '#3a3a46', A: '#2e2e38' } },
    props: [
      { grid: ['..gggggg..', '.gggggggg.', 'ggggkkgggg', 'gggkkkkggg', 'ggggkkgggg', 'ggggkkgggg', 'gggggggggg', 'gggggggggg'], palette: { g: '#9e9e9e', k: '#616161' } },
      { grid: ['..y.', '.yo.', '.ww.', '.ww.', '.ww.', '.ww.', 'wwww', 'wwww'], palette: { y: '#ffd54f', o: '#ff9800', w: '#eeeeee' } },
      { grid: ['.bbbbbb.', 'bbbkbbbb', 'bbkkkbbb', '.bbbbbb.'], palette: { b: '#8d6e63', k: '#4e342e' } },
    ],
  },
  sky: {
    sky: ['#2a66b8', '#4a86cc', '#76a8e0', '#a8cdf2'],
    skyArt: { grid: strip(100, 4, [[8, 0, CLOUD_BIG], [40, 1, CLOUD_SMALL], [62, 0, CLOUD_BIG], [88, 1, CLOUD_SMALL]]), palette: { w: '#ffffff' } },
    far: { points: [2, 3, 4, 3, 2, 3, 5, 4, 2], spacing: 9, shape: 'smooth', color: '#eef6ff' },
    near: { points: [1, 2, 1, 1, 2, 3, 2, 1], spacing: 7, shape: 'smooth', color: '#d6e8fa' },
    mid: { grid: ['..........................', 'ww..www...ww.....www..ww..'], palette: { w: '#ffffff' } },
    ground: { grid: ['wWwWwwWwWwWW', 'WwWwWwWWwWwW'], palette: { w: '#f5faff', W: '#d6e8fa' } },
    props: [
      { grid: ['.....llll.......', '...llllllll.....', '....llllll......', '......tt........', 'gggggggggggggggg', '.dddddddddddddd.', '...dddddddddd...', '......dddd......'], palette: { l: '#43a047', t: '#6d4c41', g: '#7cb342', d: '#8d6e63' } },
      { grid: ['pfff..', 'pfff..', 'pff...', 'p.....', 'p.....', 'p.....', 'p.....', 'pp....'], palette: { p: '#8d6e63', f: '#e53935' } },
    ],
  },
  sunken: {
    sky: ['#041c2b', '#072a40', '#0b3d57', '#0f5470'],
    skyArt: {
      grid: strip(56, 5, [[4, 3, DOT], [6, 1, DOT], [18, 4, ['o']], [20, 2, DOT], [31, 0, DOT], [40, 3, ['o']], [47, 1, DOT], [52, 4, DOT]]),
      palette: { x: '#80deea', o: '#b2ebf2' },
    },
    far: { points: [2, 2, 5, 5, 1, 3, 3, 6, 6, 2, 4, 4], spacing: 3, shape: 'step', color: '#0d4458', windows: '#1d6f86' },
    mid: { grid: ['.r.....p.p......r..r....', 'rrr.p.ppp.p...rrrrr.p...'], palette: { r: '#ff8a80', p: '#ce93d8' } },
    ground: { grid: ['sSsSssSsSsSS', 'SsSsSsSSsSsS'], palette: { s: '#a89a64', S: '#8c7f50' } },
    props: [
      { grid: ['.g..', 'g...', '.g..', '..g.', '.g..', 'g...', '.g..', 'gg..'], palette: { g: '#26a69a' } },
      { grid: ['....oo....', 'oooooooooo', '..oooooo..', '.oo....oo.'], palette: { o: '#ff8a65' } },
      { grid: ['..aa..', '..aa..', 'aaaaaa', '..aa..', '..aa..', 'a.aa.a', 'aaaaaa', '.aaaa.'], palette: { a: '#90a4ae' } },
    ],
  },
  clockwork: {
    sky: ['#1c1511', '#241b16', '#33271f', '#4a3a2e'],
    skyArt: {
      grid: strip(40, 4, [[0, 0, ['pppppppppppppppppppppppppppppppppppppppp', '..p...........p..........p..........p...']], [2, 2, ['p', 'v']], [14, 2, ['p']], [25, 2, ['p', 'v']], [36, 2, ['p']]]),
      palette: { p: '#8d6e4a', v: '#9e9e9e' },
    },
    far: { points: [1, 1, 6, 6, 1, 1, 3, 3, 3, 1, 6, 1], spacing: 2, shape: 'step', color: '#3a2e26', windows: '#c0a060' },
    mid: { grid: ['....................', 'c.c.c.c.c.c.c.c.c.c.'], palette: { c: '#c0a060' } },
    ground: { grid: ['mMmMmMmMmMmM', 'MmMmMmMmMmMm'], palette: { m: '#5d4a3a', M: '#4a3a2e' } },
    props: [
      { grid: ['.....yyyy.....', '..yyyyyyyyyy..', '.yyyy....yyyy.', 'yyy........yyy', 'yyy........yyy', '.yyyy....yyyy.', '..yyyyyyyyyy..', '.....yyyy.....'], palette: { y: '#d4a017' } },
      { grid: ['.yy.', 'kyyk', '.kk.', '.kk.', '.kk.', '.kk.', '.kk.', 'kkkk'], palette: { y: '#ffe082', k: '#6d5a48' } },
    ],
  },
  void: {
    sky: ['#030208', '#07040f', '#0e081c', '#160b28'],
    skyArt: {
      grid: strip(80, 5, [
        [20, 0, ['...pppp...', '..pppppp..', 'rrrrrrrrrr', '..pppppp..', '...pppp...']],
        [2, 1, DOT], [9, 3, DOT], [36, 0, DOT], [44, 4, DOT], [52, 2, DOT], [61, 0, DOT], [69, 3, DOT], [76, 1, DOT],
      ]),
      palette: { p: '#7e57c2', r: '#b39ddb', x: '#ffffff' },
    },
    far: { points: [0, 0, 2, 2, 0, 0, 0, 3, 3, 0, 1, 0], spacing: 3, shape: 'step', color: '#2a1a4a' },
    mid: { grid: ['.p.......w.......p.....', '.....w......p.......w..'], palette: { p: '#b39ddb', w: '#ffffff' } },
    ground: { grid: ['vVvVvvVvVvVV', 'VvVvVvVVvVvV'], palette: { v: '#1c1033', V: '#120a22' } },
    props: [
      { grid: ['..c...', '..cC..', '.ccC..', '.ccCc.', 'cccCcc', '.ccCc.', '..cC..', '...c..'], palette: { c: '#ce93d8', C: '#f3e5f5' } },
      { grid: ['..pppp..', '.p....p.', 'p..vv..p', 'p.vvvv.p', 'p.vvvv.p', 'p..vv..p', '.p....p.', '..pppp..'], palette: { p: '#ab47bc', v: '#4a148c' } },
    ],
  },
}

// ── Companions and props of the road, at quarter resolution ───────────

/** Pets face right, following Clawd: body `b`, dark eyes `k`, white `e`, beak `o`. */
export const PET_Q: Record<PetId, Grid> = {
  slime: ['..bbbb..', '.bbbbbb.', 'bbkbbkbb', 'bbbbbbbb'],
  duck: ['....bbb.', '...bbkbo', 'bbbbbbb.', '.bbbbb..'],
  bat: ['b......b', 'bbbbbbbb', 'bbkbbkbb', '..b..b..'],
  dragon: ['......bb', '...bbbkb', 'bbbbbbb.', 'b.b..b..'],
  turtle: ['..dddd..', '.dddddd.', 'ddddddbk', '.b..b...'],
  cat: ['b..b....', 'bbbb...b', 'bkbk..b.', 'bbbbbbb.'],
  owl: ['bb....bb', 'bebbbbeb', 'bbbbbbbb', '..b..b..'],
  wisp: ['...e....', '..bbb...', '.bbbbb..', '..b.b...'],
  // Wild characters: hair or headgear `k`, face `e`, clothes `b`, and each one's own prop.
  tim: ['..ee....', '..kk..o.', '.bbbbbo.', '..b..b..'],
  tarbolts: ['..kk....', '..ee...k', '.bbbb.ke', '..b..b.k'],
  freeman: ['..kk...k', '..ek..k.', '.bbbbk..', '..b..b..'],
  sam: ['..kk....', '..ee..o.', '.bbbb.oo', '..b..b..'],
}

export const CAMPFIRE_Q: [Stamp, Stamp] = [
  { grid: ['....y.....', '...yyy....', '..yoyoy...', '..ooooo...', 'wwwwwwwwww', '.ww....ww.'], palette: { y: '#ffd54f', o: '#ff5722', w: '#6d4c41' } },
  { grid: ['.....y....', '....yyy...', '...yoyoy..', '...ooooo..', 'wwwwwwwwww', '.ww....ww.'], palette: { y: '#ffd54f', o: '#ff5722', w: '#6d4c41' } },
]
export const CHEST_Q: [Stamp, Stamp] = [
  { grid: ['..yyyyyyyy..', '.yyyyyyyyyy.', 'bbbbbbbbbbbb', 'bbbbbkkbbbbb', 'bbbbbbbbbbbb', 'bbbbbbbbbbbb'], palette: { y: '#ffb300', b: '#6d4c41', k: '#3e2723' } },
  { grid: ['g...g...g...', 'yyyyyyyyyyy.', 'y..........y', 'bbbbbbbbbbbb', 'bbbbbkkbbbbb', 'bbbbbbbbbbbb'], palette: { y: '#ffb300', b: '#6d4c41', k: '#3e2723', g: '#fff176' } },
]
export const ANVIL_Q: Stamp = { grid: ['kkkkkkkkkkkk', '..kkkkkkkk..', '....kkkk....', '..kkk..kkk..'], palette: { k: '#90a4ae' } }
/** A thin blade: one pixel row, half a cell tall. */
export const SWORD_Q: Stamp = { grid: ['hhssssss'], palette: { h: '#8d6e63', s: '#eceff1' } }

