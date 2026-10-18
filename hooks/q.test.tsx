import { describe, expect, mock, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import type { On } from 'claude-code'

import { actionOf } from './list'

import {
  CLAUDE_CAP,
  EMPTY,
  addItem,
  controlText,
  judgeBash,
  judgeForkPath,
  isQueueable,
  isSameCommand,
  moveItem,
  parseCommand,
  parseControl,
  parseForkMarker,
  runNext,
  slugOf,
} from './logic'

const PANE_PROPS = { title: 'Queue', isFocused: true, bodyColumns: 90, placement: 'inline' } as never

describe('queue logic', () => {
  test('items of yours queue; Claude past the cap waits for approval', () => {
    let d = addItem(EMPTY, 'fix the flaky login test', 'you').data
    d = { ...d, turnRoot: 'i1' }
    for (let n = 0; n < CLAUDE_CAP; n++) d = addItem(d, `follow-up ${n}`, 'claude').data
    const over = addItem(d, 'one too many', 'claude')

    expect(d.items.map(i => i.status)).toEqual(['queued', 'queued', 'queued', 'queued'])
    expect(over.item.status).toBe('proposed')
    expect(over.item.rootId).toBe('i1')
  })

  test('moving and running next reorder only waiting items', () => {
    let d = EMPTY
    for (const t of ['a', 'b', 'c']) d = addItem(d, t, 'you').data
    d = { ...d, items: d.items.map(i => (i.id === 'i1' ? { ...i, status: 'running' } : i)) }

    expect(moveItem(d, 'i3', -1).items.map(i => i.text)).toEqual(['a', 'c', 'b'])
    expect(moveItem(d, 'i2', -1).items.map(i => i.text)).toEqual(['a', 'b', 'c'])
    expect(runNext(d, 'i3').items.map(i => i.text)).toEqual(['a', 'c', 'b'])
  })

  test('the Bash guard stops discarding everywhere, and pushes and PRs in forks and Claude-queued tasks', () => {
    for (const cmd of [
      'git reset --hard HEAD~1',
      'git checkout -- .',
      'git checkout .',
      'git clean -fd',
      'git restore src/a.ts',
      'git stash drop',
    ]) {
      expect(judgeBash(cmd, 'main'), cmd).toBeDefined()
      expect(judgeBash(cmd, 'claude-task'), cmd).toBeDefined()
      expect(judgeBash(cmd, 'fork'), cmd).toBeDefined()
    }
    for (const cmd of ['git push origin main', 'cd x && gh pr create --fill']) {
      expect(judgeBash(cmd, 'main'), cmd).toBeUndefined()
      expect(judgeBash(cmd, 'claude-task'), cmd).toMatch(/queued yourself/)
      expect(judgeBash(cmd, 'fork'), cmd).toBeDefined()
    }
    for (const cmd of ['git status', 'git commit -m "x"', 'git checkout -b feature', 'git restore --staged a.ts', 'git merge --no-ff q/x']) {
      expect(judgeBash(cmd, 'main'), cmd).toBeUndefined()
    }
  })

  test('a fork writes in its worktree, and in the main checkout only with the merge lock', () => {
    const fork = { worktree: '/r/.claude/worktrees/q-x', mainCheckout: '/r', canMerge: false }

    expect(judgeForkPath('/r/.claude/worktrees/q-x/src/a.ts', fork)).toBeUndefined()
    expect(judgeForkPath('/r/src/a.ts', fork)).toBeDefined()
    expect(judgeForkPath('/tmp/scratch.txt', fork)).toBeUndefined()
    expect(judgeForkPath('/r/src/a.ts', { ...fork, canMerge: true })).toBeUndefined()
  })

  test('control messages and fork markers round-trip', () => {
    const text = controlText({ kind: 'ready', id: 'f2', token: 't', summary: 'done' }, 'q: ready')

    expect(parseControl(`From another session:\n${text}`)).toEqual({ kind: 'ready', id: 'f2', token: 't', summary: 'done' })
    expect(parseControl('<q-msg>{"kind":"ready"}</q-msg>')).toBeUndefined()
    expect(parseForkMarker('<q-fork>{"id":"f1","token":"t","parent":"s","main":"/r"}</q-fork>\nhi')).toEqual({
      id: 'f1',
      token: 't',
      parent: 's',
      main: '/r',
    })
    expect(slugOf('Fix the *flaky* login test!')).toBe('fix-the-flaky-login-test')
  })
})

describe('list keys', () => {
  test('lowercase k/j move the cursor, uppercase or shifted K/J move the task', () => {
    expect(actionOf({ key: 'k' })).toBe('cursor-up')
    expect(actionOf({ key: 'j' })).toBe('cursor-down')
    expect(actionOf({ key: 'K' })).toBe('move-up')
    expect(actionOf({ key: 'j', shift: true })).toBe('move-down')
    expect(actionOf({ key: 'up', shift: true })).toBe('move-up')
    expect(actionOf({ key: 'd' })).toBe('delete')
    expect(actionOf({ key: 'D' })).toBeUndefined()
    expect(actionOf({ key: 'k', ctrl: true })).toBeUndefined()
  })
})

describe('commands', () => {
  test('a slash command and its arguments are told apart from a prompt', () => {
    expect(parseCommand('/code-review high')).toEqual({ name: 'code-review', args: 'high' })
    expect(parseCommand('/simplify')).toEqual({ name: 'simplify', args: '' })
    expect(parseCommand('fix /etc/hosts parsing')).toBeUndefined()
    expect(isSameCommand('anthropic-skills:pdf', 'pdf')).toBe(true)
    expect(isSameCommand('code-review', 'simplify')).toBe(false)
    expect(isQueueable({ name: 'simplify', source: 'builtin' })).toBe(true)
    expect(isQueueable({ name: 'compact', source: 'builtin' })).toBe(false)
    expect(isQueueable({ name: 'rpg', source: 'plugin' })).toBe(false)
    expect(isQueueable({ name: 'clear', source: 'user' })).toBe(false)
  })
})

describe('the mod', () => {
  const listed = async ($: Engine): Promise<string> =>
    String((await $.tool.call({ tool: 'mcp__q__queue_list' } as never)).result)

  test('/q <task> queues it, and the pane lists it', async ($, on) => {
    mock.clock(on)
    mock.store(on)
    await $.command.run({ command: 'q', args: 'bump eslint to v10' })

    expect(await listed($)).toContain('[queued] (you) bump eslint to v10')

    for (const surface of ['terminal', 'desktop'] as const) {
      const ui = await $.ui.mount({ plugin: 'q', surface, component: 'Pane', requestId: 'q', props: PANE_PROPS })
      // Terminal and desktop draw the list as a Client; other surfaces as buttons.
      expect(await ui.find({ type: 'Text', text: /bump eslint to v10/, in: 'list' })).toBeDefined()
      await ui.unmount()
    }
  })

  test('/q with no task opens the pane, and again closes it', async ($, on) => {
    mock.clock(on)
    mock.store(on)
    const opened: string[] = []
    on('ui.open', ($, e) => {
      opened.push(e.id)

      return { value: { isPlaced: true } } as never
    })
    on('ui.panes', () => ({ value: opened.map(id => ({ id, title: 'Queue', isShown: true, isFocused: true, isPlaced: true })) }) as never)
    on('ui.close', ($, e) => {
      opened.splice(opened.indexOf(e.id), 1)

      return { value: undefined } as never
    })

    await $.command.run({ command: 'q', args: '' })
    expect(opened).toEqual(['q'])
    await $.command.run({ command: 'q', args: '' })
    expect(opened).toEqual([])
  })

  test('in default mode a typed prompt is queued, unless the queue is paused', async ($, on) => {
    mock.clock(on)
    mock.store(on)
    const reached: string[] = []
    on('prompt.submit', ($, e) => {
      reached.push(e.text)

      return { text: e.text }
    })
    const type = (text: string) =>
      $.prompt.submit({ text, wait: false, origin: { kind: 'composer' } } as never)

    await type('before default')
    await $.command.run({ command: 'q', args: 'default' })
    const queued = await type('rename the config loader')
    expect(queued.drop).toMatch(/queued #1/)
    expect(await listed($)).toContain('(you) rename the config loader')

    const ui = await $.ui.mount({ plugin: 'q', surface: 'terminal', component: 'Pane', requestId: 'q', props: PANE_PROPS })
    await ui.press({ key: 'pause' })
    await type('answer to your question')
    await ui.unmount()

    expect(reached).toEqual(['before default', 'answer to your question'])
  })

  // The engine beneath a queued command: the command list, git (no repository),
  // and the run itself, which renders a skill's prompt as the engine does.
  const commandWorld = ($: Engine, on: On, commands: { name: string; source: string }[]) => {
    on('process.run', () => ({ value: { exitCode: 128, stdout: '', stderr: 'not a git repository' } }) as never)
    on('command.list', () => ({ value: commands.map(c => ({ ...c, description: '' })) }) as never)
    on('skill.prompt', (_, e) => ({ text: e.text }))
    on('turn.start', (_, e) => ({ turnId: e.turnId }) as never)
    on('turn.complete', (_, e) => ({ text: e.answer }) as never)
    const ran: string[] = []
    const prompts: string[] = []
    on('command.run', async (_, e) => {
      ran.push(`${e.command} ${e.args}`.trim())
      if (commands.some(c => c.name === e.command && c.source !== 'builtin' || e.command === 'code-review')) {
        prompts.push((await $.skill.prompt({ skill: e.command, text: 'Review the diff.' } as never)).text)
      }

      return { text: '' }
    })

    return { ran, prompts }
  }

  test('a queued skill carries the queue instructions and finishes with its turn, not on a timer', async ($, on) => {
    const clock = mock.clock(on)
    mock.store(on)
    const { ran, prompts } = commandWorld($, on, [{ name: 'code-review', source: 'builtin' }])

    await $.command.run({ command: 'q', args: '/code-review high' })
    await clock.advance(10)

    expect(ran).toEqual(['code-review high'])
    expect(prompts[0]).toStartWith('Review the diff.')
    expect(prompts[0]).toContain('[q: this command is queued task q#i1')
    expect(prompts[0]).toContain('queue_pause')

    // A slow turn: long past the old 3 seconds, the task is still running.
    await clock.advance(10_000)
    expect(await listed($)).toContain('[running] (you) /code-review high')

    await $.turn.start({ text: prompts[0], turnId: 't1' } as never)
    await $.turn.complete({ answer: 'Reviewed.', durationMs: 1, isAborted: false, turnId: 't1', reason: 'answer' } as never)
    expect(await listed($)).toContain('[done] (you) /code-review high')
  })

  test('a queued session command is done as soon as it has run', async ($, on) => {
    const clock = mock.clock(on)
    mock.store(on)
    const { ran } = commandWorld($, on, [{ name: 'compact', source: 'builtin' }])

    await $.command.run({ command: 'q', args: '/compact' })
    await clock.advance(10)

    expect(ran).toEqual(['compact'])
    expect(await listed($)).toContain('[done] (you) /compact')
  })

  test('a skill whose turn never starts pauses the queue after a minute', async ($, on) => {
    const clock = mock.clock(on)
    mock.store(on)
    commandWorld($, on, [{ name: 'code-review', source: 'builtin' }])

    await $.command.run({ command: 'q', args: '/code-review' })
    await clock.advance(10)
    await clock.advance(59_000)
    expect(await listed($)).toContain('[running] (you) /code-review')
    expect(await listed($)).not.toContain('never started a turn')

    await clock.advance(2_000)
    expect(await listed($)).toContain('/code-review ran but never started a turn')
  })

  test('/q refuses commands that would wipe the conversation', async ($, on) => {
    mock.clock(on)
    mock.store(on)
    await $.command.run({ command: 'q', args: '/clear' })

    expect(await listed($)).not.toContain('/clear')
  })

  test('in default mode a typed skill is queued, a session command or mod toggle is not', async ($, on) => {
    mock.clock(on)
    mock.store(on)
    on('command.list', () =>
      ({
        value: [
          { name: 'code-review', description: '', source: 'builtin' },
          { name: 'model', description: '', source: 'builtin' },
          { name: 'pdf', description: '', source: 'user' },
          { name: 'rpg', description: '', source: 'plugin', plugin: 'clawd-rpg' },
          { name: 'tools:lint', description: '', source: 'plugin', plugin: 'tools' },
        ],
      }) as never,
    )
    const reached: string[] = []
    on('prompt.submit', ($, e) => {
      reached.push(e.text)

      return { text: e.text }
    })
    const typeCommand = (name: string, args = '') =>
      $.prompt.submit({ text: `/${name} ${args}`.trim(), command: { name, args }, wait: false, origin: { kind: 'composer' } } as never)

    await $.command.run({ command: 'q', args: 'default' })
    expect((await typeCommand('code-review', 'high')).drop).toMatch(/queued/)
    expect((await typeCommand('pdf', 'merge a.pdf b.pdf')).drop).toMatch(/queued/)
    expect((await typeCommand('tools:lint')).drop).toMatch(/queued/)
    await typeCommand('model', 'opus')
    await typeCommand('rpg', 'anim')

    const text = await listed($)
    expect(text).toContain('(you) /code-review high')
    expect(text).toContain('(you) /pdf merge a.pdf b.pdf')
    expect(text).toContain('(you) /tools:lint')
    expect(reached).toEqual(['/model opus', '/rpg anim'])
  })

  test('k/j move the cursor and K/J the task under it; keys act on that task', async ($, on) => {
    mock.clock(on)
    mock.store(on)
    for (const task of ['first', 'second', 'third']) await $.command.run({ command: 'q', args: task })
    const ui = await $.ui.mount({ plugin: 'q', surface: 'terminal', component: 'Pane', requestId: 'q', props: PANE_PROPS })
    const order = async () => [...(await listed($)).matchAll(/\(you\) (\w+)/g)].map(m => m[1])
    const key = async (k: string, shift = false) => {
      await ui.key({ key: k, ...(shift ? { shift: true } : {}), in: 'list' })
      await ui.advance(16)
    }

    // The cursor starts on "first": j moves it to "second", which d deletes.
    await key('j')
    await key('d')
    expect(await order()).toEqual(['first', 'third'])

    // The cursor took "third", the row that replaced "second": K moves it up.
    await key('K', true)
    expect(await order()).toEqual(['third', 'first'])
    expect((await ui.find({ type: 'Text', text: /› .*third/, in: 'list' }))?.props.inverse).toBe(true)

    // k at the top stays there; J moves "third" back down.
    await key('k')
    await key('J', true)
    expect(await order()).toEqual(['first', 'third'])

    // The buttons stay for the mouse and do the same.
    await ui.press({ key: 'move-up' })
    expect(await order()).toEqual(['third', 'first'])
    await ui.unmount()
  })

  test('typing into the pane queues a task, and delete removes the picked one', async ($, on) => {
    mock.clock(on)
    mock.store(on)
    const ui = await $.ui.mount({ plugin: 'q', surface: 'terminal', component: 'Pane', requestId: 'q', props: PANE_PROPS })
    const field = await ui.find({ type: 'Input' })
    await ui.input({ key: String(field?.key), text: 'write the changelog' })
    expect(await listed($)).toContain('write the changelog')

    await ui.key({ key: 'd', in: 'list' })
    await ui.advance(16)
    expect(await listed($)).not.toContain('write the changelog')
    await ui.unmount()
  })

  test("Claude's queue_add lands at the end, and the fourth for one task waits for approval", async ($, on) => {
    mock.clock(on)
    mock.store(on)
    for (const n of [1, 2, 3, 4]) {
      await $.tool.call({ tool: 'mcp__q__queue_add', text: `follow-up ${n}` } as never)
    }
    const text = await listed($)

    expect(text).toContain('[queued] (claude) follow-up 3')
    expect(text).toContain('[proposed] (claude) follow-up 4')
  })
})
