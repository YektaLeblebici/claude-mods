import type { On } from 'claude-code'
import { expect, mock, test } from 'claude-code/testing'

import type { Item, Save } from '../types'
import { BIOMES } from './content'
import {
  CHEST_WINDOW_MS,
  chestKind,
  gainPet,
  heroStats,
  isCommit,
  makeEnemy,
  newSave,
  openChest,
  petBonus,
  setActivePet,
  tick,
} from './engine'
import { composePixelScene } from './pixel'

const always = (value: number) => () => value
const item = (over: Partial<Item>): Item => ({ name: 'Longsword', slot: 'weapon', rarity: 'rare', power: 14, affixes: [], score: 14, ...over })
const withGear = (s: Save, gear: Partial<Save['hero']['gear']>): Save => ({ ...s, hero: { ...s.hero, gear: { ...s.hero.gear, ...gear } } })

// ── Gold sink ─────────────────────────────────────────────────────────

test('upgrades count when new loot is compared, so an upgraded item is kept', () => {
  // At 0.5 a good chest at depth 1 rolls item level 3 (one above, plus one for luck): a rare armour
  // piece of power 10 with one affix, score 13.
  const plain = withGear(newSave(always(0.5)), { armor: item({ name: 'Old Vest', slot: 'armor', power: 4 }) })
  expect(openChest(plain, 0, always(0.5)).save.hero.gear.armor!.name === 'Old Vest').toBe(false)
  // The same vest with ten upgrades scores 14 and stays on.
  const honed = withGear(plain, { armor: item({ name: 'Old Vest', slot: 'armor', power: 4, upgrades: 10 }) })
  const { save } = openChest(honed, 0, always(0.5))
  expect(save.hero.gear.armor!.name).toBe('Old Vest')
  expect(save.log.some(l => l.text.includes('sold for'))).toBe(true)
})

test('at camp the blacksmith spends spare gold on the weakest piece, at rising cost', () => {
  const base = withGear(newSave(always(0.5)), {
    weapon: item({ power: 10 }),
    armor: item({ name: 'Chainmail', slot: 'armor', power: 4 }),
  })
  const atCamp: Save = { ...base, phase: 'camp', hero: { ...base.hero, gold: 1000, potions: 5 } }
  const { save, fx } = tick(atCamp, always(0.99))
  expect(fx).toContain('forge')
  expect(save.hero.gold < 1000).toBe(true)
  // The weakest piece is upgraded first, until it is no longer the weakest.
  expect((save.hero.gear.armor!.upgrades ?? 0) > 0).toBe(true)
  expect(save.log.some(l => l.text.startsWith('The blacksmith hammers away'))).toBe(true)
})

// ── Treasure chests ───────────────────────────────────────────────────

test('commits open a good chest, then small ones for 30 minutes, then a good one again', () => {
  const s = newSave(always(0.5))
  expect(chestKind(s, 0)).toBe('good')
  const first = openChest(s, 1_000, always(0.5))
  expect(first.kind).toBe('good')
  expect(first.save.lastGoodChestAt).toBe(1_000)
  expect(chestKind(first.save, 1_000 + 10 * 60_000)).toBe('small')
  const small = openChest(first.save, 1_000 + 10 * 60_000, always(0.5))
  expect(small.save.lastGoodChestAt).toBe(1_000)
  expect(chestKind(small.save, 1_000 + CHEST_WINDOW_MS)).toBe('good')
})

test('a good chest holds gold and an item of uncommon or better', () => {
  const s = newSave(always(0.5))
  const { save } = openChest(s, 0, always(0.5))
  expect(save.hero.gold > s.hero.gold).toBe(true)
  const worn = Object.values(save.hero.gear).filter(Boolean) as Item[]
  expect(worn.length).toBe(1)
  expect(worn[0]!.rarity === 'common').toBe(false)
})

test('git commit is spotted in its usual forms and nothing else', () => {
  for (const c of ['git commit -m "x"', 'git -C repo commit -am wip', 'git add . && git commit -m y', 'git commit']) expect(isCommit(c)).toBe(true)
  for (const c of ['git log --grep commit', 'git commit-tree abc', 'echo git committee', 'git status']) expect(isCommit(c)).toBe(false)
})

// ── Pets ──────────────────────────────────────────────────────────────

test('the first pet follows Clawd at once; later ones join the collection without taking over', () => {
  const s = newSave(always(0.5))
  gainPet(s, 'duck', [], [])
  expect(s.hero.activePet).toBe('duck')
  gainPet(s, 'dragon', [], [])
  expect(s.hero.activePet).toBe('duck')
  expect(s.hero.pets?.map(p => p.id)).toEqual(['duck', 'dragon'])
})

test('a duplicate pet levels up, and a maxed one turns into gold', () => {
  const s = newSave(always(0.5))
  for (let i = 0; i < 5; i++) gainPet(s, 'cat', [], [])
  expect(s.hero.pets).toEqual([{ id: 'cat', level: 5 }])
  const gold = s.hero.gold
  gainPet(s, 'cat', [], [])
  expect(s.hero.gold > gold).toBe(true)
})

test('pet bonuses are tiny and only the active pet counts', () => {
  const s = newSave(always(0.5))
  const before = heroStats(s.hero).atk
  gainPet(s, 'duck', [], [])
  gainPet(s, 'dragon', [], [])
  gainPet(s, 'dragon', [], [])
  expect(heroStats(s.hero).atk).toBe(before)
  const dragon = setActivePet(s, 'dragon')
  expect(petBonus(dragon.hero, 'atk')).toBe(1.5)
  expect(heroStats(dragon.hero).atk).toBe(before + 1.5)
  expect(setActivePet(dragon, 'owl').hero.activePet).toBe('dragon')
})

test('the active pet follows Clawd in the scene and leaves the band its full width', () => {
  const s = newSave(always(0.5))
  gainPet(s, 'turtle', [], [])
  const turtle = (rows: { color?: string; bg?: string }[][]) => rows.slice(0, 5).some(r => r.some(seg => seg.color === '#5fb38a' || seg.bg === '#5fb38a'))
  for (const width of [34, 72]) {
    const rows = composePixelScene(s, 1, { fx: ['chest'], at: 0, enemy: null }, width)
    expect(turtle(rows)).toBe(true)
    for (const row of rows) expect([...row.map(seg => seg.text).join('')].length).toBe(Math.max(30, Math.min(width, 72)))
  }
})

// ── Through the hooks ─────────────────────────────────────────────────

const START = { cwd: '/tmp', surface: 'terminal', isInteractive: true } as const

function engineBeneath(on: On, disk: Record<string, unknown>, bash: { isError: boolean }) {
  on('session.start', (_$, e) => ({ cwd: e.cwd }))
  on('command.register', () => ({ value: { command: 'rpg' } }))
  on('store.get', (_$, e) => ({ value: disk[e.key] }))
  on('store.set', (_$, e) => {
    disk[e.key] = e.value
    return { value: undefined }
  })
  on('store.delete', (_$, e) => {
    delete disk[e.key]
    return { value: undefined }
  })
  on('tool.call', { tool: 'Bash' }, () =>
    (bash.isError ? { isError: true, result: 'exit 1', text: 'Exit code 1' } : { result: { stdout: '', stderr: '', interrupted: false }, text: 'ok' }) as never,
  )
}

const lastLog = (disk: Record<string, unknown>) => (disk.save as Save).log.at(-1)!.text

test('commits through Bash open good, small, then good chests across the 30-minute window', async ($, on) => {
  const clock = mock.clock(on)
  const disk: Record<string, unknown> = { save: { ...newSave(always(0.5)), rev: 1 } }
  engineBeneath(on, disk, { isError: false })
  await clock.set(1_000_000)
  await $.tool.call({ tool: 'Bash', command: 'git commit -m "first"' })
  expect((disk.save as Save).log.some(l => l.text.includes('treasure chest'))).toBe(true)
  await clock.advance(10 * 60_000)
  await $.tool.call({ tool: 'Bash', command: 'git commit -m "second"' })
  expect((disk.save as Save).log.some(l => l.text.includes('a small chest'))).toBe(true)
  await clock.advance(21 * 60_000)
  const goodBefore = (disk.save as Save).log.filter(l => l.text.includes('treasure chest')).length
  await $.tool.call({ tool: 'Bash', command: 'git commit -m "third"' })
  expect((disk.save as Save).log.filter(l => l.text.includes('treasure chest')).length > goodBefore || (disk.save as Save).lastGoodChestAt === 1_000_000 + 31 * 60_000).toBe(true)
  expect(JSON.stringify(disk.save).includes('first')).toBe(false)
})

test('a failed commit opens nothing and makes the next tick unlucky', async ($, on) => {
  mock.clock(on)
  const disk: Record<string, unknown> = { save: { ...newSave(always(0.5)), rev: 1 } }
  engineBeneath(on, disk, { isError: true })
  await $.tool.call({ tool: 'Bash', command: 'git commit -m "nope"' })
  expect((disk.save as Save).pendingLuck).toBe('unlucky')
  expect((disk.save as Save).lastGoodChestAt).toBe(undefined)
})

test('pressing a pet in the pane makes it follow Clawd', async ($, on) => {
  mock.clock(on)
  const s = newSave(always(0.5))
  gainPet(s, 'duck', [], [])
  gainPet(s, 'bat', [], [])
  const disk: Record<string, unknown> = { save: { ...s, rev: 1 } }
  engineBeneath(on, disk, { isError: false })
  await $.session.start(START)
  const pane = await $.ui.mount({ plugin: 'clawd-rpg', surface: 'terminal', component: 'Pane', requestId: 'clawd-rpg', props: {} as never })
  expect((await pane.findAll({ type: 'Button', text: /Bat Lv1/ })).length).toBe(1)
  await pane.press({ key: 'pet-bat' })
  expect((disk.save as Save).hero.activePet).toBe('bat')
  await pane.unmount()
})

const run = ($: { command: { run: (e: never) => Promise<unknown> } }, args: string) =>
  $.command.run({ command: 'rpg', args } as never) as Promise<{ text?: string }>

test('reset needs asking first, backs up the old hero, and undo brings it back', async ($, on) => {
  const clock = mock.clock(on)
  const veteran = newSave(always(0.5))
  const disk: Record<string, unknown> = { save: { ...veteran, rev: 7, hero: { ...veteran.hero, level: 12 } } }
  engineBeneath(on, disk, { isError: false })

  expect((await run($, 'reset confirm')).text).toContain('Nothing was reset')
  expect((disk.save as Save).hero.level).toBe(12)

  expect((await run($, 'reset')).text).toContain('permanently deletes')
  expect((disk.save as Save).hero.level).toBe(12)

  await clock.advance(3 * 60_000)
  expect((await run($, 'reset confirm')).text).toContain('Nothing was reset')

  await run($, 'reset')
  expect((await run($, 'reset confirm')).text).toContain('Reset done')
  expect((disk.save as Save).hero.level).toBe(1)
  expect((disk.save as Save).rev).toBe(8)
  expect((disk['save-backup'] as Save).hero.level).toBe(12)

  expect((await run($, 'reset undo')).text).toContain('Restored')
  expect((disk.save as Save).hero.level).toBe(12)
  expect(disk['save-backup']).toBe(undefined)
  expect((await run($, 'reset undo')).text).toContain('no backup')
})

test('every biome still draws with a pet along', () => {
  for (const biome of BIOMES) {
    const s = { ...newSave(always(0.5)), zone: { ...newSave(always(0.5)).zone, biome: biome.id } }
    gainPet(s, 'owl', [], [])
    expect(composePixelScene(s, 3, null, 60).length).toBe(6)
  }
})

// ── The chest left on the road ────────────────────────────────────────

test('a chest opened on the road stays through quiet walking, and goes when anything else happens', () => {
  const opened = openChest(newSave(always(0.5)), 0, always(0.5)).save
  expect(opened.chestOnRoad).toBe(true)
  // 0.99 rolls nothing on the road: a quiet tick of walking.
  const quiet = tick({ ...opened, log: opened.log }, always(0.99)).save
  expect(quiet.chestOnRoad).toBe(true)
  // 0.01 rolls an encounter.
  const ambushed = tick(quiet, always(0.01)).save
  expect(ambushed.phase).toBe('fighting')
  expect(ambushed.chestOnRoad).toBe(false)
})

test('a chest opened mid-fight only flashes by', () => {
  const base = newSave(always(0.5))
  const fighting: Save = { ...base, phase: 'fighting', enemy: makeEnemy(always(0.5), 1, BIOMES[0]!.enemies[0]!, 'normal') }
  expect(openChest(fighting, 0, always(0.5)).save.chestOnRoad).toBe(false)
})

test('a chest left on the road is drawn once, standing still while the road scrolls, and never in combat', () => {
  const opened = { ...openChest(newSave(always(0.5)), 0, always(0.5)).save, phase: 'exploring' as const }
  // The chest's gold (#ffb300) is the only gold in any biome: where it shows is where the chest stands.
  const goldCells = (rows: { text: string; color?: string; bg?: string }[][]) => {
    const cells: string[] = []
    rows.slice(0, 5).forEach((row, r) => {
      let col = 0
      for (const seg of row) {
        const len = [...seg.text].length
        if (seg.color === '#ffb300' || seg.bg === '#ffb300') for (let i = 0; i < len; i++) cells.push(`${r}:${col + i}`)
        col += len
      }
    })
    return cells.join(',')
  }
  const spots = new Set<string>()
  for (let frame = 0; frame < 12; frame++) {
    const cells = goldCells(composePixelScene(opened, frame, null, 64))
    expect(cells.length > 0).toBe(true)
    spots.add(cells)
  }
  // Standing still: the same cells every frame, while the road scrolls underneath.
  expect(spots.size).toBe(1)
  const fight: Save = { ...opened, phase: 'fighting', enemy: makeEnemy(always(0.5), 1, BIOMES[0]!.enemies[0]!, 'normal') }
  expect(goldCells(composePixelScene(fight, 0, null, 64))).toBe('')
})

test('no biome\'s scenery draws a chest any more, so the only chest on screen is a real one', () => {
  const base = newSave(always(0.5))
  for (const biome of BIOMES) {
    const s: Save = { ...base, zone: { ...base.zone, biome: biome.id } }
    for (let frame = 0; frame < 30; frame += 3) {
      expect(composePixelScene(s, frame, null, 72).slice(0, 5).some(r => r.some(seg => seg.color === '#ffb300' || seg.bg === '#ffb300'))).toBe(false)
    }
  }
})
