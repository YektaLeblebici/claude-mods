import { expect, mock, test } from 'claude-code/testing'

import type { Save } from '../types'
import { BIOMES } from './content'
import { makeEnemy, newSave, tick } from './engine'
import { composePixelScene } from './pixel'
import { activeFx, archetypeOf, burstFx, FX_FRAMES, MARQUEE_HOLD, marquee, pixels } from './scene'

const always = (value: number) => () => value
const text = (rows: { text: string }[][]) => rows.map(r => r.map(s => s.text).join(''))

test('bosses get the large archetypes and the rest map by name', () => {
  expect(archetypeOf({ name: 'The White Wyrm', isBoss: true })).toBe('wyrm')
  expect(archetypeOf({ name: 'Jarl Hrimgrim', isBoss: true })).toBe('giant')
  expect(archetypeOf({ name: 'Dire Wolf', isBoss: false })).toBe('beast')
  expect(archetypeOf({ name: 'Cave Bat Swarm', isBoss: false })).toBe('swarm')
  expect(archetypeOf({ name: 'Crypt Spider', isBoss: false })).toBe('crawler')
})

test('a burst plays its effects in order, then hands back to the idle loop', () => {
  const burst = { fx: burstFx(['explore', 'hit', 'hurt']), at: 10, enemy: null }
  expect(burst.fx).toEqual(['hit', 'hurt'])
  expect(activeFx(burst, 10)?.fx).toBe('hit')
  expect(activeFx(burst, 10 + FX_FRAMES)?.fx).toBe('hurt')
  expect(activeFx(burst, 10 + 2 * FX_FRAMES)).toBe(null)
})

test('a level-up burst shouts it', () => {
  const s = newSave(always(0.5))
  const rows = text(composePixelScene(s, 1, { fx: ['level'], at: 0, enemy: null }, 60))
  expect(rows.some(r => r.includes('LEVEL UP!'))).toBe(true)
})

test('the engine reports a fight exchange as hit then hurt', () => {
  const base = newSave(always(0.5))
  const s: Save = { ...base, phase: 'fighting', enemy: makeEnemy(always(0.5), 3, BIOMES[0]!.enemies[1]!, 'normal') }
  expect(tick(s, always(0.5)).fx).toEqual(['hit', 'hurt'])
})

for (const surface of ['terminal', 'desktop'] as const) {
  test(`the band draws the pixel-art scene on ${surface} in the full view`, async ($, on) => {
    mock.store(on)
    mock.clock(on)
    on('tool.call', { tool: 'Bash' }, () => ({ result: { stdout: '', stderr: '', interrupted: false }, text: 'ok' }) as never)
    await $.command.run({ command: 'rpg', args: 'show' } as Parameters<typeof $.command.run>[0])
    await $.tool.call({ tool: 'Bash', command: 'true' })
    const props = { hasSurvey: false, isWorking: false, maxRows: 20, bodyColumns: 60, scroll: { offset: 0, bodyRows: 19 } }
    const band = await $.ui.mount({ plugin: 'clawd-rpg', surface, component: 'AbovePrompt', props: props as never })
    expect((await band.findAll({ type: 'Text', text: /Lv1/ })).length > 0).toBe(true)
    const picture = (await band.findAll({ type: 'Text' })).map(t => t.text).join('')
    expect([...picture].some(ch => '▘▝▖▗▌▐▚▞▛▜▙▟'.includes(ch))).toBe(true)
    await band.unmount()
  })
}

test('quarter-block glyph art is built from pixels, each 2×2 block one character', () => {
  expect(pixels(['#.##..', '..##.#', '#...##', '##..##', '......', '####..'])).toEqual(['▘█▗', '▙ █', '▄▄ '])
  expect(() => pixels(['###', '...', '...', '...', '...', '...'])).toThrow()
})

test('a caption that fits stands still; a long one shows its start, slides along, holds its end, and starts over', () => {
  expect(marquee('A short line.', 20, 37)).toBe('A short line.')
  const text = 'Clawd sets out into the Sunken City of Merrow. Bubble-charms let you breathe. Mostly.'
  const room = 30
  const steps = [...text].length - room
  expect(marquee(text, room, 0)).toBe(text.slice(0, room - 1) + '…')
  expect(marquee(text, room, MARQUEE_HOLD - 1)).toBe(marquee(text, room, 0))
  const middle = marquee(text, room, MARQUEE_HOLD + 10)
  expect(middle.startsWith('…') && middle.endsWith('…')).toBe(true)
  expect(middle.slice(1, -1)).toBe(text.slice(11, 10 + room - 1))
  expect(marquee(text, room, MARQUEE_HOLD + steps)).toBe('…' + text.slice(steps + 1))
  expect(marquee(text, room, MARQUEE_HOLD + steps + MARQUEE_HOLD)).toBe(marquee(text, room, 0))
  for (let age = 0; age < 200; age++) expect([...marquee(text, room, age)].length).toBe(room)
})

test('the band caption scrolls a long line, keeping the band its exact width', () => {
  const long = 'A half-sunk house leans in the reeds like a tired drunk, and something in the water hums back at you.'
  const s: Save = { ...newSave(always(0.5)), log: [{ kind: 'info', text: long }] }
  const caption = (age: number) => composePixelScene(s, 0, null, 60, age)[5]!.map(seg => seg.text).join('')
  expect(caption(0).includes('A half-sunk house')).toBe(true)
  expect(caption(0) === caption(MARQUEE_HOLD + 15)).toBe(false)
  expect(caption(MARQUEE_HOLD + 200).length > 0).toBe(true)
  for (const age of [0, 9, 40, 90]) expect([...caption(age)].length).toBe(60)
})
