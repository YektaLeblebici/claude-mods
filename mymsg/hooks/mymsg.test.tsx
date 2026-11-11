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

// The ids of the rows the session's transcript holds, in the order stored.
const stored: string[] = []

// Stands in for the engine beneath the plugin and records what it was asked.
// The kit cannot scroll the transcript for a plugin, so every jump ends in a
// "Could not jump" toast here: a toast is how a test sees a jump was made, and
// the cursor (moved onto the target first) shows where to.
const engine = (on: On, conversation: Said[] = []) => {
  const seen = { toasts: [] as string[], closes: [] as string[], opens: [] as unknown[], reads: 0, copies: [] as string[], canCopy: true, hasPython: true, argvs: [] as string[][] }
  stored.length = 0
  // The transcript script, its offset counted in rows here.
  on('process.run', async (_$, e) => {
    const { argv } = e as { argv: string[] }
    seen.argvs.push(argv)
    if (!seen.hasPython) throw new Error('python3: command not found')
    const from = Number(argv.at(-1))
    return { value: { exitCode: 0, stdout: [`${stored.length}`, ...stored.slice(from), ''].join('\n'), stderr: '' } } as never
  })
  on('session.id', async () => ({ value: 's1' }))
  on('command.run', async () => ({ text: '' }))
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

// A row the transcript stores; a subagent's goes to the subagent's own.
const store = (_$: Engine, uuid: string, extra: { agentId?: string } = {}) => {
  if (!extra.agentId) stored.push(uuid)
}

// A command about to run; `origin` says who ran it.
const run = ($: Engine, command: string, args: string, origin: object) =>
  ($.command.run as (e: never) => Promise<unknown>)({ command, args, origin } as never)

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
      await store($, 'u1')
      await draw($, surface, 'u1', 'hello')
      const ui = await open($, surface)
      await ui.press({ key: 'top' })
      expect(await texts(ui)).toEqual(['hello'])
    })

    test(`${surface}: a row drawn again lists once`, async ($, on) => {
      engine(on)
      await store($, 'u1')
      await draw($, surface, 'u1', 'hello')
      await draw($, surface, 'u1', 'hello')
      const ui = await open($, surface)
      await ui.press({ key: 'top' })
      expect(await texts(ui)).toEqual(['hello'])
    })
  }

  test('only the person’s own messages are listed', async ($, on) => {
    engine(on)
    for (const id of ['u1', 'u2', 'n1', 'p1', 'e1']) await store($, id)
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
    await store($, 'o1')
    await store($, 'o2')
    await output($, 'terminal', 'o1', 'review', '12')
    await output($, 'terminal', 'o2', 'cost')
    const ui = await open($, 'terminal')
    await ui.press({ key: 'top' })
    expect(await texts(ui)).toEqual(['/review 12', '/cost'])
  })

  test('a message queued while Claude works is listed once it is sent, not while it waits', async ($, on) => {
    engine(on)
    // The waiting preview draws under a new id each time and is never stored.
    await draw($, 'terminal', 'w1', '/cost')
    await draw($, 'terminal', 'w2', '/cost')
    await draw($, 'terminal', 'w3', 'and this too')
    const ui = await open($, 'terminal')
    await ui.press({ key: 'top' })
    expect(await texts(ui)).toEqual([])
    await run($, 'cost', '', { kind: 'composer' })
    await store($, 'o1')
    await output($, 'terminal', 'o1', 'cost')
    await store($, 'q1')
    await draw($, 'terminal', 'q1', 'and this too')
    await ui.press({ key: 'top' })
    expect(await texts(ui)).toEqual(['/cost', 'and this too'])
  })

  test('without python every row drawn is listed', async ($, on) => {
    const seen = engine(on)
    seen.hasPython = false
    await draw($, 'terminal', 'w1', 'not stored')
    const ui = await open($, 'terminal')
    await ui.press({ key: 'top' })
    expect(await texts(ui)).toEqual(['not stored'])
  })

  test('opening this pane is not listed', async ($, on) => {
    engine(on)
    await store($, 'o1')
    await store($, 'o2')
    await output($, 'terminal', 'o1', 'mymsg')
    await output($, 'terminal', 'o2', 'cost')
    const ui = await open($, 'terminal')
    await ui.press({ key: 'top' })
    expect(await texts(ui)).toEqual(['/cost'])
  })

  for (const origin of [{ kind: 'plugin', name: 'q' }, { kind: 'peer', from: 'x' }, { kind: 'sdk' }]) {
    test(`a command run by ${origin.kind}, not the person, is not listed, before or after a sync`, async ($, on) => {
      engine(on)
      await store($, 'u1')
      await draw($, 'terminal', 'u1', 'typed')
      await run($, 'code-review', 'high', origin)
      await store($, 'o1')
      await output($, 'terminal', 'o1', 'code-review', 'high')
      const ui = await open($, 'terminal')
      expect(await texts(ui)).toEqual(['typed'])
      await run($, 'compact', '', origin)
      await store($, 'o2')
      await output($, 'terminal', 'o2', 'compact')
      await run($, 'cost', '', { kind: 'bridge' })
      await store($, 'o3')
      await output($, 'terminal', 'o3', 'cost')
      await ui.press({ key: 'top' })
      expect(await texts(ui)).toEqual(['typed', '/cost'])
    })
  }

  test('each output row takes the oldest run of its command, once however often it draws', async ($, on) => {
    engine(on)
    for (const id of ['o1', 'o2', 'o3']) await store($, id)
    await run($, 'cost', '', { kind: 'plugin', name: 'q' })
    await run($, 'cost', '', { kind: 'composer' })
    await output($, 'terminal', 'o1', 'cost')
    await output($, 'terminal', 'o2', 'cost')
    await run($, 'cost', '', { kind: 'composer' })
    await output($, 'terminal', 'o1', 'cost')
    await output($, 'terminal', 'o3', 'cost')
    const ui = await open($, 'terminal')
    await ui.press({ key: 'top' })
    expect(await ui.find({ key: 'msg:2' })).toBeUndefined()
    expect(await texts(ui)).toEqual(['/cost', '/cost'])
  })

  test('a command’s output row with arguments it hides still takes its run', async ($, on) => {
    engine(on)
    await store($, 'o1')
    await store($, 'o2')
    await run($, 'login', 'secret', { kind: 'plugin', name: 'q' })
    await output($, 'terminal', 'o1', 'login', '***')
    await run($, 'login', 'other', { kind: 'composer' })
    await output($, 'terminal', 'o2', 'login', '***')
    const ui = await open($, 'terminal')
    await ui.press({ key: 'top' })
    expect(await texts(ui)).toEqual(['/login ***'])
  })

  test('a message that starts with a path is a message, not a command', async ($, on) => {
    engine(on)
    await draw($, 'terminal', 'u1', '/Users/me/file.ts is broken')
    const ui = await open($, 'terminal')
    expect(await texts(ui)).toEqual(['/Users/me/file.ts is broken'])
  })

  // The process goes on under another session after both, which must not
  // list the ended one's messages.
  for (const reason of ['clear', 'resume'] as const) {
    test(`a ${reason} starts the list over for the next session`, async ($, on) => {
      engine(on)
      await store($, 'a1')
      await draw($, 'terminal', 'a1', 'from the ended session')
      await output($, 'terminal', 'a2', 'cost')
      await ($.session.end as (e: never) => Promise<unknown>)({ reason, sessionId: 'a', resume: { id: 'a' } } as never).catch(() => undefined)
      const before = await open($, 'terminal')
      expect(await texts(before)).toEqual([])
      await before.unmount()
      await store($, 'b1')
      await draw($, 'terminal', 'b1', 'from the next session')
      const ui = await open($, 'terminal')
      await ui.press({ key: 'top' })
      expect(await texts(ui)).toEqual(['from the next session'])
    })
  }
})

describe('order', () => {
  test('stored rows keep conversation order however late they are drawn', async ($, on) => {
    engine(on)
    // As in a session: prompts, commands and a message sent mid-turn, each
    // stored in turn; fullscreen then draws the newest rows first.
    await store($, 'a')
    await store($, 'o1')
    await store($, 'b')
    await store($, 'q')
    await store($, 'o2')
    await store($, 'c')
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

  test('the timer puts the pane in order without a key press', async ($, on) => {
    const clock = mock.clock(on)
    engine(on)
    await start($)
    await store($, 'a')
    await store($, 'b')
    await draw($, 'terminal', 'b', 'newer')
    await draw($, 'terminal', 'a', 'older')
    await clock.advance(500)
    const ui = await open($, 'terminal')
    expect(await texts(ui)).toEqual(['older', 'newer'])
  })

  test('a row drawn before the transcript stores it is placed once it does', async ($, on) => {
    const clock = mock.clock(on)
    engine(on)
    await start($)
    await store($, 'a')
    await draw($, 'terminal', 'a', 'first')
    await draw($, 'terminal', 'b', 'second')
    await clock.advance(500)
    await store($, 'b')
    await clock.advance(500)
    const ui = await open($, 'terminal')
    expect(await texts(ui)).toEqual(['first', 'second'])
  })

  test('each read of the transcript starts where the last one stopped', async ($, on) => {
    const seen = engine(on)
    await store($, 'a')
    await draw($, 'terminal', 'a', 'first')
    const ui = await open($, 'terminal')
    await ui.press({ key: 'top' })
    await store($, 'b')
    await draw($, 'terminal', 'b', 'second')
    await ui.press({ key: 'bottom' })
    expect(seen.argvs.map(argv => [argv[0], argv[1], argv[2]!.endsWith('/hooks/transcript.py'), ...argv.slice(3)])).toEqual([
      ['python3', '-I', true, 's1', '0'],
      ['python3', '-I', true, 's1', '1'],
    ])
    expect(await texts(ui)).toEqual(['first', 'second'])
  })

  test('without python the rows are placed by their text in the conversation', async ($, on) => {
    const seen = engine(on, [
      { role: 'user', text: 'old one' },
      { role: 'assistant', text: 'ok' },
      { role: 'user', text: '<command-name>/reload-plugins</command-name>\n<command-args></command-args>' },
      { role: 'user', text: 'The user sent a new message while you were working:\nold two' },
      { role: 'user', text: 'new one' },
    ])
    seen.hasPython = false
    await draw($, 'terminal', 'n', 'new one')
    await draw($, 'terminal', 'h2', 'old two')
    await output($, 'terminal', 'h3', 'reload-plugins')
    await draw($, 'terminal', 'h1', 'old one')
    const ui = await open($, 'terminal')
    await ui.press({ key: 'top' })
    expect(await texts(ui)).toEqual(['old one', '/reload-plugins', 'old two', 'new one'])
  })

  test('without python a row the conversation does not match stays after its neighbour', async ($, on) => {
    const seen = engine(on, [
      { role: 'user', text: 'old one' },
      { role: 'user', text: 'old three' },
    ])
    seen.hasPython = false
    await draw($, 'terminal', 'h1', 'old one')
    await output($, 'terminal', 'h2', 'cost')
    await draw($, 'terminal', 'h3', 'old three')
    const ui = await open($, 'terminal')
    await ui.press({ key: 'top' })
    expect(await texts(ui)).toEqual(['old one', '/cost', 'old three'])
  })

  test('a subagent’s rows are not listed', async ($, on) => {
    engine(on)
    await store($, 'sub', { agentId: 'agent-1' })
    await store($, 'a')
    await draw($, 'terminal', 'a', 'mine')
    await draw($, 'terminal', 'sub', 'a subagent’s prompt')
    const ui = await open($, 'terminal')
    await ui.press({ key: 'top' })
    expect(await texts(ui)).toEqual(['mine'])
  })
})

describe('keys', () => {
  for (const surface of SURFACES) {
    test(`${surface}: j and k move the cursor and stop at the ends`, async ($, on) => {
      engine(on)
      for (const id of ['a', 'b', 'c']) await store($, id)
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
    for (const id of ['a', 'b', 'c']) await store($, id)
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
    await store($, 'a')
    await store($, 'o')
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
    await store($, 'a')
    await store($, 'b')
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
    await store($, 'a')
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
    for (const id of ['a', 'b']) await store($, id)
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
    for (const id of ['a', 'b', 'c']) await store($, id)
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
    await store($, 'a')
    await draw($, 'terminal', 'a', 'old one')
    const ui = await open($, 'terminal')
    await clock.advance(500)
    await store($, 'b')
    await draw($, 'terminal', 'b', 'new one')
    await clock.advance(500)
    expect(await texts(ui)).toEqual(['old one', 'new one'])
  })

  test('the timer reads the conversation only when a new row arrived', async ($, on) => {
    const clock = mock.clock(on)
    const seen = engine(on)
    await start($)
    await store($, 'a')
    await draw($, 'terminal', 'a', 'one')
    await clock.advance(500)
    const reads = seen.reads
    await clock.advance(5_000)
    expect(seen.reads).toBe(reads)
    await store($, 'b')
    await draw($, 'terminal', 'b', 'two')
    await clock.advance(500)
    expect(seen.reads).toBe(reads + 1)
  })

  test('a row the transcript never stores is looked for five more times, less often each time, then left', async ($, on) => {
    const clock = mock.clock(on)
    const seen = engine(on)
    await start($)
    await store($, 'a')
    await draw($, 'terminal', 'a', 'one')
    await draw($, 'terminal', 'w1', 'a queued preview')
    await clock.advance(500)
    const runs = seen.argvs.length
    const at = [] as number[]
    for (let tick = 1; tick <= 40; tick++) {
      await clock.advance(500)
      if (seen.argvs.length > runs + at.length) at.push(tick)
    }
    expect(at).toEqual([1, 2, 4, 8, 16])
    const ui = await open($, 'terminal')
    for (const key of ['up', 'down', 'top']) await ui.press({ key })
    expect(seen.argvs.length).toBe(runs + 5)
    expect(await texts(ui)).toEqual(['one'])
  })

  test('moving through a list whose rows all have their place reads no transcript', async ($, on) => {
    const seen = engine(on)
    for (const id of ['a', 'b', 'c']) await store($, id)
    for (const id of ['a', 'b', 'c']) await draw($, 'terminal', id, `ask ${id}`)
    const ui = await open($, 'terminal')
    await ui.press({ key: 'top' })
    const runs = seen.argvs.length
    for (const key of ['down', 'down', 'up', 'bottom', 'jump']) await ui.press({ key })
    expect(seen.argvs.length).toBe(runs)
    await store($, 'd')
    await draw($, 'terminal', 'd', 'ask d')
    await ui.press({ key: 'bottom' })
    expect(seen.argvs.length).toBe(runs + 1)
    expect(await texts(ui)).toEqual(['ask a', 'ask b', 'ask c', 'ask d'])
  })
})

// Three prompts and a command, stored and drawn in order.
const four = async ($: Engine) => {
  const said = [['a', 'Fix the bug'], ['b', 'add tests'], ['c', 'fix the order\nand the numbers']]
  for (const [id] of said) await store($, id!)
  await store($, 'o')
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
