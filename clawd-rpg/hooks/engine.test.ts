import { expect, mock, test } from 'claude-code/testing'

import type { Save } from '../types'
import { BIOMES } from './content'
import { heroName, heroStats, makeEnemy, newSave, setLuck, statusLine, tick, xpToNext, type Rng } from './engine'

const seeded = (seed: number): Rng => () => {
  seed = (seed + 0x6d2b79f5) | 0
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed)
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296
}
const always = (value: number): Rng => () => value

const fighting = (save: Save): Save => ({
  ...save,
  phase: 'fighting',
  enemy: makeEnemy(always(0.5), 1, BIOMES[0]!.enemies[1]!, 'normal'),
})

test('a lucky tick explores twice as far as a neutral one', () => {
  const start = newSave(seeded(1))
  // 0.99 skips encounters, loot and gold; only movement differs.
  const neutral = tick(start, always(0.99)).save
  const lucky = tick(setLuck(start, false), always(0.99)).save
  expect(neutral.zone.progress).toBe(1)
  expect(lucky.zone.progress).toBe(2)
  expect(lucky.pendingLuck).toBe('neutral')
})

test('an unlucky tick spawns a monster where a neutral one would not', () => {
  const start = newSave(seeded(2))
  // 0.5 is above the neutral 30% encounter chance but below the unlucky 70%.
  expect(tick(start, always(0.5)).save.phase).toBe('exploring')
  expect(tick(setLuck(start, true), always(0.5)).save.phase).toBe('fighting')
})

test('an unlucky tick makes the enemy hit harder', () => {
  const start = fighting(newSave(seeded(3)))
  const lostNeutral = start.hero.hp - tick(start, always(0.5)).save.hero.hp
  const lostUnlucky = start.hero.hp - tick(setLuck(start, true), always(0.5)).save.hero.hp
  expect(lostUnlucky > lostNeutral).toBe(true)
})

test('a knock-out recovers and restarts the zone with full HP', () => {
  let s: Save = { ...fighting(newSave(seeded(4))), zone: { ...newSave(seeded(4)).zone, progress: 5 } }
  s = { ...s, hero: { ...s.hero, hp: 1, potions: 0 } }
  s = tick(s, always(0.5)).save
  expect(s.phase).toBe('recovering')
  expect(s.stats.knockouts).toBe(1)
  for (let i = 0; i < 3; i++) s = tick(s, always(0.5)).save
  expect(s.phase).toBe('exploring')
  expect(s.zone.progress).toBe(0)
  expect(s.hero.hp).toBe(heroStats(s.hero).maxHp)
})

test('enough XP levels the hero up and raises a toast', () => {
  const start = newSave(seeded(5))
  const { save, toasts } = tick({ ...start, hero: { ...start.hero, xp: xpToNext(1) } }, always(0.99))
  expect(save.hero.level).toBe(2)
  expect(toasts.some(t => t.includes('Level 2'))).toBe(true)
})

test('a long run stays consistent', () => {
  const rng = seeded(6)
  let s = newSave(rng)
  for (let i = 0; i < 3000; i++) {
    if (i % 3 === 0) s = setLuck(s, rng() < 0.3)
    s = tick(s, rng).save
    expect(s.hero.hp >= 0 && s.hero.hp <= heroStats(s.hero).maxHp).toBe(true)
    expect(s.log.length <= 15).toBe(true)
  }
  expect(s.stats.kills > 0).toBe(true)
  expect(s.zone.depth > 1).toBe(true)
  // Each zone takes at least 8 + depth progress, so depth can never outrun the ticks.
  expect(s.zone.depth < 3000 / 9).toBe(true)
  expect(s.phase === 'camp' || s.stats.bosses >= s.zone.depth - 1).toBe(true)
})

test('a failed Bash call makes the next tick unlucky, without storing the command', async ($, on) => {
  mock.store(on)
  let value: Save | undefined
  on('state.set', ($, e, next) => {
    if (e.plugin === 'clawd-rpg' && e.key === 'save') value = e.value as Save
    return next(e)
  })
  on('tool.call', { tool: 'Bash' }, () => ({ isError: true as const, result: 'exit 1', text: 'Exit code 1' }))
  await $.tool.call({ tool: 'Bash', command: 'curl -H "Authorization: Bearer sk-secret"' })
  expect(value?.pendingLuck).toBe('unlucky')
  expect(JSON.stringify(value).includes('sk-secret')).toBe(false)
})

test('the XP bar fills as Clawd nears the next level', () => {
  const start = newSave(seeded(9))
  const halfway = { ...start, hero: { ...start.hero, xp: Math.round(xpToNext(1) / 2) } }
  expect(statusLine(halfway)).toContain('Lv1 ▰▰▰▱▱ HP')
})

test('Clawd earns cooler titles as renown grows, with a toast for each', () => {
  const start = newSave(seeded(7))
  expect(heroName(start)).toBe('Clawd the Newbie')
  // 160 kills + 2 bosses + level 1 is 195 renown; the level-up this tick makes it 200.
  const veteran: Save = { ...start, hero: { ...start.hero, xp: xpToNext(1) }, stats: { ...start.stats, kills: 160, bosses: 2 } }
  const { save, toasts } = tick(veteran, always(0.99))
  expect(heroName(save)).toBe('Clawd the Butcher')
  expect(toasts).toContain('New title: Clawd the Butcher')
  expect(tick(save, always(0.99)).toasts.some(t => t.startsWith('New title'))).toBe(false)
})

test('the status line leads with a sword, then the hero', () => {
  const line = statusLine(newSave(seeded(8)))
  expect(line.startsWith('⚔  Clawd the Newbie · Lv1 ▱▱▱▱▱ HP')).toBe(true)
  // The sword is the only pictograph on the line.
  expect([...line].filter(ch => /\p{Extended_Pictographic}/u.test(ch))).toEqual(['⚔'])
})

test('the line above the prompt shows the status line, animation off', async ($, on) => {
  mock.store(on)
  on('tool.call', { tool: 'Bash' }, () => ({ result: { stdout: '', stderr: '', interrupted: false }, text: 'ok' }) as never)
  await $.tool.call({ tool: 'Bash', command: 'true' })
  const props = { hasSurvey: false, isWorking: false, maxRows: 20, bodyColumns: 80, scroll: { offset: 0, bodyRows: 19 } }
  const band = await $.ui.mount({ plugin: 'clawd-rpg', surface: 'terminal', component: 'AbovePrompt', props: props as never })
  const texts = await band.findAll({ type: 'Text' })
  expect(texts.length).toBe(1)
  expect((await band.findAll({ type: 'Text', text: /^⚔  Clawd the Newbie · Lv1 ▱▱▱▱▱ HP/ })).length).toBe(1)
  await band.unmount()
})

test('battle text never doubles a boss\'s own article', () => {
  const base = newSave(seeded(10))
  const maw = makeEnemy(always(0.5), 2, BIOMES[1]!.bosses[1]!, 'boss')
  const { save } = tick({ ...base, phase: 'fighting', enemy: maw }, always(0.5))
  const text = save.log.map(l => l.text).join(' ')
  expect(/You \S+ The Deep Maw for \d+/.test(text)).toBe(true)
  expect(/the the/i.test(text)).toBe(false)
})

test('the highest renown earns the final title', () => {
  const start = newSave(seeded(11))
  const legend: Save = { ...start, stats: { ...start.stats, kills: 5000 } }
  expect(heroName(legend)).toBe('Clawd the Singularity')
})
