import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register, Timer } from 'claude-code'

import type { QData, QFork, QForkKind, QItem, QPause } from '../types'
import type { ListRow, ListTone } from './list'
import {
  EMPTY,
  QUEUE_SECTION,
  UNQUEUEABLE,
  commandFooter,
  addItem,
  approveItem,
  controlText,
  editItem,
  forkPrompt,
  isQueueable,
  isSameCommand,
  itemPrompt,
  itemTag,
  judgeBash,
  judgeForkBash,
  judgeForkPath,
  mergeGoText,
  cursorForkOf,
  cursorId,
  cursorOf,
  moveCursor,
  focusTarget,
  keepsFocus,
  moveItem,
  nextQueued,
  nextReadyFork,
  parseCommand,
  parseControl,
  parseForkMarker,
  rebaseText,
  removeFork,
  removeItem,
  runNext,
  setFork,
  slugOf,
  visibleItems,
} from './logic'

type $ = EngineInterface

const PANE = 'q'
const NOTHING_QUEUED = 'Nothing queued. Type a task above, or /q <task> from the prompt.'
const NOTHING_QUEUED_FIELD = 'Nothing queued. Type a task, Enter to queue (or /q <task> from the prompt)'
const data = atom({ plugin: 'q', key: 'data' } as const, EMPTY)

// Variables a nested `claude` would otherwise inherit from this session.
const SCRUB = [
  'CLAUDE_CODE_SESSION_ID',
  'CLAUDE_CODE_MESSAGING_SOCKET',
  'CLAUDE_CODE_MESSAGING_TOKEN',
  'CLAUDECODE',
  'CLAUDE_CODE_CHILD_SESSION',
  'CLAUDE_CODE_SESSION_ATTENDED',
  'CLAUDE_PID',
  'CLAUDE_CODE_ENTRYPOINT',
]

// ── State ───────────────────────────────────────────────────────────────────

async function mutate($: $, change: (d: QData) => QData): Promise<QData> {
  let after = EMPTY
  await update($, data, d => (after = change({ ...EMPTY, ...d })))
  void persist($, after)

  return after
}

async function persist($: $, d: QData): Promise<void> {
  try {
    const savedAt = await $.clock.now().catch(() => 0)
    await $.store.set(`session:${await $.session.id()}`, { ...d, savedAt })
  } catch {
    // The queue still works for this session without a saved copy.
  }
}

async function restore($: $): Promise<void> {
  const current = await read($, data)
  if (current.seq > 0) return

  const sid = await $.session.id()
  const saved = (await $.store.get(`session:${sid}`)) as QData | undefined
  if (saved?.items) {
    await mutate($, () => ({
      ...EMPTY,
      ...saved,
      isBusy: false,
      runningTurnId: null,
      paused: saved.runningId
        ? { kind: 'restored', reason: 'Restored after a restart, mid-task. Press p to send that task again.' }
        : saved.paused,
    }))
  }

  // Keep the 30 most recently saved queues, this session's always among them.
  const own = `session:${sid}`
  const others = (await $.store.keys()).filter(k => k.startsWith('session:') && k !== own)
  const ages = await Promise.all(
    others.map(async key => ({ key, savedAt: ((await $.store.get(key)) as QData | undefined)?.savedAt ?? 0 })),
  )
  ages.sort((a, b) => a.savedAt - b.savedAt)
  for (const { key } of ages.slice(0, Math.max(0, ages.length - 29))) await $.store.delete(key)
}

// ── Git ─────────────────────────────────────────────────────────────────────

async function git($: $, args: string[], cwd?: string) {
  try {
    return await $.process.run(['git', ...args], { cwd, timeoutMs: 60_000 })
  } catch (err) {
    return { exitCode: -1, stdout: '', stderr: String(err) }
  }
}

async function repoRoot($: $, cwd?: string): Promise<string | null> {
  const r = await git($, ['rev-parse', '--show-toplevel'], cwd)

  return r.exitCode === 0 ? r.stdout.trim() : null
}

async function branchOf($: $, cwd: string): Promise<string> {
  const r = await git($, ['rev-parse', '--abbrev-ref', 'HEAD'], cwd)

  return r.exitCode === 0 ? r.stdout.trim() : 'HEAD'
}

/** Keeps fork worktrees out of the main checkout's `git status`, locally. */
async function excludeWorktrees($: $, root: string): Promise<void> {
  const r = await git($, ['rev-parse', '--path-format=absolute', '--git-common-dir'], root)
  if (r.exitCode !== 0) return

  const file = `${r.stdout.trim()}/info/exclude`
  let text = ''
  try {
    text = await $.fs.read(file)
  } catch {
    text = ''
  }
  if (!text.split('\n').includes('.claude/worktrees/')) {
    await $.fs.write(file, `${text.replace(/\n?$/, '\n')}.claude/worktrees/\n`)
  }
}

async function isDirty($: $, root: string): Promise<boolean> {
  const r = await git($, ['status', '--porcelain', '--untracked-files=no'], root)

  return r.exitCode === 0 && r.stdout.trim() !== ''
}

// ── Running the queue ───────────────────────────────────────────────────────

function isFree(d: QData): boolean {
  return !d.isBusy && !d.paused && !d.runningId && !d.mergeHolder
}

function later($: $, work: () => Promise<unknown>): void {
  $.clock.after(0, () => {
    work().catch(err => $.ui.log(`q: ${String(err)}`, { to: 'debug' }))
  })
}

/** Sends the next thing when the session is free: a waiting merge first, then the next task. */
async function pump($: $): Promise<void> {
  const d = await read($, data)
  if (!isFree(d)) return

  const ready = nextReadyFork(d)
  if (ready) return grantMerge($, ready.id)
  if (!nextQueued(d)) {
    // The queue ran dry: when it starts again, the checkout is checked again.
    if (d.isDirtyAcked) await mutate($, x => (nextQueued(x) ? x : { ...x, isDirtyAcked: false }))

    return
  }

  const root = await repoRoot($)
  if (root && !d.isDirtyAcked) {
    if (await isDirty($, root)) {
      await mutate($, x => ({
        ...x,
        paused: {
          kind: 'dirty',
          reason: 'Your checkout has uncommitted changes. Claude commits only its own files per task. Press p to start anyway.',
        },
      }))
      $.ui.toast('q: paused, the checkout has uncommitted changes (p in /q starts anyway)')

      return
    }
    await mutate($, x => ({ ...x, isDirtyAcked: true }))
  }

  let claimed: QItem | undefined
  let left = 0
  await mutate($, x => {
    claimed = undefined
    const item = nextQueued(x)
    if (!isFree(x) || !item) return x

    claimed = item
    left = x.items.filter(i => i.status === 'queued').length - 1

    return {
      ...x,
      isBusy: true,
      runningId: item.id,
      runningTurnId: null,
      turnRoot: item.rootId,
      items: x.items.map(i => (i.id === item.id ? { ...i, status: 'running' } : i)),
    }
  })
  const item = claimed as QItem | undefined
  if (!item) return

  const command = parseCommand(item.text)
  if (command) return runCommand($, item, command, commandFooter(item, left, root !== null))

  const text = itemPrompt(item, left, root !== null)
  const sent = item.source === 'you' ? $.prompt.submit({ text, asUser: true }) : $.prompt.submit({ text })
  sent.catch(err =>
    mutate($, x => ({
      ...x,
      isBusy: false,
      runningId: null,
      items: x.items.map(i => (i.id === item.id ? { ...i, status: 'queued' } : i)),
      paused: { kind: 'user', reason: `q could not send the task: ${String(err)}` },
    })),
  )
}

/** How long a skill's turn may take to start before the queue pauses and says so. */
const TURN_START_LIMIT_MS = 60_000

/** Where an agent's loop stands while it is still at work, its task notification yet to come. */
const LIVE_AGENT = new Set(['pending', 'running', 'waiting'])

async function agentsNow($: $) {
  return $.agent.list().catch(() => [])
}

async function isAgentLive($: $, agentId: string): Promise<boolean> {
  const agent = (await agentsNow($)).find(a => a.id === agentId)

  return agent !== undefined && LIVE_AGENT.has(agent.status)
}

/**
 * Runs a queued slash command as if typed. Whether it starts a turn is known up
 * front (`isQueueable`): a skill or prompt command finishes with its turn, as a
 * typed task does; a session or mod command (`/compact`, `/rpg`) is done once it
 * has run. A skill's prompt picking up the queue's instructions (`isWrapped`)
 * also means a turn is coming, for a bundled skill `QUEUED_BUILTINS` misses.
 *
 * A forked skill (`/code-review`) runs in a background agent and the command
 * returns at once: its turn is the one the agent's task notification starts,
 * however long the agent takes, so the backstop waits while the agent is live.
 */
async function runCommand($: $, item: QItem, command: { name: string; args: string }, footer: string): Promise<void> {
  await mutate($, x => ({ ...x, pendingCommand: { itemId: item.id, name: command.name, footer, isWrapped: false } }))

  const info = (await $.command.list()).find(c => c.name === command.name)
  const isSkill = info === undefined || isQueueable(info)
  const isWaiting = (x: QData) => x.runningId === item.id && x.runningTurnId === null
  const before = new Set((await agentsNow($)).map(a => a.id))

  const ran = await $.command.run({ command: command.name, args: command.args }).then(
    () => true,
    err =>
      mutate($, x => ({
        ...x,
        isBusy: false,
        runningId: null,
        pendingCommand: null,
        items: x.items.map(i => (i.id === item.id ? { ...i, status: 'queued' } : i)),
        paused: { kind: 'user', reason: `q could not run /${command.name}: ${String(err)}` },
      })).then(() => false),
  )
  if (!ran) return

  const forked = (await agentsNow($)).find(
    a => !before.has(a.id) && a.parentId === undefined && a.description.startsWith(`/${command.name}`),
  )
  if (forked) {
    await mutate($, x =>
      x.pendingCommand?.itemId === item.id ? { ...x, pendingCommand: { ...x.pendingCommand, agentId: forked.id } } : x,
    )
  }

  const { pendingCommand } = await read($, data)
  const expectsTurn = forked !== undefined || isSkill || (pendingCommand?.itemId === item.id && pendingCommand.isWrapped)
  if (!expectsTurn) {
    await mutate($, x => (isWaiting(x) ? { ...finishRunning(x), isBusy: false } : x))
    later($, () => pump($))

    return
  }

  // Backstop: a turn that never comes (the skill failed to load, or its background
  // agent ended with no turn picking up its result) pauses the queue rather than
  // holding it, or marking a task done that never ran.
  const arm = () => $.clock.after(TURN_START_LIMIT_MS, () => later($, check))
  const check = async () => {
    if (forked && (await isAgentLive($, forked.id))) return arm()

    await mutate($, x =>
      isWaiting(x)
        ? {
            ...x,
            isBusy: false,
            paused: {
              kind: 'question',
              reason: forked
                ? `/${command.name} ran in the background, but no turn picked up its result. Press p to mark it done and continue.`
                : `/${command.name} ran but never started a turn. Press p to mark it done and continue.`,
            },
          }
        : x,
    )
  }
  arm()
}

async function add($: $, text: string): Promise<QItem> {
  let item: QItem | undefined
  await mutate($, d => {
    const added = addItem(d, text, 'you')
    item = added.item

    return added.data
  })
  later($, () => pump($))

  return item as unknown as QItem
}

async function togglePause($: $): Promise<void> {
  await mutate($, d => {
    if (!d.paused) return { ...d, paused: { kind: 'user', reason: 'Paused by you.' } }

    const resumed: QData = { ...d, paused: null }
    const kind = d.paused.kind
    if ((kind === 'interrupted' || kind === 'restored') && d.runningId) {
      // The interrupted task goes back to the front of the queue.
      const running = d.items.find(i => i.id === d.runningId)
      const rest = d.items.filter(i => i.id !== d.runningId)

      return {
        ...resumed,
        runningId: null,
        runningTurnId: null,
        items: running ? [{ ...running, status: 'queued' }, ...rest] : rest,
      }
    }
    if (kind === 'question' && d.runningId) {
      return finishRunning(resumed)
    }
    if (kind === 'dirty') return { ...resumed, isDirtyAcked: true }

    return resumed
  })
  // A merge holding the queue is checked at once: p is the way out of one whose fork is gone.
  const { mergeHolder } = await read($, data)
  if (mergeHolder) later($, () => checkMerge($, mergeHolder))
  later($, () => pump($))
}

async function toggleDefault($: $): Promise<void> {
  const d = await mutate($, x => ({ ...x, isDefault: !x.isDefault }))
  $.ui.toast(
    d.isDefault
      ? 'q: default mode on, every prompt you type joins the queue (while the queue is paused, prompts go straight in)'
      : 'q: default mode off, prompts go straight in again',
  )
}

function finishRunning(d: QData): QData {
  return {
    ...d,
    runningId: null,
    runningTurnId: null,
    pendingCommand: null,
    items: d.items.map(i => (i.id === d.runningId ? { ...i, status: 'done' } : i)),
  }
}

// ── Forks ───────────────────────────────────────────────────────────────────

async function note($: $, text: string): Promise<void> {
  try {
    await $.session.append({ message: { type: 'user', content: [{ type: 'text', text }] } })
  } catch (err) {
    $.ui.log(`q: could not tell the session: ${String(err)}`, { to: 'debug' })
  }
}

async function failFork($: $, fork: QFork, why: string, requeue: boolean): Promise<void> {
  await mutate($, d => {
    const x = setFork(d, fork.id, { status: 'failed', note: why })

    return requeue
      ? { ...x, items: x.items.map(i => (i.id === fork.itemId ? { ...i, status: 'queued' } : i)) }
      : x
  })
  $.ui.toast(`q: fork failed: ${why}`)
}

async function startFork($: $, itemId: string, kind: QForkKind): Promise<void> {
  const root = await repoRoot($)
  if (!root) {
    $.ui.toast('q: forks need a git repository')

    return
  }

  const token = crypto.randomUUID()
  let fork: QFork | undefined
  let others: string[] = []
  await mutate($, d => {
    fork = undefined
    const item = d.items.find(i => i.id === itemId && (i.status === 'queued' || i.status === 'proposed'))
    if (!item) return d

    const id = `f${d.seq + 1}`
    fork = { id, itemId, text: item.text, kind, status: 'starting', token }
    others = [
      ...d.items.filter(i => i.id !== itemId && ['queued', 'running'].includes(i.status)).map(i => i.text),
      ...d.forks.filter(f => ['starting', 'working', 'ready', 'merging'].includes(f.status)).map(f => f.text),
    ]

    return {
      ...d,
      seq: d.seq + 1,
      forks: [...d.forks, fork],
      items: d.items.map(i => (i.id === itemId ? { ...i, status: 'forked' } : i)),
    }
  })
  const made = fork as QFork | undefined
  if (!made) return

  const slug = `${slugOf(made.text)}-${made.id}`
  const head = await git($, ['rev-parse', 'HEAD'], root)
  const base = head.exitCode === 0 ? head.stdout.trim() : undefined
  const parentSessionId = await $.session.id()
  const mainBranch = await branchOf($, root)
  await excludeWorktrees($, root)

  if (kind === 'agent') {
    const worktree = `${root}/.claude/worktrees/q-${slug}`
    const branch = `q/${slug}`
    const added = await git($, ['worktree', 'add', '-b', branch, worktree, 'HEAD'], root)
    if (added.exitCode !== 0) return failFork($, made, added.stderr.trim() || 'git worktree add failed', true)

    const withPlace = { ...made, branch, worktree }
    // A fork that never got going leaves no worktree or branch behind.
    const giveUp = async (why: string) => {
      await cleanUpFork($, withPlace, true)

      return failFork($, withPlace, why, true)
    }
    let spawned: Awaited<ReturnType<typeof $.agent.spawn>>
    try {
      spawned = await $.agent.spawn({
        subagentType: 'fork',
        description: `q: ${made.text.slice(0, 40)}`,
        cwd: worktree,
        prompt: forkPrompt({ fork: withPlace, parentSessionId, mainCheckout: root, mainBranch, worktree, others }),
      })
    } catch (err) {
      return giveUp(`the subagent did not start: ${String(err)}`)
    }
    if (spawned.deny !== undefined) return giveUp(spawned.deny)
    if (!spawned.agentId) return giveUp('the subagent did not start')

    await mutate($, d => setFork(d, made.id, { branch, worktree, base, agentId: spawned.agentId, status: 'working' }))
  } else {
    const prompt = forkPrompt({ fork: made, parentSessionId, mainCheckout: root, mainBranch, others })
    const argv = [
      'env',
      ...SCRUB.flatMap(name => ['-u', name]),
      'claude',
      '--bg',
      '--resume',
      parentSessionId,
      '--fork-session',
      '-w',
      `q-${slug}`,
      '--plugin-dir',
      $.plugin.root,
      '-n',
      `q: ${made.text.slice(0, 40)}`,
      prompt,
    ]
    const started = await $.process.run(argv, { cwd: root, timeoutMs: 120_000 })
    if (started.exitCode !== 0) {
      await cleanUpFork($, made, true)

      return failFork($, made, (started.stderr || started.stdout).trim().slice(0, 300) || 'claude --bg failed', true)
    }
    await mutate($, d => setFork(d, made.id, { base, status: 'working', note: started.stdout.trim().slice(0, 200) }))
  }

  $.ui.toast(`q: forked "${made.text.slice(0, 40)}" (${kind})`)
  await note(
    $,
    `q: the queued task "${made.text}" was handed to a parallel fork (${kind === 'agent' ? 'background subagent' : 'background session'}) in its own worktree. Do not work on it here; its changes will be merged into this checkout between tasks.`,
  )
}

async function grantMerge($: $, forkId: string): Promise<void> {
  let fork: QFork | undefined
  await mutate($, d => {
    fork = undefined
    const f = d.forks.find(x => x.id === forkId)
    if (!isFree(d) || !f || f.status !== 'ready') return d

    fork = { ...f, status: 'merging' }

    return { ...setFork(d, forkId, { status: 'merging' }), mergeHolder: forkId }
  })
  const granted = fork as QFork | undefined
  if (!granted) return

  const root = (await repoRoot($)) ?? (await $.session.cwd())
  const text = mergeGoText(granted, root, await branchOf($, root))
  const to = granted.agentId ? { agentId: granted.agentId } : granted.sessionId ? { sessionId: granted.sessionId } : null
  const sent = to ? await $.session.send({ to, text }) : { isDelivered: false as const, reason: 'the fork never reported its session id' }
  if (!sent.isDelivered) {
    await mutate($, d => ({
      ...setFork(d, forkId, { status: 'failed', note: `merge message not delivered: ${sent.reason}` }),
      mergeHolder: null,
    }))
    later($, () => pump($))

    return
  }
  watchMerge($, forkId)
  $.ui.toast(`q: merging "${granted.text.slice(0, 40)}"; the queue waits for it`)
}

/** How long a merge may go without its report before git and the fork are checked. */
const MERGE_CHECK_MS = 5 * 60_000
// The one merge being watched (the queue grants one at a time). Module state: session.start watches
// again after a reload.
let mergeWatch: Timer | null = null

function watchMerge($: $, forkId: string): void {
  mergeWatch?.cancel()
  mergeWatch = $.clock.after(MERGE_CHECK_MS, () => {
    checkMerge($, forkId).catch(err => $.ui.log(`q: ${String(err)}`, { to: 'debug' }))
  })
}

/**
 * The backstop for a merge whose report never comes (the fork crashed, was closed or ran out of
 * usage). Git says whether it merged; if not, a fork no longer at work gives the lock back and the
 * queue pauses. A fork still at work is checked again later.
 */
async function checkMerge($: $, forkId: string): Promise<void> {
  const d = await read($, data)
  const fork = d.forks.find(f => f.id === forkId)
  if (!fork || fork.status !== 'merging' || d.mergeHolder !== forkId) return

  const sha = await mergedSha($, fork)
  if (sha) return finishMerge($, forkId, true, sha)
  if (await isForkAtWork($, fork)) return watchMerge($, forkId)

  return finishMerge($, forkId, false, `the fork stopped without reporting the merge, and ${fork.branch ?? 'its branch'} is not in the main checkout`)
}

/** Whether a fork is still working: its subagent live, or its background session busy. */
async function isForkAtWork($: $, fork: QFork): Promise<boolean> {
  if (fork.kind === 'agent') return fork.agentId !== undefined && isAgentLive($, fork.agentId)
  const session = (await sessionsNow($)).find(x => x.sessionId === fork.sessionId)

  return session?.status === 'busy'
}

/** The Claude Code sessions running on this machine, as `claude agents --json` lists them. */
async function sessionsNow($: $): Promise<{ id?: unknown; sessionId?: unknown; status?: unknown }[]> {
  const listed = await $.process
    .run(['env', ...SCRUB.flatMap(name => ['-u', name]), 'claude', 'agents', '--json'], { timeoutMs: 30_000 })
    .catch(() => undefined)
  try {
    return listed?.exitCode === 0 ? JSON.parse(listed.stdout) : []
  } catch {
    return []
  }
}

/** The main checkout's commit when the fork's branch is merged into it, else null. */
async function mergedSha($: $, fork: QFork): Promise<string | null> {
  const root = await repoRoot($)
  // A branch with no commits of its own is always "in" HEAD: only a fork's own commits count, and
  // without its starting commit nothing can show they exist.
  if (!root || !fork.branch || !fork.base) return null

  const added = await git($, ['rev-list', '--count', `${fork.base}..${fork.branch}`], root)
  if (added.exitCode !== 0 || !(Number(added.stdout.trim()) > 0)) return null

  const isIn = await git($, ['merge-base', '--is-ancestor', fork.branch, 'HEAD'], root)
  if (isIn.exitCode !== 0) return null

  const head = await git($, ['rev-parse', '--short', 'HEAD'], root)

  return head.exitCode === 0 ? head.stdout.trim() : null
}

async function finishMerge($: $, forkId: string, ok: boolean, detail: string): Promise<void> {
  const before = await read($, data)
  const fork = before.forks.find(f => f.id === forkId)
  if (!fork || fork.status !== 'merging') return

  mergeWatch?.cancel()
  mergeWatch = null
  await mutate($, d => {
    const x = { ...setFork(d, forkId, { status: ok ? 'merged' : 'failed', note: detail }), mergeHolder: null }

    return ok ? x : { ...x, paused: { kind: 'merge', reason: `Merging "${fork.text}" failed: ${detail}` } as QPause }
  })

  if (ok) {
    const root = (await repoRoot($)) ?? (await $.session.cwd())
    const mainBranch = await branchOf($, root)
    await note(
      $,
      `q: the fork for "${fork.text}" merged ${fork.branch ?? 'its branch'} into ${mainBranch} (${detail}). Files in this checkout may have changed; re-read before editing them.`,
    )
    const d = await read($, data)
    for (const other of d.forks.filter(f => f.status === 'working')) {
      const to = other.agentId ? { agentId: other.agentId } : other.sessionId ? { sessionId: other.sessionId } : null
      if (to) await $.session.send({ to, text: rebaseText(other, mainBranch, detail) })
    }
  }
  $.ui.toast(ok ? `q: merged "${fork.text.slice(0, 40)}"` : `q: merge failed, queue paused`)
  later($, () => pump($))
}

/** Sends a control message from a fork session to the session that made it. */
async function tellParent($: $, kind: string, extra: Record<string, unknown>, words: string): Promise<string> {
  const { role } = await read($, data)
  if (!role) return 'This session is not a queue fork.'

  const sent = await $.session.send({
    to: { sessionId: role.parentSessionId },
    text: controlText({ kind, id: role.forkId, token: role.token, ...extra }, words),
  })

  return sent.isDelivered ? 'Sent to the main session.' : `Not delivered: ${sent.reason}`
}

function forkOfAgent(d: QData, agentId: string | undefined): QFork | undefined {
  return agentId === undefined ? undefined : d.forks.find(f => f.agentId === agentId)
}

/** The fork an agent's loop works for: the fork's own subagent, or one it started, at any depth. */
async function forkOfLoop($: $, d: QData, agentId: string | undefined): Promise<QFork | undefined> {
  const direct = forkOfAgent(d, agentId)
  if (direct || agentId === undefined || !d.forks.some(f => f.agentId)) return direct

  const agents = await agentsNow($)
  let id: string | undefined = agentId
  for (let hops = 0; id !== undefined && hops < 10; hops++) {
    id = agents.find(a => a.id === id)?.parentId
    const fork = forkOfAgent(d, id)
    if (fork) return fork
  }

  return undefined
}

/** Where a fork may write, for the loop making a call: a fork session's role, or an agent fork's place. */
async function forkPlace($: $, d: QData, agentId: string | undefined) {
  const agentFork = await forkOfLoop($, d, agentId)
  if (agentFork) return { worktree: agentFork.worktree, mainCheckout: (await repoRoot($)) ?? '', canMerge: agentFork.status === 'merging' }

  return d.role
}

// ── Managing forks ──────────────────────────────────────────────────────────

const RUNNING_FORK: QFork['status'][] = ['starting', 'working', 'ready']

/** Stops a fork that may still be working. Says what could not be done, if anything. */
async function stopFork($: $, fork: QFork): Promise<string | undefined> {
  if (!RUNNING_FORK.includes(fork.status)) return undefined

  if (fork.kind === 'agent') {
    if (!fork.agentId) return undefined
    try {
      await $.tool.call({ tool: 'TaskStop', task_id: fork.agentId })
    } catch {
      // Already ended: nothing to stop.
    }

    return undefined
  }

  // A session fork: find its background session by the id it reported.
  if (!fork.sessionId) return 'its session never reported in, so it may still be running'
  const session = (await sessionsNow($)).find(x => x.sessionId === fork.sessionId)
  if (!session) return undefined
  const stopped = await $.process
    .run(['env', ...SCRUB.flatMap(name => ['-u', name]), 'claude', 'stop', String(session.id)], { timeoutMs: 30_000 })
    .catch(err => ({ exitCode: -1, stdout: '', stderr: String(err) }))

  return stopped.exitCode === 0 ? undefined : `claude stop failed: ${stopped.stderr.trim().slice(0, 120)}`
}

/**
 * Removes a fork's worktree and branch. `force` deletes both whatever they
 * hold; without it, git keeps a worktree with changes in it and a branch that
 * is not merged. Says what was left.
 */
async function cleanUpFork($: $, fork: QFork, force: boolean): Promise<string[]> {
  const root = await repoRoot($)
  if (!root) return ['not in a git repository']

  // A session fork that never reported in: find its worktree by the name it was given.
  let { worktree, branch } = fork
  if (!worktree || !branch) {
    const list = await git($, ['worktree', 'list', '--porcelain'], root)
    const name = `/.claude/worktrees/q-${slugOf(fork.text)}-${fork.id}`
    const entry = list.stdout.split('\n\n').find(block => block.split('\n')[0]?.endsWith(name))
    worktree ??= entry?.split('\n')[0]?.replace(/^worktree /, '')
    branch ??= entry
      ?.split('\n')
      .find(line => line.startsWith('branch '))
      ?.replace(/^branch refs\/heads\//, '')
  }

  const left: string[] = []
  if (worktree) {
    const removed = await git($, ['worktree', 'remove', ...(force ? ['--force'] : []), worktree], root)
    if (removed.exitCode !== 0 && !/is not a working tree/.test(removed.stderr)) left.push(`worktree ${worktree}`)
  }
  await git($, ['worktree', 'prune'], root)
  if (branch) {
    const deleted = await git($, ['branch', force ? '-D' : '-d', branch], root)
    if (deleted.exitCode !== 0 && !/not found/.test(deleted.stderr)) left.push(`branch ${branch}`)
  }

  return left
}

/** Delete (`drop`) or send back a fork: stop it, remove its worktree and branch, take it off the list. */
async function retireFork($: $, forkId: string, outcome: 'drop' | 'send-back'): Promise<void> {
  // Checked and marked in one step, before anything slow: a retiring fork can no longer be granted
  // the merge lock (only a ready one can), so it can't start merging while it is being taken apart.
  let fork: QFork | undefined
  let refusal: string | undefined
  await mutate($, d => {
    fork = undefined
    refusal = undefined
    const f = d.forks.find(x => x.id === forkId)
    if (!f || f.status === 'retiring') return d
    if (f.status === 'merging' || d.mergeHolder === forkId) {
      refusal = 'q: that fork is merging into your checkout; stopping it now could leave a half-done merge. Wait for it.'

      return d
    }
    if (outcome === 'send-back' && f.status === 'merged') {
      refusal = 'q: that fork is already merged; nothing to send back'

      return d
    }
    fork = f

    return setFork(d, forkId, { status: 'retiring' })
  })
  if (refusal) {
    $.ui.toast(refusal)

    return
  }
  const was = fork as QFork | undefined
  if (!was) return

  const problem = await stopFork($, was)
  const left = await cleanUpFork($, was, true)
  await mutate($, x => removeFork(x, forkId, outcome))
  if (outcome === 'send-back') later($, () => pump($))

  const done = outcome === 'drop' ? 'deleted' : 'sent back to the queue'
  const leftover = [problem, left.length ? `left behind: ${left.join(', ')}` : undefined].filter(Boolean).join('; ')
  $.ui.toast(`q: fork "${was.text.slice(0, 40)}" ${done}${leftover ? ` (${leftover})` : ''}`)
}

/** Clears done tasks and merged forks, removing each merged fork's worktree and branch. */
async function clearFinished($: $): Promise<void> {
  const merged = (await read($, data)).forks.filter(f => f.status === 'merged')
  const left: string[] = []
  for (const fork of merged) left.push(...(await cleanUpFork($, fork, false)))

  await mutate($, x => {
    let next: QData = { ...x, items: x.items.filter(i => i.status !== 'done') }
    for (const fork of merged) next = removeFork(next, fork.id, 'drop')

    return next
  })
  if (merged.length) {
    $.ui.toast(`q: cleared ${merged.length} merged fork${merged.length === 1 ? '' : 's'}${left.length ? ` (left behind: ${left.join(', ')})` : ''}`)
  }
}

// ── Pane actions ────────────────────────────────────────────────────────────

/** What a key or a button in the pane asks for; task actions apply to the task under the cursor. */
async function handleAction($: $, action: string): Promise<void> {
  const onCursor = (fn: (x: QData, id: string) => QData) =>
    mutate($, x => {
      const at = cursorOf(x)

      return at ? fn({ ...x, selectedId: at.id }, at.id) : x
    })
  const forkCursor = async (kind: QForkKind) => {
    const at = cursorOf(await read($, data))
    if (at) await startFork($, at.id, kind)
  }

  switch (action) {
    case 'cursor-up':
      await mutate($, x => moveCursor(x, -1))
      break
    case 'cursor-down':
      await mutate($, x => moveCursor(x, 1))
      break
    case 'move-up':
      await onCursor((x, id) => moveItem(x, id, -1))
      break
    case 'move-down':
      await onCursor((x, id) => moveItem(x, id, 1))
      break
    case 'edit':
      await onCursor((x, id) => ({ ...x, editingId: id }))
      break
    case 'delete': {
      const fork = cursorForkOf(await read($, data))
      if (fork) await retireFork($, fork.id, 'drop')
      else await onCursor(removeItem)
      break
    }
    case 'send-back': {
      const fork = cursorForkOf(await read($, data))
      if (fork) await retireFork($, fork.id, 'send-back')
      break
    }
    case 'run-next':
      await onCursor(runNext)
      break
    case 'approve':
      await onCursor(approveItem)
      later($, () => pump($))
      break
    case 'fork-session':
      await forkCursor('session')
      break
    case 'fork-agent':
      await forkCursor('agent')
      break
    case 'pause':
      await togglePause($)
      break
    case 'default':
      await toggleDefault($)
      break
    case 'clear-done':
      await clearFinished($)
      break
  }
}

// ── Hooks ───────────────────────────────────────────────────────────────────

export const register: Register = on => {
  // Where the pane's focus ring is. While the task list is drawn it keeps the keys:
  // a click on a button, on blank space or a field redrawn away would otherwise
  // leave them nowhere. Only the drawing uses these; a reload starting them over
  // costs nothing.
  let isPaneFocused = false
  let isListDrawn = false
  let ringAt: string | undefined
  let isRefocusQueued = false


  on('session.start', async ($, e, next) => {
    const started = await next(e)
    await restore($)
    // A merge granted before a reload is watched again: the timer did not survive it.
    const { mergeHolder } = await read($, data)
    if (mergeHolder) watchMerge($, mergeHolder)

    await $.command.register({
      name: 'q',
      description: 'Task queue: /q opens or closes the pane, /q <task> adds a task, /q default makes typed prompts queue',
      argumentHint: '[task | default]',
      immediate: true,
    })
    await $.tool.register({
      name: 'queue_add',
      description: QUEUE_SECTION,
      inputSchema: {
        type: 'object',
        properties: { text: { type: 'string', description: 'The task, written as a prompt you would want to receive.' } },
        required: ['text'],
      },
      isDeferred: false,
    })
    await $.tool.register({
      name: 'queue_list',
      description: "List the user's task queue: what is running, waiting, proposed, forked and done.",
      isDeferred: false,
    })
    await $.tool.register({
      name: 'queue_pause',
      description:
        'Pause the task queue because you need the user\'s answer before the current task is finished. Call it, ask your question, then end your turn.',
      inputSchema: {
        type: 'object',
        properties: { question: { type: 'string' } },
        required: ['question'],
      },
      isDeferred: false,
    })
    await $.tool.register({
      name: 'fork_ready',
      description: 'Only for a queue fork: report that your task is done and committed on your branch, and wait for the merge lock.',
      inputSchema: { type: 'object', properties: { summary: { type: 'string' } }, required: ['summary'] },
      isDeferred: false,
    })
    await $.tool.register({
      name: 'fork_merged',
      description: 'Only for a queue fork holding the merge lock: report the merge into the main checkout, or that it could not be done.',
      inputSchema: {
        type: 'object',
        properties: {
          ok: { type: 'boolean' },
          sha: { type: 'string', description: 'The merge commit, when ok' },
          reason: { type: 'string', description: 'Why not, when not ok' },
        },
        required: ['ok'],
      },
      isDeferred: false,
    })

    return started
  })

  on('prompt.compose', async ($, e, next) => {
    const composed = await next(e)

    return { sections: [...composed.sections, { id: 'q:queue', text: QUEUE_SECTION, scope: 'session' }] }
  })

  // ── /q ──
  on('command.run', { command: 'q' }, async ($, e) => {
    const text = e.args.trim()
    if (text === '') {
      if ((await $.ui.panes()).some(pane => pane.id === PANE)) {
        await $.ui.close({ id: PANE })

        return {}
      }

      const opened = await $.ui.open({ id: PANE, title: 'Queue', focus: true })
      if (!opened.isPlaced) $.ui.toast(`q: the pane could not open (${opened.reason})`)
      else await $.ui.focus({ requestId: PANE, key: 'list' }).catch(() => undefined)

      return {}
    }

    if (text === 'default') {
      await toggleDefault($)

      return {}
    }

    const command = parseCommand(text)
    if (command && UNQUEUEABLE.has(command.name)) {
      $.ui.toast(`q: /${command.name} can't be queued: it would wipe the conversation every later task relies on`)

      return {}
    }

    const item = await add($, text)
    const d = await read($, data)
    const waiting = d.items.filter(i => i.status === 'queued').length
    $.ui.toast(d.runningId === item.id ? `q: sending #${item.id.slice(1)}` : `q: queued #${item.id.slice(1)} (${waiting} waiting)`)

    return {}
  })

  // In default mode a typed prompt joins the queue instead of going straight in.
  // A paused queue lets prompts through: you are steering (answering Claude's
  // question, redirecting after Esc). Images can't ride the queue, so they pass too.
  on('prompt.submit', async ($, e, next) => {
    if (e.isMeta || e.origin.kind !== 'composer' || e.attachments?.length) return next(e)

    const d = await read($, data)
    const text = e.command ? `/${e.command.name} ${e.command.args}`.trim() : e.text.trim()
    if (!d.isDefault || d.paused || text === '') return next(e)

    if (e.command) {
      // Built-ins and session toggles act at once; skills and prompt commands wait their turn.
      const { name } = e.command
      const info = (await $.command.list()).find(c => c.name === name)
      if (!info || !isQueueable(info)) return next(e)
    }

    const item = await add($, text)

    return { drop: `q: queued #${item.id.slice(1)} (default mode; /q default turns it off)` }
  }).catch(($, e, next) => next(e))

  // Where skill.prompt is passed over (an organization's managed setup), a queued
  // skill still gets the queue's instructions, as a note read after its output.
  on('command.run', async ($, e, next) => {
    const result = await next(e)
    const { pendingCommand } = await read($, data)
    if (e.origin.kind !== 'plugin' || !pendingCommand || pendingCommand.isWrapped) return result
    if (!isSameCommand(e.command, pendingCommand.name)) return result

    const info = (await $.command.list()).find(c => c.name === e.command)
    if (!info || info.source === 'builtin') return result

    await mutate($, x => (x.pendingCommand ? { ...x, pendingCommand: { ...x.pendingCommand, isWrapped: true } } : x))

    return { ...result, context: [...(result.context ?? []), pendingCommand.footer] }
  }).catch(($, e, next) => next(e))

  on('skill.prompt', async ($, e, next) => {
    const result = await next(e)
    const { pendingCommand } = await read($, data)
    if (!pendingCommand || pendingCommand.isWrapped || !isSameCommand(e.skill, pendingCommand.name)) return result

    await mutate($, x => (x.pendingCommand ? { ...x, pendingCommand: { ...x.pendingCommand, isWrapped: true } } : x))

    return { text: `${result.text}\n\n${pendingCommand.footer}` }
  })

  // ── Turns ──
  on('turn.start', async ($, e, next) => {
    if (e.agentId === undefined) {
      const marker = parseForkMarker(e.text)
      // While a forked skill's agent works, a turn of the person's is not the command's.
      const forkedId = (await read($, data)).pendingCommand?.agentId
      const isForkWorking =
        forkedId !== undefined && !e.text.includes(`<task-id>${forkedId}</task-id>`) && (await isAgentLive($, forkedId))
      await mutate($, d => {
        const running = d.items.find(i => i.id === d.runningId)
        const isOurs =
          running !== undefined &&
          (e.text.includes(itemTag(running)) ||
            (d.pendingCommand?.itemId === running.id && d.runningTurnId === null && !isForkWorking))

        return {
          ...d,
          isBusy: true,
          runningTurnId: isOurs ? e.turnId : d.runningTurnId,
          turnRoot: isOurs ? running.rootId : `t:${e.turnId}`,
        }
      })

      const { role } = await read($, data)
      if (marker && !role) {
        // This session is a fork that another session's queue started.
        later($, async () => {
          const worktree = (await repoRoot($)) ?? (await $.session.cwd())
          await mutate($, d => ({
            ...d,
            role: {
              forkId: marker.id,
              token: marker.token,
              parentSessionId: marker.parent,
              mainCheckout: marker.main,
              worktree,
              canMerge: false,
            },
          }))
          await tellParent(
            $,
            'hello',
            { sessionId: await $.session.id(), worktree, branch: await branchOf($, worktree) },
            'q: fork started.',
          )
        })
      }
    }

    return next(e)
  })

  on('turn.complete', async ($, e, next) => {
    const result = await next(e)

    if (e.agentId === undefined) {
      await mutate($, d => {
        const x: QData = { ...d, isBusy: false }
        const isItsTurn = d.runningId !== null && d.runningTurnId === e.turnId
        const why = e.reason === 'aborted' ? 'You interrupted the turn.' : `The turn ended with ${e.reason}.`

        if (isItsTurn) {
          if (e.reason !== 'answer') return { ...x, paused: { kind: 'interrupted', reason: `${why} Press p to send the task again.` } }

          return d.paused ? x : finishRunning(x)
        }
        if (e.reason !== 'answer' && nextQueued(d) && !d.paused) {
          return { ...x, paused: { kind: 'interrupted', reason: `${why} Press p to continue the queue.` } }
        }

        return x
      })
    } else {
      const d = await read($, data)
      const fork = forkOfAgent(d, e.agentId)
      if (fork?.status === 'working') {
        const now = await $.clock.now()
        await mutate($, x =>
          e.reason === 'answer'
            ? setFork(x, fork.id, { status: 'ready', readyAt: now })
            : setFork(x, fork.id, { status: 'failed', note: `ended with ${e.reason}` }),
        )
      } else if (fork?.status === 'merging') {
        // The fork's own report can go missing (a call into a copy of the mod a
        // reload replaced): git says whether the merge happened.
        const merged = await mergedSha($, fork)
        await finishMerge(
          $,
          fork.id,
          merged !== null,
          merged ?? `the fork stopped (${e.reason}) without reporting the merge, and ${fork.branch ?? 'its branch'} is not in the main checkout`,
        )
      }
    }

    later($, () => pump($))

    return result
  })

  // ── Messages between a fork session and its parent ──
  on('session.receive', async ($, e, next) => {
    const control = parseControl(e.text)
    if (!control) return next(e)

    const d = await read($, data)

    // In a fork: the parent's messages go on to the model; the merge grant opens the main checkout.
    if (d.role && control.id === d.role.forkId && control.token === d.role.token) {
      if (control.kind === 'merge-go') {
        await mutate($, x => (x.role ? { ...x, role: { ...x.role, canMerge: true } } : x))
      }

      return next(e)
    }

    // In the parent: a fork session's report.
    const fork = d.forks.find(f => f.id === control.id && f.token === control.token)
    if (!fork) return next(e)

    if (control.kind === 'hello') {
      await mutate($, x =>
        setFork(x, fork.id, {
          sessionId: String(control.sessionId),
          worktree: String(control.worktree),
          branch: String(control.branch),
          status: fork.status === 'starting' ? 'working' : fork.status,
        }),
      )
    } else if (control.kind === 'ready') {
      // Only a fork still at work becomes ready: one being retired stays out of the merge queue.
      const now = await $.clock.now()
      await mutate($, x =>
        ['starting', 'working'].includes(x.forks.find(f => f.id === fork.id)?.status ?? '')
          ? setFork(x, fork.id, { status: 'ready', readyAt: now, note: String(control.summary ?? '') })
          : x,
      )
      later($, () => pump($))
    } else if (control.kind === 'merged') {
      later($, () => finishMerge($, fork.id, control.ok === true, String(control.ok === true ? control.sha : control.reason)))
    }

    return { consumed: `q: ${control.kind} from fork ${fork.id}` }
  })

  // ── Claude's tools ──
  on('tool.call', { tool: 'mcp__q__queue_add' }, async ($, e) => {
    const text = String((e as unknown as { text?: unknown }).text ?? '').trim()
    if (!text) return { result: 'Nothing queued: the text was empty.' }

    let item: QItem | undefined
    await mutate($, d => {
      const added = addItem(d, text, 'claude')
      item = added.item

      return added.data
    })
    const made = item as unknown as QItem
    later($, () => pump($))

    return {
      result:
        made.status === 'proposed'
          ? `Proposed as #${made.id.slice(1)}. You have reached the limit for this task, so it waits for the user's approval.`
          : `Queued as #${made.id.slice(1)}. It runs after the tasks before it.`,
    }
  })

  on('tool.call', { tool: 'mcp__q__queue_list' }, async $ => {
    const d = await read($, data)
    const lines = d.items.map(i => `#${i.id.slice(1)} [${i.status}] (${i.source}) ${i.text}`)
    const forks = d.forks.map(f => `fork ${f.id} [${f.status}] (${f.kind}) ${f.text}${f.branch ? ` on ${f.branch}` : ''}`)
    const state = d.paused ? `paused: ${d.paused.reason}` : d.runningId ? `running #${d.runningId.slice(1)}` : 'idle'

    return { result: [`Queue ${state}.`, ...lines, ...forks].join('\n') || 'The queue is empty.' }
  })

  on('tool.call', { tool: 'mcp__q__queue_pause' }, async ($, e) => {
    const question = String((e as unknown as { question?: unknown }).question ?? '')
    await mutate($, d => ({ ...d, paused: { kind: 'question', reason: `Claude asked: ${question}` } }))
    $.ui.toast('q: paused, Claude has a question')

    return { result: 'The queue is paused. Ask your question and end your turn; the user resumes the queue.' }
  })

  on('tool.call', { tool: 'mcp__q__fork_ready' }, async ($, e) => {
    const summary = String((e as unknown as { summary?: unknown }).summary ?? '')
    const d = await read($, data)
    const fork = forkOfAgent(d, e.agentId)
    if (fork) {
      const now = await $.clock.now()
      await mutate($, x =>
        ['starting', 'working'].includes(x.forks.find(f => f.id === fork.id)?.status ?? '')
          ? setFork(x, fork.id, { status: 'ready', readyAt: now, note: summary })
          : x,
      )

      return { result: 'Reported ready. End your turn now; you will get a message when you may merge.' }
    }

    return { result: `${await tellParent($, 'ready', { summary }, `q: fork ready: ${summary}`)} End your turn now and wait for the merge message.` }
  })

  on('tool.call', { tool: 'mcp__q__fork_merged' }, async ($, e) => {
    const input = e as unknown as { ok?: unknown; sha?: unknown; reason?: unknown }
    const ok = input.ok === true
    const d = await read($, data)
    const fork = forkOfAgent(d, e.agentId)
    if (fork) {
      await finishMerge($, fork.id, ok, String(ok ? input.sha : input.reason))

      return { result: 'Reported. Your work here is finished.' }
    }

    const sent = await tellParent($, 'merged', { ok, sha: input.sha, reason: input.reason }, 'q: merge reported.')
    await mutate($, x => (x.role ? { ...x, role: { ...x.role, canMerge: false } } : x))

    return { result: `${sent} Your work here is finished.` }
  })

  // ── Guards ──
  on('tool.call', { tool: 'Bash' }, async ($, e, next) => {
    const d = await read($, data)
    // A fork's subagents count as the fork: their calls carry their own agentId.
    const place = await forkPlace($, d, e.agentId)
    const isFork = place !== null
    const isActive =
      !d.paused && (d.runningId !== null || d.forks.some(f => ['starting', 'working', 'ready', 'merging'].includes(f.status)))
    const running = d.items.find(i => i.id === d.runningId)
    const where = isFork ? 'fork' : running?.source === 'claude' ? 'claude-task' : 'main'
    const deny =
      (isFork || isActive ? judgeBash(e.command, where) : undefined) ??
      (place?.mainCheckout ? judgeForkBash(e.command, place) : undefined)

    return deny ? { deny } : next(e)
  }).catch(($, e, next) => (next.called ? next(e) : { deny: 'q: its guard failed; pause the queue (p in /q) to run this.' }))

  on('tool.call', async ($, e, next) => {
    if (e.tool !== 'Edit' && e.tool !== 'Write' && e.tool !== 'NotebookEdit') return next(e)

    const d = await read($, data)
    const fork = await forkPlace($, d, e.agentId)
    if (!fork || !fork.mainCheckout) return next(e)

    const path = e.tool === 'NotebookEdit' ? e.notebook_path : e.file_path
    const deny = judgeForkPath(path, fork)

    return deny ? { deny } : next(e)
  }).catch(($, e, next) => (next.called ? next(e) : { deny: 'q: its guard failed.' }))

  // ── The pane ──
  on('ui.focus', { component: 'Pane', requestId: PANE }, async ($, e, next) => {
    const element = e.element
    if (isListDrawn && element !== undefined && !keepsFocus(element)) {
      // A click on a button: it is still pressed, but the keys stay with the list.
      ringAt = 'list'

      return next({ ...e, element: 'list' })
    }
    ringAt = element
    if (element?.startsWith('item:')) {
      await mutate($, d => ({ ...d, selectedId: element.slice(5) }))
    }

    return next(e)
  })

  on('ui.message', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const action = (e.data as { action?: unknown } | null)?.action
    if (typeof action === 'string') await handleAction($, action)

    return {}
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const table = $.ui.resolve(e)
    const { Box, Text, Button } = table
    const Input = 'Input' in table ? table.Input : undefined
    const d = await read($, data)
    const width = Math.max(30, e.props.bodyColumns ?? 80)


    const cursorAt = cursorId(d)
    const editing = d.items.find(i => i.id === d.editingId)
    // Where the surface draws a Client, the list hears keys itself (K/J included);
    // elsewhere the buttons carry the hotkeys, with w/s for moving.
    const Client = 'Client' in table ? table.Client : undefined

    const visible = visibleItems(d)

    // The list is drawn only with rows: an empty one holding the keys would act on
    // what is typed (p pauses, m toggles default mode). With nothing to list, the
    // add-task field takes its place (stretched when docked) and the buttons carry
    // their own hotkeys, as on surfaces without a Client.
    const hasList = Client !== undefined && (visible.length > 0 || d.forks.length > 0)
    const inputKey = editing ? `edit:${editing.id}` : `new:${d.seq}`
    isListDrawn = hasList
    if (!e.props.isFocused) ringAt = undefined
    const justFocused = e.props.isFocused && !isPaneFocused
    isPaneFocused = e.props.isFocused
    const target = () => focusTarget({ ringAt, inputKey, hasList, justFocused })
    if (e.props.isFocused && !isRefocusQueued && target()) {
      isRefocusQueued = true
      $.clock.after(50, () => {
        isRefocusQueued = false
        const to = target()
        if (to) void $.ui.focus({ requestId: PANE, key: to }).catch(() => undefined)
      })
    }
    const forkTone: Record<string, ListTone> = { failed: 'red', ready: 'green', merging: 'yellow' }
    const forkRow = (f: QFork): ListRow => ({
      id: f.id,
      isHeading: false,
      head: '⑂',
      who: f.kind === 'agent' ? 'agent  ' : 'session',
      isClaude: false,
      text: `${clip(f.text, Math.max(10, width - 52))}  ${f.branch ?? ''}`,
      note: f.status === 'failed' && f.note ? `failed: ${clip(f.note, 50)}` : f.status,
      tone: forkTone[f.status] ?? '',
      isCursor: f.id === cursorAt,
      isDone: f.status === 'merged',
    })
    const waiting = d.items.filter(i => i.status === 'queued').length
    const state = d.paused
      ? `paused: ${d.paused.reason}`
      : d.mergeHolder
        ? 'merging a fork'
        : d.runningId
          ? `running #${d.runningId.slice(1)}`
          : d.isBusy
            ? 'Claude is busy'
            : 'idle'
    const clip = (s: string, room: number) => (s.length > room ? `${s.slice(0, Math.max(1, room - 1))}…` : s)
    const mark: Record<string, string> = { running: '▶', queued: '·', proposed: '?', done: '✓' }

    // Docked, the list (or, with nothing to list, the add-task field) stretches over the
    // pane's spare rows, so a click on blank space lands on it and gives it the keys;
    // blank space outside any element takes no focus. Inline the frame fits the tree,
    // so stretching would hold it at its tallest.
    const isDocked = e.props.placement === 'dock' && e.props.scroll.bodyRows > 0
    const minHeight = isDocked ? e.props.scroll.bodyRows : undefined
    // The header and the (wrapping) button row take about four of those rows.
    const fieldRows = isDocked && !hasList && !editing ? Math.max(1, e.props.scroll.bodyRows - 4) : undefined

    return (
      <Box flexDirection="column" minHeight={minHeight}>
        <Text>
          <Text bold>Queue</Text>
          <Text dimColor> · {waiting} waiting · </Text>
          {d.isDefault && <Text color="cyan">default · </Text>}
          <Text color={d.paused ? 'yellow' : undefined}>{clip(state, width - 24)}</Text>
        </Text>
        {Input &&
          (editing ? (
            <Input
              key={`edit:${editing.id}`}
              label={`edit #${editing.id.slice(1)} `}
              value={editing.text}
              submitLabel="save"
              autoFocus
              onSubmit={value => {
                const text = value.trim()
                void mutate($, x => (text ? editItem(x, editing.id, text) : { ...x, editingId: null }))
              }}
            />
          ) : (
            <Input
              key={`new:${d.seq}`}
              placeholder={visible.length === 0 ? NOTHING_QUEUED_FIELD : 'add a task, Enter to queue'}
              rows={fieldRows}
              submitLabel="queue"
              onSubmit={value => {
                const text = value.trim()
                if (text) void add($, text)
              }}
            />
          ))}
        {!Input && visible.length === 0 && <Text dimColor>{NOTHING_QUEUED}</Text>}
        {Client ? (
          hasList && (
          <Client
            key="list"
            module="./list.tsx"
            flexGrow={1}
            width="100%"
            props={{
              empty: visible.length === 0 ? NOTHING_QUEUED : '',
              rows: [
                ...visible.map(
                  (i): ListRow => ({
                    id: i.id,
                    isHeading: false,
                    head: `${mark[i.status] ?? ' '} #${i.id.slice(1)}`,
                    who: i.source === 'claude' ? 'claude' : 'you   ',
                    isClaude: i.source === 'claude',
                    text: clip(i.text, width - 22).padEnd(Math.max(0, width - 22)),
                    note: i.status === 'proposed' ? 'needs approval (y)' : '',
                    tone: 'yellow',
                    isCursor: i.id === cursorAt,
                    isDone: i.status === 'done',
                  }),
                ),
                ...(d.forks.length > 0
                  ? [
                      { ...forkRow(d.forks[0] as QFork), id: 'heading:forks', isHeading: true, text: 'Forks', isCursor: false },
                      ...d.forks.map(forkRow),
                    ]
                  : []),
              ],
            }}
          />
          )
        ) : (
          visible.map(i => (
            <Button
              key={`item:${i.id}`}
              plain
              dimColor={i.status === 'done' && i.id !== cursorAt}
              onPress={() => mutate($, x => ({ ...x, selectedId: i.id }))}
            >
              <Text inverse={i.id === cursorAt}>
                {i.id === cursorAt ? '› ' : '  '}
                {mark[i.status] ?? ' '} #{i.id.slice(1)}{' '}
                <Text color={i.source === 'claude' ? 'cyan' : undefined}>{i.source === 'claude' ? 'claude' : 'you   '}</Text>{' '}
                {clip(i.text, width - 22).padEnd(Math.max(0, width - 22))}
                {i.status === 'proposed' ? <Text color="yellow"> needs approval (y)</Text> : ''}
              </Text>
            </Button>
          ))
        )}
        {!Client && d.forks.length > 0 && <Text bold>Forks</Text>}
        {!Client &&
          d.forks.map(f => {
            const row = forkRow(f)

            return (
              <Button key={`item:${f.id}`} plain dimColor={row.isDone && !row.isCursor} onPress={() => mutate($, x => ({ ...x, selectedId: f.id }))}>
                <Text inverse={row.isCursor}>
                  {row.isCursor ? '› ' : '  '}⑂ {row.who} {row.text} <Text color={row.tone || undefined}>{row.note}</Text>
                </Text>
              </Button>
            )
          })}
        <Box flexDirection="row" flexWrap="wrap" columnGap={2}>
          {[
            { action: 'edit', key: 'e', label: 'edit' },
            { action: 'delete', key: 'd', label: 'delete' },
            { action: 'cursor-up', key: 'k', label: 'cursor up' },
            { action: 'cursor-down', key: 'j', label: 'cursor down' },
            { action: 'move-up', key: hasList ? 'K' : 'w', label: 'move up' },
            { action: 'move-down', key: hasList ? 'J' : 's', label: 'move down' },
            { action: 'run-next', key: 'r', label: 'run next' },
            { action: 'approve', key: 'y', label: 'approve' },
            { action: 'fork-session', key: 'f', label: 'fork session' },
            { action: 'fork-agent', key: 'a', label: 'fork agent' },
            { action: 'pause', key: 'p', label: d.paused ? 'resume' : 'pause' },
            { action: 'default', key: 'm', label: d.isDefault ? 'default off' : 'default on' },
            { action: 'send-back', key: 'b', label: 'send back' },
            { action: 'clear-done', key: 'c', label: 'clear finished' },
          ].map(b =>
            hasList ? (
              // The list takes the keys; these stay for the mouse. The key takes the colour
              // Claude Code gives a plain Button's hotkey (`suggestion`), so the row looks
              // the same whether the list or the buttons hold the keys.
              <Button key={b.action} plain onPress={() => handleAction($, b.action)}>
                <Text bold color="suggestion">
                  {b.key}
                </Text>{' '}
                {b.label}
              </Button>
            ) : (
              <Button key={b.action} plain hotkey={b.key} label={b.label} onPress={() => handleAction($, b.action)} />
            ),
          )}
        </Box>
      </Box>
    )
  })
}
