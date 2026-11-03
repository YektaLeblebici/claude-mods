import { describe, expect, mock, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import type { On } from 'claude-code'

const SURFACES = ['terminal', 'desktop'] as const
type Surface = (typeof SURFACES)[number]

const PANE = {
  component: 'Pane',
  requestId: 'mymsg',
  props: {
    title: 'My messages',
    isFocused: true,
    bodyColumns: 60,
    placement: 'dock',
    scroll: { offset: 0, bodyRows: 20 },
    view: {},
  },
} as const

type Said = { role: 'user' | 'assistant'; text: string }

// Stands in for the engine beneath the plugin and records what it was asked.
// The kit cannot scroll the transcript for a plugin, so every jump ends in a
// "Could not jump" toast here: a toast is how a test sees a jump was made, and
// the cursor (moved onto the target first) shows where to.
const engine = (on: On, conversation: Said[] = []) => {
  const seen = { toasts: [] as string[], closes: [] as string[], opens: [] as unknown[], reads: 0, copies: [] as string[], canCopy: true }
  on('ui.render', { component: 'UserMessage' }, async ($, e) => {
    const { Text } = $.ui.resolve(e)
    return <Text>{e.props.text}</Text>
  })
  on('ui.render', { component: 'CommandOutput' }, async ($, e) => {
    const { Text } = $.ui.resolve(e)
    return <Text>{e.props.text}</Text>
  })
  on('session.messages', async () => {
    seen.reads++
    return { value: conversation.map(one => ({ ...one, toolUses: [] })) }
  })
  on('ui.focus', async () => ({}))
  on('ui.toast', async (_$, e) => (seen.toasts.push(JSON.stringify(e)), { value: undefined }))
  on('ui.copy', async (_$, e) => {
    if (!seen.canCopy) return { value: { isCopied: false, reason: 'no-clipboard' } } as never
    seen.copies.push((e as { text: string }).text)
    return { value: { isCopied: true } } as never
  })
  on('ui.close', async (_$, e) => (seen.closes.push((e as { id: string }).id), { value: undefined }))
  on('ui.open', async (_$, e) => (seen.opens.push(e), { value: { isPlaced: true } }) as never)
  on('command.register', async () => ({ value: { command: 'mymsg' } }))
  on('session.start', async () => ({ cwd: '/' }))
  return seen
}

type Found = { text?: string; props?: Record<string, unknown> } | undefined
type Ui = {
  find: (q: { key: string }) => Promise<Found>
  findAll: (q: { type?: string }) => Promise<{ type: string; key?: string }[]>
  press: (q: { key: string }) => Promise<unknown>
  input: (q: { key: string; text: string; kind?: 'change' | 'submit' }) => Promise<unknown>
  unmount: () => Promise<void>
}
type Kit = { ui: { mount: (target: never) => Promise<Ui> } }
const kit = ($: Engine) => $ as never as Kit

const draw = async ($: Engine, surface: Surface, requestId: string, text: string, origin: object = { kind: 'composer' }) =>
  (await kit($).ui.mount({
    plugin: 'mymsg',
    surface,
    component: 'UserMessage',
    requestId,
    props: { text, origin, isExpanded: false },
  } as never)).unmount()

const output = async ($: Engine, surface: Surface, requestId: string, command: string, args = '') =>
  (await kit($).ui.mount({
    plugin: 'mymsg',
    surface,
    component: 'CommandOutput',
    requestId,
    props: { command, args, text: 'done', isErrored: false },
  } as never)).unmount()

// A stored row, as the engine appends it.
const store = ($: Engine, uuid: string, door: string, extra: { name?: string; agentId?: string; type?: string; origin?: object } = {}) =>
  $.session.append({
    message: { type: extra.type ?? 'user', role: 'user', name: extra.name, content: [{ type: 'text', text: uuid }] },
    door,
    origin: extra.origin ?? { kind: 'composer' },
    uuid,
    agentId: extra.agentId,
  } as never)

const open = ($: Engine, surface: Surface | 'mobile') => kit($).ui.mount({ plugin: 'mymsg', surface, ...PANE } as never)

const texts = async (ui: Ui) => {
  const out: string[] = []
  for (let i = 0; ; i++) {
    const found = await ui.find({ key: `msg:${i}` })
    if (!found) return out
    out.push(found.text ?? '')
  }
}

const cursorAt = async (ui: Ui) => {
  for (let i = 0; ; i++) {
    const found = await ui.find({ key: `msg:${i}` })
    if (!found) return -1
    if (found.props?.dimColor === false) return i
  }
}

const focus = ($: Engine, element: string) =>
  ($.ui.focus as (args: never) => Promise<unknown>)({ component: 'Pane', requestId: 'mymsg', plugin: 'mymsg', element, origin: { kind: 'person' } } as never)

const jumps = (seen: { toasts: string[] }) => seen.toasts.filter(one => one.includes('Could not jump')).length

const start = ($: Engine) =>
  ($.session.start as (e: never) => Promise<unknown>)({ cwd: '/', surface: 'terminal', isInteractive: true } as never)

describe('which rows become entries', () => {
  for (const surface of SURFACES) {
    test(`${surface}: rows drawn before their message is stored are skipped`, async ($, on) => {
      engine(on)
      await draw($, surface, 'placeholder', 'hello')
      await draw($, surface, 'placeholder', '/mymsg')
      await draw($, surface, 'u1', 'hello')
      const ui = await open($, surface)
      await ui.press({ key: 'top' })
      expect(await texts(ui)).toEqual(['hello'])
    })

    test(`${surface}: a row drawn again lists once`, async ($, on) => {
      engine(on)
      await draw($, surface, 'u1', 'hello')
      await draw($, surface, 'u1', 'hello')
      const ui = await open($, surface)
      await ui.press({ key: 'top' })
      expect(await texts(ui)).toEqual(['hello'])
    })
  }

  test('only the person’s own messages are listed', async ($, on) => {
    engine(on)
    await draw($, 'terminal', 'u1', 'typed', { kind: 'composer' })
    await draw($, 'terminal', 'u2', 'from the phone', { kind: 'bridge' })
    await draw($, 'terminal', 'n1', 'task done', { kind: 'task-notification' })
    await draw($, 'terminal', 'p1', 'hi from a peer', { kind: 'peer', from: 'x' })
    await draw($, 'terminal', 'e1', '   ', { kind: 'composer' })
    const ui = await open($, 'terminal')
    await ui.press({ key: 'top' })
    expect(await texts(ui)).toEqual(['typed', 'from the phone'])
  })

  test('a command is listed from its output row as /name args', async ($, on) => {
    engine(on)
    await output($, 'terminal', 'o1', 'review', '12')
    await output($, 'terminal', 'o2', 'cost')
    const ui = await open($, 'terminal')
    await ui.press({ key: 'top' })
    expect(await texts(ui)).toEqual(['/review 12', '/cost'])
  })

  test('opening this pane is not listed', async ($, on) => {
    engine(on)
    await store($, 'o1', 'command', { type: 'system', name: 'local_command' })
    await output($, 'terminal', 'o1', 'mymsg')
    await output($, 'terminal', 'o2', 'cost')
    const ui = await open($, 'terminal')
    await ui.press({ key: 'top' })
    expect(await texts(ui)).toEqual(['/cost'])
  })

  for (const origin of [{ kind: 'plugin', name: 'q' }, { kind: 'peer', from: 'x' }, { kind: 'sdk' }]) {
    test(`a command run by ${origin.kind}, not the person, is not listed, drawn before or after it is stored`, async ($, on) => {
      engine(on)
      await store($, 'u1', 'prompt')
      await draw($, 'terminal', 'u1', 'typed')
      await output($, 'terminal', 'o1', 'code-review', 'high')
      await store($, 'o1', 'command', { type: 'system', name: 'local_command', origin })
      await store($, 'o2', 'command', { type: 'system', name: 'local_command', origin })
      await output($, 'terminal', 'o2', 'compact')
      await store($, 'o3', 'command', { type: 'system', name: 'local_command', origin: { kind: 'bridge' } })
      await output($, 'terminal', 'o3', 'cost')
      const ui = await open($, 'terminal')
      await ui.press({ key: 'top' })
      expect(await texts(ui)).toEqual(['typed', '/cost'])
    })
  }

  test('a message that starts with a path is a message, not a command', async ($, on) => {
    engine(on)
    await draw($, 'terminal', 'u1', '/Users/me/file.ts is broken')
    const ui = await open($, 'terminal')
    expect(await texts(ui)).toEqual(['/Users/me/file.ts is broken'])
  })

  test('/clear starts the list over', async ($, on) => {
    engine(on)
    await store($, 'u1', 'prompt')
    await draw($, 'terminal', 'u1', 'before clear')
    await ($.session.end as (e: never) => Promise<unknown>)({ reason: 'clear', sessionId: 's', resume: { id: 's' } } as never).catch(() => undefined)
    const ui = await open($, 'terminal')
    await ui.press({ key: 'top' })
    expect(await texts(ui)).toEqual([])
  })
})

describe('order', () => {
  test('stored rows keep conversation order however late they are drawn', async ($, on) => {
    engine(on)
    // As in a session: prompts, commands and a message sent mid-turn, each
    // stored in turn; fullscreen then draws the newest rows first.
    await store($, 'a', 'prompt')
    await store($, 'o1', 'command', { type: 'system', name: 'local_command' })
    await store($, 'b', 'prompt')
    await store($, 'q', 'attachment', { name: 'queued_command' })
    await store($, 'o2', 'command', { type: 'system', name: 'local_command' })
    await store($, 'c', 'prompt')
    await draw($, 'terminal', 'c', 'latest ask')
    await output($, 'terminal', 'o2', 'cost')
    await draw($, 'terminal', 'q', 'said mid-turn')
    await draw($, 'terminal', 'b', 'second ask')
    await output($, 'terminal', 'o1', 'cost')
    await draw($, 'terminal', 'a', 'first ask')
    const ui = await open($, 'terminal')
    await ui.press({ key: 'bottom' })
    expect(await texts(ui)).toEqual(['first ask', '/cost', 'second ask', 'said mid-turn', '/cost', 'latest ask'])
    expect(await cursorAt(ui)).toBe(5)
  })

  test('the pane is in order as soon as it draws, before any sync', async ($, on) => {
    engine(on)
    await store($, 'a', 'prompt')
    await store($, 'b', 'prompt')
    await draw($, 'terminal', 'b', 'newer')
    await draw($, 'terminal', 'a', 'older')
    const ui = await open($, 'terminal')
    expect(await texts(ui)).toEqual(['older', 'newer'])
  })

  test('history from before the mod loaded comes first, in conversation order', async ($, on) => {
    engine(on, [
      { role: 'user', text: 'old one' },
      { role: 'assistant', text: 'ok' },
      { role: 'user', text: '<command-name>/reload-plugins</command-name>\n<command-args></command-args>' },
      { role: 'user', text: 'The user sent a new message while you were working:\nold two' },
    ])
    await store($, 'n', 'prompt')
    await draw($, 'terminal', 'n', 'new one')
    await draw($, 'terminal', 'h2', 'old two')
    await output($, 'terminal', 'h3', 'reload-plugins')
    await draw($, 'terminal', 'h1', 'old one')
    const ui = await open($, 'terminal')
    await ui.press({ key: 'top' })
    expect(await texts(ui)).toEqual(['old one', '/reload-plugins', 'old two', 'new one'])
  })

  test('a history row the conversation does not match stays after its neighbour', async ($, on) => {
    engine(on, [
      { role: 'user', text: 'old one' },
      { role: 'user', text: 'old three' },
    ])
    await draw($, 'terminal', 'h1', 'old one')
    await output($, 'terminal', 'h2', 'cost')
    await draw($, 'terminal', 'h3', 'old three')
    const ui = await open($, 'terminal')
    await ui.press({ key: 'top' })
    expect(await texts(ui)).toEqual(['old one', '/cost', 'old three'])
  })

  test('a subagent’s rows do not take a place', async ($, on) => {
    engine(on)
    await store($, 'sub', 'prompt', { agentId: 'agent-1' })
    await store($, 'a', 'prompt')
    await draw($, 'terminal', 'a', 'mine')
    await draw($, 'terminal', 'sub', 'history row')
    const ui = await open($, 'terminal')
    await ui.press({ key: 'top' })
    expect(await texts(ui)).toEqual(['history row', 'mine'])
  })
})

describe('keys', () => {
  for (const surface of SURFACES) {
    test(`${surface}: j and k move the cursor and stop at the ends`, async ($, on) => {
      engine(on)
      for (const id of ['a', 'b', 'c']) await store($, id, 'prompt')
      for (const id of ['a', 'b', 'c']) await draw($, surface, id, `ask ${id}`)
      const ui = await open($, surface)
      await ui.press({ key: 'top' })
      expect(await cursorAt(ui)).toBe(0)
      await ui.press({ key: 'up' })
      expect(await cursorAt(ui)).toBe(0)
      await ui.press({ key: 'down' })
      await ui.press({ key: 'down' })
      await ui.press({ key: 'down' })
      expect(await cursorAt(ui)).toBe(2)
      await ui.press({ key: 'up' })
      expect(await cursorAt(ui)).toBe(1)
    })
  }

  test('t and b move to the ends and jump there', async ($, on) => {
    const seen = engine(on)
    for (const id of ['a', 'b', 'c']) await store($, id, 'prompt')
    for (const id of ['a', 'b', 'c']) await draw($, 'terminal', id, `ask ${id}`)
    const ui = await open($, 'terminal')
    await ui.press({ key: 'bottom' })
    expect(await cursorAt(ui)).toBe(2)
    expect(jumps(seen)).toBe(1)
    await ui.press({ key: 'top' })
    expect(await cursorAt(ui)).toBe(0)
    expect(jumps(seen)).toBe(2)
  })

  test('l jumps to the entry under the cursor, a command too', async ($, on) => {
    const seen = engine(on)
    await store($, 'a', 'prompt')
    await store($, 'o', 'command', { type: 'system', name: 'local_command' })
    await draw($, 'terminal', 'a', 'ask')
    await output($, 'terminal', 'o', 'cost')
    const ui = await open($, 'terminal')
    await ui.press({ key: 'top' })
    const before = jumps(seen)
    await ui.press({ key: 'jump' })
    expect(await cursorAt(ui)).toBe(0)
    await ui.press({ key: 'down' })
    await ui.press({ key: 'jump' })
    expect(await cursorAt(ui)).toBe(1)
    expect(jumps(seen)).toBe(before + 2)
  })

  test('pressing a row jumps to that row’s message even if the list re-sorted', async ($, on) => {
    const seen = engine(on)
    await store($, 'a', 'prompt')
    await store($, 'b', 'prompt')
    await draw($, 'terminal', 'b', 'newer')
    const ui = await open($, 'terminal')
    // `a` is drawn after the pane drew `newer` as row 0.
    await draw($, 'terminal', 'a', 'older')
    await ui.press({ key: 'msg:0' })
    // `newer` is now second; jumping by position would land on `older`.
    expect(await texts(ui)).toEqual(['older', 'newer'])
    expect(await cursorAt(ui)).toBe(1)
    expect(jumps(seen)).toBe(1)
  })

  test('a jump the transcript refuses says why', async ($, on) => {
    const seen = engine(on)
    await store($, 'a', 'prompt')
    await draw($, 'terminal', 'a', 'ask')
    const ui = await open($, 'terminal')
    await ui.press({ key: 'jump' })
    expect(seen.toasts).toHaveLength(1)
    expect(seen.toasts[0]).toContain('Could not jump: ')
  })

  test('h closes the pane', async ($, on) => {
    const seen = engine(on)
    const ui = await open($, 'terminal')
    await ui.press({ key: 'close' })
    expect(seen.closes).toEqual(['mymsg'])
  })

  test('the focus ring keeps off the key row and carries the cursor', async ($, on) => {
    engine(on)
    for (const id of ['a', 'b']) await store($, id, 'prompt')
    for (const id of ['a', 'b']) await draw($, 'terminal', id, `ask ${id}`)
    const ui = await open($, 'terminal')
    await ui.press({ key: 'top' })
    await focus($, 'down')
    expect(await cursorAt(ui)).toBe(0)
    await focus($, 'msg:1')
    expect(await cursorAt(ui)).toBe(1)
  })

  test('an empty list draws a hint and the keys do nothing', async ($, on) => {
    const seen = engine(on)
    const ui = await open($, 'terminal')
    for (const key of ['down', 'up', 'top', 'bottom', 'jump']) await ui.press({ key })
    expect(await texts(ui)).toEqual([])
    expect(jumps(seen)).toBe(0)
  })
})

describe('/mymsg', () => {
  test('opens the pane focused with the cursor on the latest entry', async ($, on) => {
    const seen = engine(on)
    for (const id of ['a', 'b', 'c']) await store($, id, 'prompt')
    for (const id of ['c', 'a', 'b']) await draw($, 'terminal', id, `ask ${id}`)
    const ran = await ($.command.run as (e: never) => Promise<{ text?: string }>)({ command: 'mymsg', args: '' } as never)
    expect(ran.text).toContain('j/k')
    expect(seen.opens).toEqual([{ id: 'mymsg', title: 'My messages', focus: true }])
    const ui = await open($, 'terminal')
    expect(await texts(ui)).toEqual(['ask a', 'ask b', 'ask c'])
    expect(await cursorAt(ui)).toBe(2)
  })
})

describe('refresh', () => {
  test('an open pane takes in new rows without a key press', async ($, on) => {
    const clock = mock.clock(on)
    engine(on)
    await start($)
    await store($, 'a', 'prompt')
    await draw($, 'terminal', 'a', 'old one')
    const ui = await open($, 'terminal')
    await clock.advance(500)
    await store($, 'b', 'prompt')
    await draw($, 'terminal', 'b', 'new one')
    await clock.advance(500)
    expect(await texts(ui)).toEqual(['old one', 'new one'])
  })

  test('the timer reads the conversation only when a new row arrived', async ($, on) => {
    const clock = mock.clock(on)
    const seen = engine(on)
    await start($)
    await draw($, 'terminal', 'a', 'one')
    await clock.advance(500)
    const reads = seen.reads
    await clock.advance(5_000)
    expect(seen.reads).toBe(reads)
    await draw($, 'terminal', 'b', 'two')
    await clock.advance(500)
    expect(seen.reads).toBe(reads + 1)
  })
})

// Three prompts and a command, stored and drawn in order.
const four = async ($: Engine) => {
  const said = [['a', 'Fix the bug'], ['b', 'add tests'], ['c', 'fix the order\nand the numbers']]
  for (const [id] of said) await store($, id!, 'prompt')
  await store($, 'o', 'command', { type: 'system', name: 'local_command' })
  for (const [id, text] of said) await draw($, 'terminal', id!, text!)
  await output($, 'terminal', 'o', 'cost')
  return open($, 'terminal')
}

const toasted = (seen: { toasts: string[] }, text: string) => seen.toasts.some(one => one.includes(text))

describe('search', () => {
  test('s opens a field whose typing filters the rows as it changes, ignoring case', async ($, on) => {
    engine(on)
    const ui = await four($)
    expect(await ui.find({ key: 'find' })).toBeUndefined()
    await ui.press({ key: 'search' })
    expect(await ui.find({ key: 'find' })).toBeDefined()
    await ui.input({ key: 'find', text: 'fix', kind: 'change' })
    expect(await texts(ui)).toEqual(['Fix the bug', 'fix the order and the numbers'])
    expect(await cursorAt(ui)).toBe(1)
    await ui.input({ key: 'find', text: 'fix the b', kind: 'change' })
    expect(await texts(ui)).toEqual(['Fix the bug'])
  })

  // The ring holds focus by position among the focusable elements; a field
  // drawn after rows the typing hides would lose it on every letter.
  test('the field stays first in the focus ring while typing hides rows', async ($, on) => {
    engine(on)
    const ui = await four($)
    await ui.press({ key: 'search' })
    const ring = async () =>
      (await ui.findAll({})).filter(one => one.type === 'Button' || one.type === 'Input').map(one => one.key)
    expect((await ring())[0]).toBe('find')
    for (const text of ['f', 'fi', 'fix', 'fix the b', 'nowhere', '']) {
      await ui.input({ key: 'find', text, kind: 'change' })
      expect((await ring())[0]).toBe('find')
    }
  })

  // A field drawn with a new value drops what the person typed since.
  test('the field is drawn without a value, so typing is never reset', async ($, on) => {
    engine(on)
    const ui = await four($)
    await ui.press({ key: 'search' })
    await ui.input({ key: 'find', text: 'fix', kind: 'change' })
    expect((await ui.find({ key: 'find' }))?.props?.value).toBeUndefined()
  })

  test('Enter keeps the filter and closes the field; the keys work on what is shown', async ($, on) => {
    const seen = engine(on)
    const ui = await four($)
    await ui.press({ key: 'search' })
    await ui.input({ key: 'find', text: 'FIX' })
    expect(await ui.find({ key: 'find' })).toBeUndefined()
    expect(await texts(ui)).toEqual(['Fix the bug', 'fix the order and the numbers'])
    await ui.press({ key: 'top' })
    expect(await cursorAt(ui)).toBe(0)
    await ui.press({ key: 'down' })
    await ui.press({ key: 'down' })
    expect(await cursorAt(ui)).toBe(1)
    const before = jumps(seen)
    await ui.press({ key: 'bottom' })
    expect(jumps(seen)).toBe(before + 1)
    expect(await cursorAt(ui)).toBe(1)
  })

  test('submitting an empty search shows every row again', async ($, on) => {
    engine(on)
    const ui = await four($)
    await ui.press({ key: 'search' })
    await ui.input({ key: 'find', text: 'tests' })
    expect(await texts(ui)).toEqual(['add tests'])
    await ui.press({ key: 'search' })
    await ui.input({ key: 'find', text: '' })
    expect(await texts(ui)).toHaveLength(4)
  })

  test('a search matching nothing says so and the keys do nothing', async ($, on) => {
    const seen = engine(on)
    const ui = await four($)
    await ui.press({ key: 'search' })
    await ui.input({ key: 'find', text: 'nowhere' })
    expect(await texts(ui)).toEqual([])
    await ui.press({ key: 'bottom' })
    await ui.press({ key: 'jump' })
    await ui.press({ key: 'copy' })
    expect(jumps(seen)).toBe(0)
    expect(seen.copies).toEqual([])
  })

  test('/mymsg starts without a search', async ($, on) => {
    engine(on)
    const ui = await four($)
    await ui.press({ key: 'search' })
    await ui.input({ key: 'find', text: 'tests' })
    await ($.command.run as (e: never) => Promise<unknown>)({ command: 'mymsg', args: '' } as never)
    expect(await texts(ui)).toHaveLength(4)
  })
})

describe('go to', () => {
  test('g and a number jump to that entry and close the field', async ($, on) => {
    const seen = engine(on)
    const ui = await four($)
    await ui.press({ key: 'goto' })
    expect(await ui.find({ key: 'number' })).toBeDefined()
    await ui.input({ key: 'number', text: ' 2 ' })
    expect(await ui.find({ key: 'number' })).toBeUndefined()
    expect(await cursorAt(ui)).toBe(1)
    expect(jumps(seen)).toBe(1)
    await ui.press({ key: 'goto' })
    await ui.input({ key: 'number', text: '4' })
    expect(await cursorAt(ui)).toBe(3)
    expect(jumps(seen)).toBe(2)
  })

  test('numbers stay those of the whole list while searching', async ($, on) => {
    engine(on)
    const ui = await four($)
    await ui.press({ key: 'search' })
    await ui.input({ key: 'find', text: 'fix' })
    await ui.press({ key: 'goto' })
    await ui.input({ key: 'number', text: '3' })
    expect(await texts(ui)).toEqual(['Fix the bug', 'fix the order and the numbers'])
    expect(await cursorAt(ui)).toBe(1)
  })

  test('a number the search hides clears the search and goes there', async ($, on) => {
    engine(on)
    const ui = await four($)
    await ui.press({ key: 'search' })
    await ui.input({ key: 'find', text: 'fix' })
    await ui.press({ key: 'goto' })
    await ui.input({ key: 'number', text: '2' })
    expect(await texts(ui)).toHaveLength(4)
    expect(await cursorAt(ui)).toBe(1)
  })

  for (const text of ['0', '5', 'two', '1.5', '']) {
    test(`"${text}" is not a message: it says so and does not jump`, async ($, on) => {
      const seen = engine(on)
      const ui = await four($)
      await ui.press({ key: 'goto' })
      await ui.input({ key: 'number', text })
      expect(toasted(seen, 'No message')).toBe(true)
      expect(jumps(seen)).toBe(0)
      expect(await ui.find({ key: 'number' })).toBeUndefined()
    })
  }
})

describe('copy', () => {
  test('c copies the whole message under the cursor, line breaks kept', async ($, on) => {
    const seen = engine(on)
    const ui = await four($)
    await ui.press({ key: 'top' })
    await ui.press({ key: 'down' })
    await ui.press({ key: 'down' })
    await ui.press({ key: 'copy' })
    expect(seen.copies).toEqual(['fix the order\nand the numbers'])
    expect(toasted(seen, 'Copied message 3')).toBe(true)
  })

  test('a command copies as /name args', async ($, on) => {
    const seen = engine(on)
    const ui = await four($)
    await ui.press({ key: 'bottom' })
    await ui.press({ key: 'copy' })
    expect(seen.copies).toEqual(['/cost'])
  })

  test('a copy that did not reach a clipboard says why', async ($, on) => {
    const seen = engine(on)
    seen.canCopy = false
    const ui = await four($)
    await ui.press({ key: 'copy' })
    expect(toasted(seen, 'Could not copy: no-clipboard')).toBe(true)
  })
})

describe('mobile', () => {
  test('without a text field there is no search or go to, but copy stays', async ($, on) => {
    engine(on)
    await draw($, 'terminal', 'a', 'hello')
    const ui = await open($, 'mobile')
    expect(await ui.find({ key: 'search' })).toBeUndefined()
    expect(await ui.find({ key: 'goto' })).toBeUndefined()
    expect(await ui.find({ key: 'copy' })).toBeDefined()
  })
})
