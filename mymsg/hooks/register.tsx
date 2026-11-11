import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register, RenderSurface } from 'claude-code'

import type { Prompt } from '../types'

const PANE = 'mymsg'
const prompts = atom({ plugin: 'mymsg', key: 'prompts' } as const, [])
const cursor = atom({ plugin: 'mymsg', key: 'cursor' } as const, 0)
const order = atom({ plugin: 'mymsg', key: 'order' } as const, {})
const others = atom({ plugin: 'mymsg', key: 'others' } as const, {})
const query = atom({ plugin: 'mymsg', key: 'query' } as const, '')
const field = atom({ plugin: 'mymsg', key: 'field' } as const, '')

const PERSON = new Set(['composer', 'bridge'])
const ROW = 'msg:'
const FIND = 'find'
const NUMBER = 'number'
const REFRESH_MS = 500
// Timer syncs in a row that may each still find a drawn row unstored.
const RETRIES = 10
const SESSION = /^[\w-]+$/

// The id of a row drawn before its message is stored (a prompt just sent, a
// slash command's echo); the stored row is drawn again under its own id.
const PLACEHOLDER = 'placeholder'

const oneLine = (text: string) => text.replace(/\s+/g, ' ').trim()

// An entry and its number in the whole list, which filtering leaves as is.
type Row = { prompt: Prompt; n: number }

// Rows seen while drawing; render hooks may not write state, so handlers
// copy them into `prompts`, which outlives a reload.
let seen: Prompt[] = []
// How many of `seen` the last sync took in; the timer syncs when more arrive.
let synced = 0
// Timer syncs since one last took in a new row.
let retries = 0

// Commands run while the mod is loaded whose output row has not drawn yet.
let runs: { command: string; args: string; mine: boolean }[] = []
// Each command output row drawn, and whether the person ran it.
const ran = new Map<string, boolean>()
// The session's transcript, read up to `offset`, and how many rows it placed.
let transcript = { session: '', offset: 0, count: 0 }

const note = (prompt: Prompt) => {
  if (prompt.id !== PLACEHOLDER && !seen.some(one => one.id === prompt.id)) seen.push(prompt)
}

// Only a run says who ran a command, and the transcript never does. An output
// row takes the oldest run of its command still waiting; one with none (older
// history, a resumed session) stays listed.
const claim = (id: string, command: string, args: string) => {
  if (ran.has(id)) return
  const exact = runs.findIndex(run => run.command === command && run.args === args)
  const at = exact !== -1 ? exact : runs.findIndex(run => run.command === command)
  ran.set(id, at === -1 || runs.splice(at, 1)[0]!.mine)
}

const theirs = async ($: EngineInterface) => {
  const stored = await read($, others)
  return (id: string) => stored[id] === true || ran.get(id) === false
}

const all = async ($: EngineInterface) => {
  const isTheirs = await theirs($)
  const list = (await read($, prompts)).filter(one => one.id !== PLACEHOLDER && !isTheirs(one.id))
  for (const one of seen) {
    if (!isTheirs(one.id) && !list.some(known => known.id === one.id)) list.push(one)
  }
  return list
}

// Reads what the transcript stored since the last read and numbers its rows
// in that order. The transcript can be far over what `$.fs.read` takes, so a
// script lists only the ids. Without python the order stays as text places it.
const place = async ($: EngineInterface) => {
  const session = await $.session.id().catch(() => '')
  if (!SESSION.test(session)) return
  if (session !== transcript.session) transcript = { session, offset: 0, count: 0 }
  const { offset, count } = transcript
  const done = await $.process
    .run(['python3', '-I', `${$.plugin.root}/hooks/transcript.py`, session, `${offset}`])
    .catch(() => undefined)
  if (done?.exitCode !== 0) return
  const [end, ...ids] = done.stdout.split('\n').filter(Boolean)
  // Another sync read the same rows meanwhile, or the session changed.
  if (transcript.session !== session || transcript.offset !== offset || !Number.isInteger(Number(end))) return
  transcript = { session, offset: Number(end), count: count + ids.length }
  await update($, order, at => {
    const placed: Record<string, number> = offset === 0 ? {} : { ...at }
    ids.forEach((id, i) => (placed[id] ??= count + i))
    return placed
  })
}

// A drawn row's id is the id of its row in the transcript, so the
// transcript's order places every entry it stored. Rows it does not hold yet
// (just sent, or no transcript read) come first, placed by their text in the
// conversation where it matches, else kept where they were.
const arrange = (list: Prompt[], at: Record<string, number>, texts?: string[]) => {
  const known = list.filter(one => at[one.id] !== undefined).sort((a, b) => at[a.id]! - at[b.id]!)
  const older = list.filter(one => at[one.id] === undefined)
  if (!texts) return [...older, ...known]

  const taken = new Set<number>()
  const place = (match: (text: string) => boolean) => {
    const i = texts.findIndex((text, i) => !taken.has(i) && match(text))
    if (i !== -1) taken.add(i)
    return i === -1 ? undefined : i
  }
  const exact = new Map(older.map(one => [one, one.isCommand ? undefined : place(text => text === oneLine(one.text))]))
  let last = -1
  const keyed = older.map(one => {
    const probe = one.isCommand ? `<command-name>${one.text.split(' ')[0]}</command-name>` : oneLine(one.text)
    const i = exact.get(one) ?? place(text => text.includes(probe))
    last = i ?? last
    return { one, key: last }
  })
  return [...keyed.sort((a, b) => a.key - b.key).map(({ one }) => one), ...known]
}

const shown = (list: Prompt[], text: string): Row[] => {
  const needle = oneLine(text).toLowerCase()
  return list
    .map((prompt, i) => ({ prompt, n: i + 1 }))
    .filter(({ prompt }) => oneLine(prompt.text).toLowerCase().includes(needle))
}

const clamp = (rows: Row[], at: number) => Math.max(0, Math.min(rows.length - 1, at))

const sync = async ($: EngineInterface) => {
  synced = seen.length
  await place($)
  const notMine = [...ran].filter(([, isMine]) => !isMine).map(([id]) => [id, true] as const)
  if (notMine.length) await update($, others, at => ({ ...at, ...Object.fromEntries(notMine) }))
  const texts = await $.session
    .messages()
    .then(messages => messages.filter(one => one.role === 'user').map(one => oneLine(one.text)))
    .catch(() => undefined)
  const list = arrange(await all($), await read($, order), texts)
  await update($, prompts, () => list)
  const rows = shown(list, await read($, query))
  await update($, cursor, at => clamp(rows, at))
  return rows
}

const select = async ($: EngineInterface, at: number) => {
  await update($, cursor, () => at)
  await $.ui.focus({ requestId: PANE, key: `${ROW}${at}` }).catch(() => undefined)
  await $.ui.scroll({ to: { key: `${ROW}${at}` }, in: PANE }).catch(() => undefined)
}

const move = async ($: EngineInterface, by: number) => {
  const rows = await sync($)
  await select($, clamp(rows, (await read($, cursor)) + by))
}

const jump = async ($: EngineInterface, pick: (rows: Row[]) => Row | undefined) => {
  const rows = await sync($)
  const row = pick(rows)
  if (!row) return
  await select($, rows.indexOf(row))
  const moved = await $.ui
    .scroll({ to: { requestId: row.prompt.id }, block: row.prompt.isCommand ? 'center' : 'start' })
    .catch((error: Error) => ({ deny: error.message }))
  if (moved.deny) $.ui.toast(`Could not jump: ${moved.deny}`)
}

const ask = async ($: EngineInterface, which: typeof FIND | typeof NUMBER) => {
  await update($, field, () => which)
  await $.ui.focus({ requestId: PANE, key: which }).catch(() => undefined)
}

const find = async ($: EngineInterface, text: string) => {
  await update($, query, () => text)
  const rows = await sync($)
  await update($, cursor, () => Math.max(0, rows.length - 1))
}

// Goes to the entry numbered `text`, showing every row again if the search
// hides it.
const go = async ($: EngineInterface, text: string) => {
  await update($, field, () => '')
  const n = Number(text.trim())
  const rows = await sync($)
  if (!Number.isInteger(n) || n < 1 || n > (await read($, prompts)).length) {
    $.ui.toast(`No message ${text.trim() || '(empty)'}`)
    await select($, await read($, cursor))
    return
  }
  if (!rows.some(row => row.n === n)) await update($, query, () => '')
  await jump($, rows => rows.find(row => row.n === n))
}

const copy = async ($: EngineInterface, surface: RenderSurface) => {
  const rows = await sync($)
  const row = rows[await read($, cursor)]
  if (!row) return
  const copied = await $.ui.copy({ text: row.prompt.text, surface })
  $.ui.toast(copied.isCopied ? `Copied message ${row.n}` : `Could not copy: ${copied.reason}`)
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'mymsg',
      description: 'List your messages of this session and jump to one',
    })
    // A row can draw before the transcript stores it, so a sync that left one
    // unplaced is tried again a few times.
    $.clock.every(REFRESH_MS, async () => {
      if (seen.length !== synced) retries = 0
      else if (retries >= RETRIES) return
      else {
        const at = await read($, order)
        if (seen.every(one => at[one.id] !== undefined)) return
        retries++
      }
      await sync($)
    })

    return next(e)
  })

  // After /clear or /resume the process goes on under another session, which
  // must not list the ended one's messages; on an exit the reset costs nothing.
  on('session.end', async ($, e, next) => {
    seen = []
    synced = 0
    retries = 0
    runs = []
    ran.clear()
    transcript = { session: '', offset: 0, count: 0 }
    await update($, prompts, () => [])
    await update($, order, () => ({}))
    await update($, others, () => ({}))
    await update($, cursor, () => 0)
    await update($, query, () => '')
    await update($, field, () => '')

    return next(e)
  }).catch(($, e, next) => next(e))

  on('command.run', { command: 'mymsg' }, async $ => {
    await update($, query, () => '')
    await update($, field, () => '')
    const rows = await sync($)
    await update($, cursor, () => Math.max(0, rows.length - 1))
    await $.ui.open({ id: PANE, title: 'My messages', focus: true })

    return { text: 'My messages: j/k move, l jump, t/b top/bottom, s search, g go to, c copy, h close' }
  })

  // Every command runs before its output row draws; the row claims the run.
  on('command.run', async ($, e, next) => {
    if (e.command !== PANE) runs.push({ command: e.command, args: e.args, mine: PERSON.has(e.origin.kind) })

    return next(e)
  }).catch(($, e, next) => next(e))

  // The row's requestId is what $.ui.scroll takes to bring it into view.
  on('ui.render', { component: 'UserMessage' }, async ($, e, next) => {
    if (PERSON.has(e.props.origin.kind) && oneLine(e.props.text)) note({ id: e.requestId, text: e.props.text })

    return next(e)
  }).catch(($, e, next) => next(e))

  // A command's echo is only ever drawn as a placeholder; its output row is
  // what can be scrolled to. Opening this pane is not an entry of its own.
  on('ui.render', { component: 'CommandOutput' }, async ($, e, next) => {
    if (e.props.command !== PANE && e.requestId !== PLACEHOLDER) {
      claim(e.requestId, e.props.command, e.props.args)
      note({ id: e.requestId, text: oneLine(`/${e.props.command} ${e.props.args}`), isCommand: true })
    }

    return next(e)
  }).catch(($, e, next) => next(e))

  // The focus ring stays on message rows and the open field, and carries the
  // cursor with it.
  on('ui.focus', { requestId: PANE }, async ($, e, next) => {
    if (e.element === undefined || e.element === FIND || e.element === NUMBER) return next(e)
    if (!e.element.startsWith(ROW)) return {}
    const at = Number(e.element.slice(ROW.length))
    await update($, cursor, () => at)

    return next(e)
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const elements = $.ui.resolve(e)
    const { Box, Text, Button } = elements
    // The mobile app draws no text field, so search and go to are left out there.
    const Input = e.surface !== 'mobile' && 'Input' in elements ? elements.Input : undefined
    const list = arrange(await all($), await read($, order))
    const searched = await read($, query)
    const rows = shown(list, searched)
    const at = await read($, cursor)
    const open = await read($, field)
    const digits = `${list.length}`.length
    const width = Math.max(10, e.props.bodyColumns - digits - 2)

    return (
      <Box flexDirection="column">
        {/* Fields come first: the ring holds focus by position, so rows the
            search hides must not come before them. */}
        {Input && open === FIND && (
          <Input
            key={FIND}
            label="search: "
            placeholder={searched ? `"${searched}" now; Enter on empty clears` : 'text in a message'}
            submitLabel="done"
            autoFocus
            onInput={(text: string) => find($, text)}
            onSubmit={async (text: string) => {
              await update($, field, () => '')
              await find($, text)
              await select($, await read($, cursor))
            }}
          />
        )}
        {Input && open === NUMBER && (
          <Input
            key={NUMBER}
            label="go to: "
            placeholder={`1-${list.length}`}
            value=""
            submitLabel="jump"
            autoFocus
            onSubmit={(text: string) => go($, text)}
          />
        )}
        {list.length === 0 && <Text dimColor>No messages yet.</Text>}
        {list.length > 0 && rows.length === 0 && <Text dimColor>No messages match "{searched}".</Text>}
        {rows.map(({ prompt, n }, i) => (
          <Box flexDirection="row">
            <Text dimColor>{`${n}`.padStart(digits)} </Text>
            <Button
              key={`${ROW}${i}`}
              label={oneLine(prompt.text).slice(0, width) || '(empty)'}
              plain
              dimColor={i !== at}
              autoFocus={i === at && !open ? true : undefined}
              onPress={() => jump($, rows => rows.find(row => row.prompt.id === prompt.id))}
            />
          </Box>
        ))}
        {searched && !open && (
          <Text dimColor>
            Search "{searched}": {rows.length} of {list.length}
          </Text>
        )}
        <Box flexDirection="row" gap={2}>
          <Button key="down" label="down" hotkey="j" plain dimColor onPress={() => move($, 1)} />
          <Button key="up" label="up" hotkey="k" plain dimColor onPress={() => move($, -1)} />
          <Button key="top" label="top" hotkey="t" plain dimColor onPress={() => jump($, rows => rows[0])} />
          <Button key="bottom" label="bottom" hotkey="b" plain dimColor onPress={() => jump($, rows => rows.at(-1))} />
          <Button
            key="jump"
            label="jump"
            hotkey="l"
            plain
            dimColor
            onPress={async () => {
              const at = await read($, cursor)
              await jump($, rows => rows[at])
            }}
          />
          {Input && <Button key="search" label="search" hotkey="s" plain dimColor onPress={() => ask($, FIND)} />}
          {Input && <Button key="goto" label="go to" hotkey="g" plain dimColor onPress={() => ask($, NUMBER)} />}
          <Button key="copy" label="copy" hotkey="c" plain dimColor onPress={press => copy($, press.surface)} />
          <Button key="close" label="close" hotkey="h" plain dimColor onPress={() => $.ui.close({ id: PANE })} />
        </Box>
      </Box>
    )
  })
}
