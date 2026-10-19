export type QSource = 'you' | 'claude'

/** queued: waits its turn; proposed: Claude's, over the cap, waits for approval. */
export type QStatus = 'queued' | 'proposed' | 'running' | 'done' | 'forked'

export type QItem = {
  id: string
  text: string
  source: QSource
  status: QStatus
  /** The item of yours this one descends from; Claude's additions count against it. */
  rootId: string
}

export type QForkKind = 'session' | 'agent'

export type QForkStatus = 'starting' | 'working' | 'ready' | 'merging' | 'merged' | 'failed'

export type QFork = {
  id: string
  itemId: string
  text: string
  kind: QForkKind
  status: QForkStatus
  /** Shared secret that authenticates the fork's control messages. */
  token: string
  branch?: string
  worktree?: string
  agentId?: string
  sessionId?: string
  note?: string
  readyAt?: number
}

export type QPendingCommand = {
  itemId: string
  name: string
  /** The queue's instructions, for the skill's prompt to carry. */
  footer: string
  isWrapped: boolean
  /** A forked skill's background agent, whose task notification starts the command's turn. */
  agentId?: string
}

export type QPauseKind = 'user' | 'interrupted' | 'question' | 'dirty' | 'restored' | 'merge'

export type QPause = { kind: QPauseKind; reason: string }

/** Set in a session that is itself a fork made by another session's queue. */
export type QRole = {
  forkId: string
  token: string
  parentSessionId: string
  mainCheckout: string
  worktree: string
  canMerge: boolean
}

export type QData = {
  items: QItem[]
  paused: QPause | null
  runningId: string | null
  /** The main-loop turn that is working on `runningId`, once it has started. */
  runningTurnId: string | null
  isBusy: boolean
  /** Root that items Claude adds in the current turn count against. */
  turnRoot: string
  selectedId: string | null
  editingId: string | null
  forks: QFork[]
  mergeHolder: string | null
  isDirtyAcked: boolean
  /** A queued slash command the queue just ran, until its turn starts (or it turns out to have none). */
  pendingCommand: QPendingCommand | null
  /** `/q default`: prompts typed without /q go through the queue too. */
  isDefault: boolean
  role: QRole | null
  seq: number
}

declare module 'claude-code' {
  interface PluginState {
    q: { data: QData }
  }
}
