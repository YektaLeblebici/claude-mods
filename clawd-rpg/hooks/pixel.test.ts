import type { On } from 'claude-code'
import { expect, mock, test } from 'claude-code/testing'

import type { Fx, Save } from '../types'
import { BIOMES } from './content'
import { gainPet, makeEnemy, newSave } from './engine'
import { composePixelScene, fromGlyphs } from './pixel'
import { ANVIL_Q, CAMPFIRE_Q, CHEST_Q, PET_Q, QUARTER_LOOKS, SWORD_Q } from './quarterart'
import { ARCHETYPES, archetypeOf, CLAWD, pixels, QUADRANTS } from './scene'

const always = (value: number) => () => value
const cells = (rows: { text: string }[][]) => rows.map(r => [...r.map(seg => seg.text).join('')].length)
const GLYPHS = new Set([...Object.values(QUADRANTS), ' '])

test('every biome, body type, effect and width draws six rows of the band width, in quarter glyphs', { timeoutMs: 60_000 }, () => {
  const base = newSave(always(0.5))
  gainPet(base, 'bat', [], [])
  const effects: (Fx | null)[] = [null, 'hit', 'crit', 'hurt', 'dodge', 'win', 'level', 'loot', 'chest', 'forge', 'ko', 'encounter', 'boss']
  for (const biome of BIOMES) {
    // Every enemy and boss, idle: the picture rows (clear of labels) are all quarter glyphs.
    for (const def of [...biome.enemies, ...biome.bosses]) {
      const isBoss = biome.bosses.includes(def as never)
      const s: Save = { ...base, zone: { ...base.zone, biome: biome.id }, phase: 'fighting', enemy: makeEnemy(always(0.5), 4, def, isBoss ? 'boss' : 'normal') }
      const rows = composePixelScene(s, 0, null, 64)
      expect(rows.length).toBe(6)
      for (const seg of rows[2]!.concat(rows[3]!, rows[4]!)) for (const ch of seg.text) expect(GLYPHS.has(ch)).toBe(true)
    }
    // Every effect at every width, on one boss per biome (the widest sprites).
    const boss: Save = { ...base, zone: { ...base.zone, biome: biome.id }, phase: 'fighting', enemy: makeEnemy(always(0.5), 4, biome.bosses[0]!, 'boss') }
    for (const width of [30, 64, 120])
      for (const fx of effects) for (const n of cells(composePixelScene(boss, 1, fx ? { fx: [fx], at: 0, enemy: boss.enemy } : null, width))) expect(n).toBe(Math.max(30, Math.min(width, 72)))
  }
})

test('pixel art: every biome has its own, every letter has a colour, skylines stay on the canvas', () => {
  for (const biome of BIOMES) expect(QUARTER_LOOKS[biome.id] !== undefined).toBe(true)
  for (const look of Object.values(QUARTER_LOOKS)) {
    for (const s of [look.skyArt, look.mid, look.ground, ...look.props]) for (const row of s.grid) for (const c of row) expect(c === '.' || c in s.palette).toBe(true)
    for (const line of [look.far, ...(look.near ? [look.near] : [])]) for (const h of line.points) expect(h >= 0 && h <= 7).toBe(true)
    expect(look.sky.length >= 2).toBe(true)
  }
  for (const s of [...CAMPFIRE_Q, ...CHEST_Q, ANVIL_Q, SWORD_Q]) for (const row of s.grid) for (const c of row) expect(c === '.' || c in s.palette).toBe(true)
  for (const grid of Object.values(PET_Q)) for (const row of grid) for (const c of row) expect('.bdeko'.includes(c)).toBe(true)
})

test('Clawd and every enemy keep their exact shape on the way to pixels', () => {
  for (const sprite of [CLAWD.walkA, CLAWD.walkB, CLAWD.down, ...Object.values(ARCHETYPES).flat()]) {
    const grid = fromGlyphs(sprite)
    expect(grid.length).toBe(6)
    expect(pixels(grid)).toEqual(sprite)
  }
})

test('the scenery is drawn at quarter resolution: partial quarters appear in every biome', () => {
  const partial = new Set([...'▘▝▖▗▌▐▚▞▛▜▙▟'])
  for (const biome of BIOMES) {
    const s: Save = { ...newSave(always(0.5)), zone: { ...newSave(always(0.5)).zone, biome: biome.id } }
    const scenery = composePixelScene(s, 5, null, 64).slice(1, 5).flatMap(r => r.map(seg => seg.text)).join('')
    expect([...scenery].some(ch => partial.has(ch))).toBe(true)
  }
})

test('walking scrolls the ground by half a cell a frame', () => {
  const s = newSave(always(0.5))
  const ground = (frame: number) => composePixelScene(s, frame, null, 64)[4]!.map(seg => `${seg.text}|${seg.color}|${seg.bg}`).join('')
  expect(ground(0) === ground(1)).toBe(false)
  expect(ground(0) === ground(2)).toBe(false)
})

test('the caption is kept as text', () => {
  const rows = composePixelScene(newSave(always(0.5)), 0, null, 60)
  const caption = rows[5]!.map(seg => seg.text).join('')
  expect(caption.startsWith('♥38/38 │ ')).toBe(true)
  // The level shows on the status line above, not here.
  expect(caption.includes('Lv')).toBe(false)
})

test('the enemy nameplate sits right by its enemy: over it, or just beside it', () => {
  const base = newSave(always(0.5))
  for (const biome of BIOMES) {
    for (const def of [biome.enemies[0]!, biome.enemies[3]!, biome.bosses[0]!]) {
      const enemy = makeEnemy(always(0.5), 4, def, def === biome.bosses[0] ? 'boss' : 'normal')
      const s: Save = { ...base, zone: { ...base.zone, biome: biome.id }, phase: 'fighting', enemy }
      let col = 0
      let plate: { start: number; end: number } | null = null
      for (const seg of composePixelScene(s, 0, null, 64)[0]!) {
        const len = [...seg.text].length
        if (seg.text.includes(enemy.name.slice(0, 6))) plate = { start: col, end: col + len }
        col += len
      }
      expect(plate !== null).toBe(true)
      // The enemy rests 3 cells from the right edge.
      const grid = fromGlyphs(ARCHETYPES[archetypeOf(enemy)][0])
      const w = Math.ceil(Math.max(...grid.map(r => r.length)) / 2)
      const rest = 64 - w - 3
      const overlaps = plate!.start < rest + w && plate!.end > rest
      const beside = plate!.end === rest - 1 || plate!.end === rest
      expect(overlaps || beside).toBe(true)
    }
  }
})

function engineBeneath(on: On, disk: Record<string, unknown>) {
  on('store.get', (_$, e) => ({ value: disk[e.key] }))
  on('store.set', (_$, e) => {
    disk[e.key] = e.value
    return { value: undefined }
  })
  on('tool.call', { tool: 'Bash' }, () => ({ result: { stdout: '', stderr: '', interrupted: false }, text: 'ok' }) as never)
}

const BAND = { hasSurvey: false, isWorking: false, maxRows: 20, bodyColumns: 60, scroll: { offset: 0, bodyRows: 19 } }
const run = ($: { command: { run: (e: never) => Promise<unknown> } }, args: string) => $.command.run({ command: 'rpg', args } as never) as Promise<{ text?: string }>

test('the band draws pixel art', async ($, on) => {
  mock.clock(on)
  const disk: Record<string, unknown> = { save: { ...newSave(always(0.5)), rev: 1 } }
  engineBeneath(on, disk)
  await $.tool.call({ tool: 'Bash', command: 'true' })
  await run($, 'show')
  const band = await $.ui.mount({ plugin: 'clawd-rpg', surface: 'terminal', component: 'AbovePrompt', props: BAND as never })
  const picture = (await band.findAll({ type: 'Text' })).map(t => t.text).join('')
  expect([...picture].some(ch => '▘▝▖▗▌▐▚▞▛▜▙▟'.includes(ch))).toBe(true)
  await band.unmount()
})
