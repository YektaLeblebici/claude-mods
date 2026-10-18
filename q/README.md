# q — a task queue for Claude Code

Keep talking to Claude while it works. `q` is a Claude Code mod that queues what
you ask for and sends each task only once the one before it has **fully
finished**, instead of interrupting the running turn. Any queued task can be
split off into a parallel fork in its own git worktree, and Claude can queue
follow-up work of its own.

```
 Queue · 2 waiting · default · running #4
 add a task, Enter to queue
 › ▶ #4 you    fix the flaky login test
   · #5 claude dedupe the retry helpers
   · #6 you    bump eslint to v10
 Forks
   ⑂ agent   add a cache  q/add-a-cache-f7   ready
 e edit  d delete  k cursor up  j cursor down  K move up  J move down  r run next …
```

## What it does

- **A real queue.** Tasks wait until Claude's current turn ends with an answer,
  then go one at a time. Claude Code's own "type while it works" injects your
  message mid-turn; `q` does not.
- **Default mode.** Turn it on and everything you type joins the queue, not just
  `/q` tasks.
- **Skills queue too.** `/q /code-review high` runs the skill when its turn
  comes, with the queue's instructions attached.
- **Parallel forks.** Pick a task and fork it into a background session or a
  background subagent, each in its own worktree. Finished forks merge back into
  your checkout one at a time, between tasks.
- **Claude can add tasks.** Claude gets a `queue_add` tool for follow-up work it
  notices, within limits (see [Safety](#safety)).
- **Commits per task.** In a git repository, each queued task is asked to commit
  only the files it changed.

## Install

`q` is a hooks-module plugin (a "mod"). From a local marketplace folder:

```sh
claude plugin install q@<marketplace>
```

Or load it for one session while developing:

```sh
claude --plugin-dir /path/to/q
```

## Using it

| You type | What happens |
| --- | --- |
| `/q fix the login test` | Adds the task to the end of the queue. Sent at once if Claude is idle. |
| `/q /code-review high` | Queues a slash command; it runs as if typed when its turn comes. |
| `/q` | Opens the queue pane, or closes it if it is open. |
| `/q default` | Default mode on/off: prompts typed without `/q` join the queue too. |

`/q` works while Claude is busy: it acts at once and never waits for the turn.

### The pane

`k`/`j` (or ↑/↓) move the highlighted cursor; every other key acts on the row
under it. Docked beside the transcript, the list fills the pane: click anywhere in
it, blank space included, to give it the keys. With nothing queued there is no
list; the add-task field fills the pane instead, and the buttons take their own
keys (`p`, `m`, `c` and the rest), so Tab from the field reaches them.

| Key | Action |
| --- | --- |
| `k` / `j` | Move the cursor up / down |
| `K` / `J` | Move the task up / down (Shift+↑/↓ too) |
| `e` | Edit the task |
| `d` | Delete the task — or the fork, see below |
| `r` | Run this task next |
| `y` | Approve a task Claude proposed past its limit |
| `f` | Fork the task into a background **session** |
| `a` | Fork the task into a background **subagent** |
| `b` | Send a fork's task back to the front of the queue |
| `p` | Pause / resume the queue |
| `m` | Default mode on / off |
| `c` | Clear finished: done tasks and merged forks |

The buttons under the list do the same with the mouse. On surfaces without the
list (VS Code, mobile) the buttons carry the keys, with `w`/`s` for moving.

### Default mode

With `m` or `/q default` on:

- Prompts you type are queued, and sent at once when Claude is idle.
- Skills and prompt commands you type (`/code-review`, `/simplify`, `/pdf`, …)
  are queued too.
- Session commands (`/model`, `/compact`, …) and other mods' commands (`/rpg`)
  still run at once.
- While the queue is **paused**, prompts go straight in, so you can answer
  Claude's question or redirect it after Esc. Prompts with images also go
  straight in.

### When the queue pauses

| Why | Resuming (`p`) |
| --- | --- |
| You pressed Esc, or the turn errored | Sends the interrupted task again |
| Claude called `queue_pause` with a question | Marks that task done and goes on |
| The checkout had uncommitted changes when the queue started | Starts anyway |
| A fork's merge failed | Goes on; the fork stays listed as failed |
| You paused it | Goes on |

## Forks

Forking a task (`f` or `a`) starts a copy of the conversation so far that works
on that one task in its own worktree under `.claude/worktrees/`, on a branch
`q/<task>-<fork id>`.

1. The fork works and commits on its branch, then reports ready.
2. Between queue tasks, one fork at a time gets the **merge lock** and merges its
   branch into your checkout; the queue waits meanwhile.
3. Other running forks are told to rebase onto the new `main`.
4. The main session gets a note that files may have changed.

If a fork's report goes missing, the queue asks git whether its branch is
already merged before calling it failed.

Managing forks in the pane:

- `d` stops a fork if it is running, removes its worktree and deletes its branch
  — **unmerged commits included** — and drops its task.
- `b` does the same clean-up but puts the task back at the front of the queue.
- `c` clears merged forks only; failed forks stay until you handle each one.
- A fork that is merging into your checkout refuses `d` and `b`: stopping it
  there could leave a half-done merge.

A deleted fork's commits can still be recovered with `git fsck --lost-found`
until git's garbage collection prunes them (about two weeks by default).

## Claude's tools

| Tool | For |
| --- | --- |
| `queue_add` | Add a follow-up task to the end of the queue |
| `queue_list` | Read the queue and the forks |
| `queue_pause` | Pause the queue to ask the user something |
| `fork_ready` | A fork reports its work done and committed |
| `fork_merged` | A fork reports its merge, or why it could not |

## Safety

The queue runs work while you are not watching, so it guards the obvious ways
that can go wrong. The guards are best effort: they match the usual spellings of
a command, not every way a shell can spell it.

- **Claude's own tasks are capped.** At most 3 tasks Claude adds per task of
  yours run on their own; the rest wait as *proposed* until you press `y`. This
  stops one request snowballing into twenty commits, and limits what an
  instruction Claude read in a file or web page can queue.
- **Claude's tasks are marked.** They show as `claude` in the pane and reach
  Claude framed as its own suggestion, not as your words.
- **Discarding work is blocked** while the queue works: `git reset --hard`,
  `git checkout -- .`, `git clean -f`, `git restore`, `git stash drop`.
- **Pushes and PRs** are allowed in tasks you queued, blocked in tasks Claude
  queued itself, and always blocked in forks.
- **Forks stay in their worktree.** A fork's edits to the main checkout are
  refused until it holds the merge lock.
- **Conversation-wiping commands** (`/clear`, `/exit`, `/resume`, `/rewind`, …)
  cannot be queued.

## Limits

- Where an organization manages Claude Code, `prompt.compose` and `skill.prompt`
  hooks of plugins you install do not run. `q` repeats its instructions in the
  `queue_add` tool's description and attaches them to queued skills as a note
  instead.
- Built-in skills that should queue in default mode are named in
  `QUEUED_BUILTINS` (`hooks/logic.ts`); a new one runs at once until added.
- A fork's background session needs the main checkout to be a trusted folder.

## Development

```
.claude-plugin/plugin.json   manifest
hooks/hooks.json             names the hooks module
hooks/register.tsx           hooks: queue, turns, forks, guards, the pane
hooks/logic.ts               pure queue logic, guards and prompt texts
hooks/list.tsx               the pane's task list (a Client: hears K vs k)
hooks/q.test.tsx             tests
types/index.d.ts             the mod's $.state contract
```

```sh
claude plugin validate .
claude plugin test .
npx -y -p typescript@5.6.3 tsc -p .
```
