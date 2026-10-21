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
  judgeForkBash,
  judgeForkPath,
  isQueueable,
  isSameCommand,
  cursorForkOf,
  moveCursor,
  keepsFocus,
  moveItem,
  focusTarget,
  refocusTarget,
  removeFork,
  parseCommand,
  parseControl,
  parseForkMarker,
  runNext,
  slugOf,
} from './logic'

/** `/q <args>`, as the person would type it. */
const runQ = ($: Engine, args: string) => $.command.run({ command: 'q', args } as never)

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

  test('the guards see through `..`, restore --worktree, GitHub writes, and main-checkout paths in a fork\'s commands', () => {
    const fork = { worktree: '/r/.claude/worktrees/q-x', mainCheckout: '/r', canMerge: false }
    expect(judgeForkPath('/r/.claude/worktrees/q-x/../../../src/a.ts', fork)).toBeDefined()
    expect(judgeForkPath('/r/.claude/worktrees/q-x//src/./a.ts', fork)).toBeUndefined()

    for (const cmd of ['git restore --staged --worktree a.ts', 'git restore -SW a.ts', 'git restore --worktree --staged .']) {
      expect(judgeBash(cmd, 'main'), cmd).toBeDefined()
    }
    expect(judgeBash('git restore -S a.ts', 'main')).toBeUndefined()

    for (const cmd of [
      'gh pr merge 3 --squash',
      'gh issue comment 4 -b hi',
      'gh release create v1',
      'gh repo delete me/x --yes',
      'gh repo edit --visibility public',
      'gh api -X DELETE repos/me/x',
      'gh api --method=PATCH repos/me/x',
      'gh api repos/me/x/issues -f title=hi',
    ]) {
      expect(judgeBash(cmd, 'main'), cmd).toBeUndefined()
      expect(judgeBash(cmd, 'claude-task'), cmd).toMatch(/queued yourself/)
      expect(judgeBash(cmd, 'fork'), cmd).toBeDefined()
    }
    for (const cmd of ['gh api repos/me/x', 'gh pr view 3', 'gh pr list', 'gh repo view']) expect(judgeBash(cmd, 'fork'), cmd).toBeUndefined()

    expect(judgeForkBash('sed -i s/a/b/ /r/src/a.ts', fork)).toBeDefined()
    expect(judgeForkBash('cd /r/.claude/worktrees/q-x/../../.. && make', fork)).toBeDefined()
    expect(judgeForkBash('sed -i s/a/b/ /r/.claude/worktrees/q-x/src/a.ts && cat /tmp/x', fork)).toBeUndefined()
    expect(judgeForkBash('cd /r && git merge q/x', { ...fork, canMerge: true })).toBeUndefined()
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

describe('forks in the pane', () => {
  const withFork = () => {
    let d = addItem(EMPTY, 'waiting task', 'you').data
    d = addItem(d, 'forked task', 'you').data
    d = {
      ...d,
      items: d.items.map(i => (i.id === 'i2' ? { ...i, status: 'forked' as const } : i)),
      forks: [{ id: 'f3', itemId: 'i2', text: 'forked task', kind: 'agent' as const, status: 'failed' as const, token: 't' }],
      seq: 3,
    }

    return d
  }

  test('the cursor walks from the tasks onto the forks', () => {
    const d = moveCursor(withFork(), 1)

    expect(cursorForkOf(d)?.id).toBe('f3')
  })

  test('deleting a fork drops its task; sending it back queues the task first', () => {
    const dropped = removeFork(withFork(), 'f3', 'drop')
    expect(dropped.forks).toEqual([])
    expect(dropped.items.map(i => i.text)).toEqual(['waiting task'])

    const sent = removeFork(withFork(), 'f3', 'send-back')
    expect(sent.items.map(i => `${i.text}:${i.status}`)).toEqual(['forked task:queued', 'waiting task:queued'])

    // Its task gone from the list (cleared): it comes back as a new task, first in line.
    const gone = { ...withFork(), items: withFork().items.filter(i => i.id !== 'i2') }
    expect(removeFork(gone, 'f3', 'send-back').items.map(i => i.text)).toEqual(['forked task', 'waiting task'])
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
    await runQ($, 'bump eslint to v10')

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

    await runQ($, '')
    expect(opened).toEqual(['q'])
    await runQ($, '')
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
    await runQ($, 'default')
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
  const commandWorld = (
    $: Engine,
    on: On,
    commands: { name: string; source: string }[],
    agents: { id: string; description: string; type: string; status: string }[] = [],
    onRun: (e: { command: string; args: string }) => void = () => {},
  ) => {
    on('process.run', () => ({ value: { exitCode: 128, stdout: '', stderr: 'not a git repository' } }) as never)
    on('command.list', () => ({ value: commands.map(c => ({ ...c, description: '' })) }) as never)
    on('agent.list', () => ({ value: [...agents] }) as never)
    on('skill.prompt', (_, e) => ({ text: e.text }))
    on('turn.start', (_, e) => ({ turnId: e.turnId }) as never)
    on('turn.complete', (_, e) => ({ text: e.answer }) as never)
    const ran: string[] = []
    const prompts: string[] = []
    on('command.run', async (_, e) => {
      ran.push(`${e.command} ${e.args}`.trim())
      onRun(e)
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

    await runQ($, '/code-review high')
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

    await runQ($, '/compact')
    await clock.advance(10)

    expect(ran).toEqual(['compact'])
    expect(await listed($)).toContain('[done] (you) /compact')
  })

  test('a skill whose turn never starts pauses the queue after a minute', async ($, on) => {
    const clock = mock.clock(on)
    mock.store(on)
    commandWorld($, on, [{ name: 'code-review', source: 'builtin' }])

    await runQ($, '/code-review')
    await clock.advance(10)
    await clock.advance(59_000)
    expect(await listed($)).toContain('[running] (you) /code-review')
    expect(await listed($)).not.toContain('never started a turn')

    await clock.advance(2_000)
    expect(await listed($)).toContain('/code-review ran but never started a turn')
  })

  test('a forked skill waits for its background agent, however long, and finishes with its notification turn', async ($, on) => {
    const clock = mock.clock(on)
    mock.store(on)
    const agent = { id: 'a1', description: `/code-review --fix`, type: 'code-review', status: 'running' }
    const agents: (typeof agent)[] = []
    commandWorld($, on, [{ name: 'code-review', source: 'builtin' }], agents, () => agents.push(agent))

    await runQ($, '/code-review --fix')
    await clock.advance(10)

    // Four minutes in, the agent still works: no pause, and a turn the person starts is not the command's.
    await clock.advance(240_000)
    expect(await listed($)).not.toContain('never started a turn')
    await $.turn.start({ text: 'what is 2 + 2?', turnId: 't1' } as never)
    await $.turn.complete({ answer: '4', durationMs: 1, isAborted: false, turnId: 't1', reason: 'answer' } as never)
    expect(await listed($)).toContain('[running] (you) /code-review --fix')

    agent.status = 'completed'
    const note = '<task-notification> <task-id>a1</task-id> <status>completed</status> </task-notification>'
    await $.turn.start({ text: note, turnId: 't2' } as never)
    await $.turn.complete({ answer: 'Committed the fixes.', durationMs: 1, isAborted: false, turnId: 't2', reason: 'answer' } as never)
    expect(await listed($)).toContain('[done] (you) /code-review --fix')
    expect(await listed($)).not.toContain('no turn picked up')
  })

  test('a forked skill whose agent ended with no turn after it pauses the queue', async ($, on) => {
    const clock = mock.clock(on)
    mock.store(on)
    const agent = { id: 'a1', description: '/code-review', type: 'code-review', status: 'running' }
    const agents: (typeof agent)[] = []
    commandWorld($, on, [{ name: 'code-review', source: 'builtin' }], agents, () => agents.push(agent))

    await runQ($, '/code-review')
    await clock.advance(10)
    await clock.advance(90_000)
    expect(await listed($)).not.toContain('no turn picked up')

    agent.status = 'killed'
    await clock.advance(61_000)
    expect(await listed($)).toContain('/code-review ran in the background, but no turn picked up its result')
  })

  test('/q refuses commands that would wipe the conversation', async ($, on) => {
    mock.clock(on)
    mock.store(on)
    await runQ($, '/clear')

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

    await runQ($, 'default')
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
    for (const task of ['first', 'second', 'third']) await runQ($, task)
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

  /** git beneath the mod: a repository at /repo whose fork branch is (or isn't) merged, with `commits` of its own. */
  const gitAnswers = (isBranchMerged: boolean, commits = 1, ran: string[] = []) => ($: unknown, e: { argv: readonly string[] }) => {
    const args = e.argv.join(' ')
    ran.push(args)
    const out = (stdout: string, exitCode = 0) => ({ value: { exitCode, stdout, stderr: '' } }) as never
    if (args.includes('--show-toplevel')) return out('/repo\n')
    if (args.includes('rev-list --count')) return out(`${commits}\n`)
    if (args.includes('--abbrev-ref')) return out('main\n')
    if (args.includes('--git-common-dir')) return out('/repo/.git\n')
    if (args.includes('merge-base --is-ancestor')) return out('', isBranchMerged ? 0 : 1)
    if (args.includes('rev-parse --short HEAD')) return out('d14c2d7\n')

    return out('')
  }

  test('a fork whose subagent never started fails, its task goes back in the queue, and nothing is left behind', async ($, on) => {
    mock.clock(on)
    mock.store(on)
    const ran: string[] = []
    on('process.run', gitAnswers(true, 1, ran))
    on('fs.read', () => ({ value: '' }) as never)
    on('fs.write', () => ({ value: undefined }) as never)
    on('session.id', () => ({ value: 'main-session' }) as never)
    // A hook's answer starts no subagent: no agentId comes back.
    on('agent.spawn', () => ({ model: 'claude-opus-5-5' }) as never)

    await runQ($, 'add a cache')
    const ui = await $.ui.mount({ plugin: 'q', surface: 'terminal', component: 'Pane', requestId: 'q', props: PANE_PROPS })
    await ui.key({ key: 'a', in: 'list' })
    await ui.advance(16)
    await ui.unmount()

    const text = await listed($)
    expect(text).toContain('fork f2 [failed] (agent) add a cache')
    expect(text).toContain('#1 [queued] (you) add a cache')
    expect(ran).toContain('git worktree remove --force /repo/.claude/worktrees/q-add-a-cache-f2')
    expect(ran).toContain('git branch -D q/add-a-cache-f2')
  })

  for (const [isBranchMerged, commits, label] of [
    [true, 1, 'merged per git'],
    [false, 1, 'failed, queue paused'],
    [true, 0, 'no commits of its own: not merged, failed'],
  ] as const) {
    const isMerged = isBranchMerged && commits > 0
    test(`a merging fork that ends without reporting: ${label}`, async ($, on) => {
      const clock = mock.clock(on)
      const fork = {
        id: 'f2', itemId: 'i1', text: 'add a cache', kind: 'agent', status: 'merging', token: 't',
        branch: 'q/add-a-cache-f2', worktree: '/repo/.claude/worktrees/q-add-a-cache-f2', agentId: 'fork-agent', base: 'b0',
      }
      const saved = {
        ...EMPTY, seq: 2, mergeHolder: 'f2', forks: [fork],
        items: [{ id: 'i1', text: 'add a cache', source: 'you', status: 'forked', rootId: 'i1' }],
      }
      mock.store(on, { 'session:main-session': saved })
      const appended = mock.session(on)
      on('process.run', gitAnswers(isBranchMerged, commits))
      on('session.id', () => ({ value: 'main-session' }) as never)
      on('session.start', ($, e) => ({ cwd: e.cwd }) as never)
      on('turn.complete', ($, e) => ({ text: e.answer }) as never)

      await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: true })
      await $.turn.complete({ agentId: 'fork-agent', turnId: 't2', reason: 'answer', answer: '', durationMs: 1, isAborted: false } as never)
      await clock.advance(10)

      const text = await listed($)
      if (isMerged) {
        expect(text).toContain('fork f2 [merged]')
        expect(text).toStartWith('Queue idle.')
        expect(JSON.stringify(appended.appended())).toContain('merged q/add-a-cache-f2 into main (d14c2d7)')
      } else {
        expect(text).toContain('fork f2 [failed]')
        expect(text).toContain('is not in the main checkout')
      }
    })
  }

  test('the button row is spaced and undimmed, each key in the hotkey colour', async ($, on) => {
    mock.clock(on)
    mock.store(on)
    await runQ($, 'something')
    const ui = await $.ui.mount({ plugin: 'q', surface: 'terminal', component: 'Pane', requestId: 'q', props: PANE_PROPS })
    const buttons = await ui.findAll({ type: 'Button' })

    expect(buttons.map(b => b.text).slice(0, 3)).toEqual(['e edit', 'd delete', 'k cursor up'])
    expect(buttons.every(b => b.props.dimColor !== true)).toBe(true)
    const keys = (await ui.findAll({ type: 'Text' })).filter(t => t.props.bold === true && /^[a-zA-Z]$/.test(t.text))
    expect(keys.map(k => k.text).slice(0, 3)).toEqual(['e', 'd', 'k'])
    expect(keys.every(k => k.props.color === 'suggestion')).toBe(true)
    // The buttons sit directly in one wrapping row spaced by a gap: no Fragment or
    // separator, which the terminal would stack as columns.
    const row = (await ui.findAll({ type: 'Box' })).find(b => b.props.flexWrap === 'wrap')
    expect(row?.props).toMatchObject({ flexDirection: 'row', flexWrap: 'wrap', columnGap: 2 })
    expect(row?.children.filter(c => (c as { type?: string }).type !== 'Button')).toEqual([])
    await ui.unmount()
  })

  test('focus: the list keeps the keys while drawn; without it, only a click on nothing or a vanished list hands them to the field', () => {
    const at = (ringAt: string | undefined, hasList: boolean, justFocused = false) =>
      focusTarget({ ringAt, inputKey: 'new:4', hasList, justFocused })

    // The list is drawn: the same rule as refocusTarget.
    expect(at('delete', true)).toBe('list')
    expect(at('list', true)).toBeUndefined()

    // No list: a click on the header focuses nothing, so the field takes the keys.
    expect(at(undefined, false, true)).toBe('new:4')
    // The last row was deleted while the list had the keys: the field takes them.
    expect(at('list', false)).toBe('new:4')
    // Tab from the field onto a button stays there: the buttons have their hotkeys.
    expect(at('pause', false)).toBeUndefined()
    expect(at('new:4', false)).toBeUndefined()
    // No new focus and nothing held: nothing to do.
    expect(at(undefined, false)).toBeUndefined()
  })

  test('while the list is drawn it keeps the keys; text fields keep them while typing', () => {
    // A click on a button or blank space leaves the ring on the button, or nowhere: back to the list.
    expect(refocusTarget('delete', 'new:4')).toBe('list')
    expect(refocusTarget(undefined, 'new:4')).toBe('list')
    // Already home: leave it.
    expect(refocusTarget('list', 'new:4')).toBeUndefined()
    expect(refocusTarget('new:4', 'new:4')).toBeUndefined()
    // The add-task field was redrawn under a new key after queueing: keep typing in the new one.
    expect(refocusTarget('new:3', 'new:4')).toBe('new:4')
    // An edit was saved: back to the list.
    expect(refocusTarget('edit:i2', 'new:4')).toBe('list')

    expect(keepsFocus('list')).toBe(true)
    expect(keepsFocus('new:4')).toBe(true)
    expect(keepsFocus('edit:i2')).toBe(true)
    expect(keepsFocus('send-back')).toBe(false)
  })

  test('the pane taking the keyboard redraws without trouble', async ($, on) => {
    const clock = mock.clock(on)
    mock.store(on)
    await runQ($, 'something')
    const props = (isFocused: boolean) => ({ ...(PANE_PROPS as object), isFocused }) as never
    const ui = await $.ui.mount({ plugin: 'q', surface: 'terminal', component: 'Pane', requestId: 'q', props: props(false) })
    await ui.redraw(props(true))
    await clock.advance(60)

    expect(await ui.find({ type: 'Text', text: /something/, in: 'list' })).toBeDefined()
    await ui.unmount()
  })

  test('d deletes, b sends back and c clears merged forks, each cleaned up; a merging fork is left alone', async ($, on) => {
    const clock = mock.clock(on)
    const fork = (id: string, status: string, extra: object = {}) => ({
      id, itemId: `i${id.slice(1)}`, text: `task ${id}`, kind: 'agent', status, token: 't',
      branch: `q/task-${id}`, worktree: `/repo/.claude/worktrees/q-task-${id}`, agentId: `agent-${id}`, ...extra,
    })
    const saved = {
      ...EMPTY,
      seq: 5,
      items: ['f1', 'f2', 'f3', 'f4'].map(id => ({ id: `i${id.slice(1)}`, text: `task ${id}`, source: 'you', status: 'forked', rootId: `i${id.slice(1)}` })),
      forks: [fork('f1', 'working'), fork('f2', 'failed'), fork('f3', 'merged'), fork('f4', 'merging')],
      mergeHolder: 'f4',
    }
    mock.store(on, { 'session:main-session': saved })
    const ran: string[] = []
    on('process.run', ($, e) => {
      ran.push(e.argv.join(' '))
      const args = e.argv.join(' ')

      return { value: { exitCode: 0, stdout: args.includes('--show-toplevel') ? '/repo\n' : '', stderr: '' } } as never
    })
    const stopped: unknown[] = []
    on('tool.call', { tool: 'TaskStop' }, ($, e) => {
      stopped.push((e as { task_id?: unknown }).task_id)

      return { result: 'stopped' } as never
    })
    on('session.id', () => ({ value: 'main-session' }) as never)
    on('session.start', ($, e) => ({ cwd: e.cwd }) as never)
    await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: true })

    const ui = await $.ui.mount({ plugin: 'q', surface: 'terminal', component: 'Pane', requestId: 'q', props: PANE_PROPS })
    const key = async (k: string) => {
      await ui.key({ key: k, in: 'list' })
      await ui.advance(16)
      await clock.advance(10)
    }

    // The cursor starts on the first fork (no tasks are listed): delete the working one.
    await key('d')
    expect(stopped).toEqual(['agent-f1'])
    expect(ran).toContain('git worktree remove --force /repo/.claude/worktrees/q-task-f1')
    expect(ran).toContain('git branch -D q/task-f1')
    let text = await listed($)
    expect(text).not.toContain('fork f1')
    expect(text).not.toContain('task f1')

    // Now on the failed one: send it back to the front of the queue.
    await key('b')
    expect(ran).toContain('git branch -D q/task-f2')
    text = await listed($)
    expect(text).not.toContain('fork f2')
    expect(text).toContain('#2 [queued] (you) task f2')

    // Clear finished: the merged fork goes, its worktree only if clean and its branch only if merged.
    await key('c')
    expect(ran).toContain('git worktree remove /repo/.claude/worktrees/q-task-f3')
    expect(ran).toContain('git branch -d q/task-f3')
    text = await listed($)
    expect(text).not.toContain('fork f3')

    // The merging fork refuses delete: stopping it could leave a half-done merge.
    const before = ran.length
    await ui.press({ key: 'cursor-down' })
    await key('d')
    expect(await listed($)).toContain('fork f4 [merging]')
    expect(ran.slice(before).some(c => c.includes('f4'))).toBe(false)
    await ui.unmount()
  })

  /** A session fork holding the merge lock, saved before this session started. */
  const mergingSessionFork = {
    id: 'f2', itemId: 'i1', text: 'add a cache', kind: 'session', status: 'merging', token: 't',
    branch: 'q/add-a-cache-f2', worktree: '/repo/.claude/worktrees/q-add-a-cache-f2', sessionId: 'fork-session', base: 'b0',
  }
  const withMergingFork = { ...EMPTY, seq: 2, mergeHolder: 'f2', forks: [mergingSessionFork], items: [{ id: 'i1', text: 'add a cache', source: 'you', status: 'forked', rootId: 'i1' }] }

  test('a session fork that dies while merging frees the queue: checked every five minutes while it works', async ($, on) => {
    const clock = mock.clock(on)
    mock.store(on, { 'session:main-session': withMergingFork })
    let sessions = '[{"id":"ab12","sessionId":"fork-session","status":"busy"}]'
    on('process.run', ($, e) => {
      if (e.argv.join(' ').includes('agents --json')) return { value: { exitCode: 0, stdout: sessions, stderr: '' } } as never

      return gitAnswers(false)($, e)
    })
    on('session.id', () => ({ value: 'main-session' }) as never)
    on('session.start', ($, e) => ({ cwd: e.cwd }) as never)
    await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: true })

    // Still busy merging: left alone, and checked again later.
    await clock.advance(5 * 60_000 + 10)
    expect(await listed($)).toContain('fork f2 [merging]')

    // Gone without a report, and its branch not merged: the lock is released and the queue says why.
    sessions = '[]'
    await clock.advance(5 * 60_000 + 10)
    const text = await listed($)
    expect(text).toContain('fork f2 [failed]')
    expect(text).toStartWith('Queue paused: Merging "add a cache" failed: the fork stopped without reporting the merge')
  })

  test('p checks a stuck merge at once', async ($, on) => {
    const clock = mock.clock(on)
    mock.store(on, { 'session:main-session': withMergingFork })
    on('process.run', ($, e) => {
      if (e.argv.join(' ').includes('agents --json')) return { value: { exitCode: 0, stdout: '[]', stderr: '' } } as never

      return gitAnswers(false)($, e)
    })
    on('session.id', () => ({ value: 'main-session' }) as never)
    on('session.start', ($, e) => ({ cwd: e.cwd }) as never)
    await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: true })

    const ui = await $.ui.mount({ plugin: 'q', surface: 'terminal', component: 'Pane', requestId: 'q', props: PANE_PROPS })
    await ui.press({ key: 'pause' })
    await ui.unmount()
    await clock.advance(10)
    expect(await listed($)).toContain('fork f2 [failed]')
  })

  test("a fork's own subagents are held to the fork's rules", async ($, on) => {
    mock.clock(on)
    const fork = {
      id: 'f2', itemId: 'i1', text: 'add a cache', kind: 'agent', status: 'working', token: 't',
      branch: 'q/add-a-cache-f2', worktree: '/repo/.claude/worktrees/q-add-a-cache-f2', agentId: 'fork-agent', base: 'b0',
    }
    mock.store(on, { 'session:main-session': { ...EMPTY, seq: 2, forks: [fork], items: [{ id: 'i1', text: 'add a cache', source: 'you', status: 'forked', rootId: 'i1' }] } })
    on('process.run', gitAnswers(false))
    on('agent.list', () => ({
      value: [
        { id: 'fork-agent', description: 'q: add a cache', type: 'fork', status: 'running' },
        { id: 'helper', parentId: 'fork-agent', description: 'look around', type: 'general-purpose', status: 'running' },
      ],
    }) as never)
    on('tool.call', { tool: 'Edit' }, () => ({ result: 'edited', text: 'edited' }) as never)
    on('tool.call', { tool: 'Bash' }, () => ({ result: { stdout: '', stderr: '', interrupted: false }, text: 'ok' }) as never)
    on('session.id', () => ({ value: 'main-session' }) as never)
    on('session.start', ($, e) => ({ cwd: e.cwd }) as never)
    await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: true })

    const call = (input: object) => $.tool.call(input as never) as Promise<{ deny?: string }>
    const edit = (file_path: string, agentId?: string) => call({ tool: 'Edit', file_path, old_string: 'a', new_string: 'b', agentId })

    expect((await edit('/repo/src/a.ts', 'helper')).deny).toMatch(/main checkout/)
    expect((await edit('/repo/.claude/worktrees/q-add-a-cache-f2/src/a.ts', 'helper')).deny).toBeUndefined()
    expect((await call({ tool: 'Bash', command: 'git push', agentId: 'helper' })).deny).toMatch(/queue fork/)
    expect((await call({ tool: 'Bash', command: 'sed -i s/a/b/ /repo/src/a.ts', agentId: 'helper' })).deny).toMatch(/main checkout/)
    // The main session is not a fork.
    expect((await edit('/repo/src/a.ts')).deny).toBeUndefined()
  })

  test('a ready fork being deleted is never granted the merge meanwhile', async ($, on) => {
    const clock = mock.clock(on)
    const fork = {
      id: 'f1', itemId: 'i1', text: 'add a cache', kind: 'agent', status: 'ready', readyAt: 1, token: 't',
      branch: 'q/add-a-cache-f1', worktree: '/repo/.claude/worktrees/q-add-a-cache-f1', agentId: 'fork-agent', base: 'b0',
    }
    mock.store(on, { 'session:main-session': { ...EMPTY, seq: 1, forks: [fork], items: [{ id: 'i1', text: 'add a cache', source: 'you', status: 'forked', rootId: 'i1' }] } })
    on('process.run', gitAnswers(false))
    const sent: unknown[] = []
    on('session.send', ($, e) => {
      sent.push(e)

      return { value: { isDelivered: true } } as never
    })
    // Stopping the fork takes a while: until the test lets it finish.
    let finish!: () => void
    const stopping = new Promise<void>(resolve => (finish = resolve))
    on('tool.call', { tool: 'TaskStop' }, async () => {
      await stopping

      return { result: 'stopped' } as never
    })
    on('turn.complete', ($, e) => ({ text: e.answer }) as never)
    on('session.id', () => ({ value: 'main-session' }) as never)
    on('session.start', ($, e) => ({ cwd: e.cwd }) as never)
    await $.session.start({ cwd: '/repo', surface: 'terminal', isInteractive: true })

    const ui = await $.ui.mount({ plugin: 'q', surface: 'terminal', component: 'Pane', requestId: 'q', props: PANE_PROPS })
    const deleting = ui.key({ key: 'd', in: 'list' })
    await clock.settle()
    // A turn ends meanwhile, and the queue looks for a merge to grant.
    await $.turn.complete({ turnId: 'tx', reason: 'answer', answer: '', durationMs: 1, isAborted: false } as never)
    await clock.advance(10)
    expect(await listed($)).toContain('fork f1 [retiring]')
    expect(JSON.stringify(sent)).not.toContain('merge-go')

    finish()
    await deleting
    await ui.advance(16)
    await clock.advance(10)
    await ui.unmount()
    expect(await listed($)).not.toContain('fork f1')
    expect(JSON.stringify(sent)).not.toContain('merge-go')
  })

  test("saved queues are pruned by when they were last saved, never this session's own", async ($, on) => {
    mock.clock(on, { now: 1_000_000 })
    const disk: Record<string, unknown> = { 'session:main-session': { ...EMPTY, savedAt: 1 } }
    // s0 was created first but saved most recently; s1 and s2 are the stalest of the rest.
    for (let n = 0; n < 31; n++) disk[`session:s${n}`] = { ...EMPTY, savedAt: n === 0 ? 999_999 : 100 + n }
    on('store.get', ($, e) => ({ value: disk[e.key] }) as never)
    on('store.set', ($, e) => {
      disk[e.key] = e.value

      return { value: undefined } as never
    })
    on('store.delete', ($, e) => {
      delete disk[e.key]

      return { value: undefined } as never
    })
    on('store.keys', () => ({ value: Object.keys(disk) }) as never)
    on('process.run', () => ({ value: { exitCode: 128, stdout: '', stderr: 'not a git repository' } }) as never)
    on('session.id', () => ({ value: 'main-session' }) as never)
    on('session.start', ($, e) => ({ cwd: e.cwd }) as never)
    await $.session.start({ cwd: '/tmp', surface: 'terminal', isInteractive: true })

    const left = Object.keys(disk).filter(k => k.startsWith('session:'))
    expect(left.length).toBe(30)
    expect(left).toContain('session:main-session')
    expect(left).toContain('session:s0')
    expect(left).not.toContain('session:s1')
    expect(left).not.toContain('session:s2')
  })

  test('a dirty checkout pauses the queue each time it starts again, not only the first time', async ($, on) => {
    const clock = mock.clock(on)
    mock.store(on)
    on('process.run', ($, e) => {
      const args = e.argv.join(' ')
      const stdout = args.includes('--show-toplevel') ? '/repo\n' : args.includes('status --porcelain') ? ' M src/a.ts\n' : ''

      return { value: { exitCode: 0, stdout, stderr: '' } } as never
    })
    const sent: string[] = []
    on('prompt.submit', ($, e) => {
      sent.push(e.text)

      return { text: e.text }
    })
    on('turn.start', (_, e) => ({ turnId: e.turnId }) as never)
    on('turn.complete', (_, e) => ({ text: e.answer }) as never)
    const paused = 'Queue paused: Your checkout has uncommitted changes'

    await runQ($, 'task one')
    await clock.advance(10)
    expect(await listed($)).toStartWith(paused)

    // Start anyway: the task runs and finishes, and the queue is empty again.
    const ui = await $.ui.mount({ plugin: 'q', surface: 'terminal', component: 'Pane', requestId: 'q', props: PANE_PROPS })
    await ui.press({ key: 'pause' })
    await ui.unmount()
    await clock.advance(10)
    expect(sent.length).toBe(1)
    await $.turn.start({ text: sent[0], turnId: 't1' } as never)
    await $.turn.complete({ answer: 'done', durationMs: 1, isAborted: false, turnId: 't1', reason: 'answer' } as never)
    await clock.advance(10)
    expect(await listed($)).toContain('[done] (you) task one')

    // The next task starts the queue again, so the checkout is checked again.
    await runQ($, 'task two')
    await clock.advance(10)
    expect(await listed($)).toStartWith(paused)
    expect(sent.length).toBe(1)
  })

  test('docked, the list fills the pane; with nothing queued the field does, and the buttons carry the keys', async ($, on) => {
    mock.clock(on)
    mock.store(on)
    const props = { ...(PANE_PROPS as object), placement: 'dock', scroll: { offset: 0, bodyRows: 30 } } as never
    const ui = await $.ui.mount({ plugin: 'q', surface: 'terminal', component: 'Pane', requestId: 'q', props })

    // Nothing queued: no empty list to swallow keys; the field stretches instead.
    expect((await ui.findAll({ type: 'Box' }))[0]?.props.minHeight).toBe(30)
    expect(await ui.find({ type: 'Client', key: 'list' })).toBeUndefined()
    const field = await ui.find({ type: 'Input' })
    expect(field?.props).toMatchObject({ rows: 26, placeholder: expect.stringContaining('Nothing queued') })
    expect((await ui.find({ type: 'Button', key: 'pause' }))?.props.hotkey).toBe('p')

    // A task queued: the list is drawn and fills the pane; the field is one line again.
    await ui.input({ key: String(field?.key), text: 'write the changelog' })
    expect((await ui.find({ type: 'Client', key: 'list' }))?.props).toMatchObject({ flexGrow: 1, width: '100%' })
    expect((await ui.find({ type: 'Input' }))?.props.rows).toBeUndefined()
    expect((await ui.find({ type: 'Button', key: 'pause' }))?.props.hotkey).toBeUndefined()

    // Inline the frame fits the tree: no stretching it to its tallest.
    await ui.redraw({ ...(props as object), placement: 'inline' } as never)
    expect((await ui.findAll({ type: 'Box' }))[0]?.props.minHeight).toBeUndefined()
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
