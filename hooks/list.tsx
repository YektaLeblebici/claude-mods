import type { ClientKeyEvent, ClientModule } from 'claude-code'

// The queue pane's task list, drawn by the surface itself so it hears every key
// with its modifiers: Button hotkeys cannot tell `K` from `k`.

export type ListTone = '' | 'yellow' | 'red' | 'green'

export type ListRow = {
  id: string
  /** A section heading ("Forks"): drawn bold, never under the cursor. */
  isHeading: boolean
  head: string
  who: string
  isClaude: boolean
  text: string
  note: string
  tone: ListTone
  isCursor: boolean
  isDone: boolean
}

export type ListProps = { rows: ListRow[] }

const PLAIN_KEYS: Record<string, string> = {
  k: 'cursor-up',
  up: 'cursor-up',
  j: 'cursor-down',
  down: 'cursor-down',
  e: 'edit',
  d: 'delete',
  r: 'run-next',
  y: 'approve',
  f: 'fork-session',
  a: 'fork-agent',
  p: 'pause',
  m: 'default',
  b: 'send-back',
  c: 'clear-done',
}

/** The queue action a key asks for: `k`/`j` move the cursor, `K`/`J` the task under it. */
export function actionOf(event: ClientKeyEvent): string | undefined {
  if (event.ctrl || event.meta) return undefined

  const isChar = event.key.length === 1
  const key = isChar ? event.key.toLowerCase() : event.key
  const isShifted = event.shift === true || (isChar && event.key !== key)
  if (isShifted && (key === 'k' || key === 'up')) return 'move-up'
  if (isShifted && (key === 'j' || key === 'down')) return 'move-down'

  return isShifted && isChar ? undefined : PLAIN_KEYS[key]
}

const List: ClientModule<ListProps, true> = (props, surface) => {
  if (surface.state === undefined) {
    surface.onKey(event => {
      const action = actionOf(event)
      if (action) surface.post({ action })
    })
    surface.setState(true)
  }

  const { Box, Text } = surface.elements

  return (
    <Box flexDirection="column">
      {props.rows.map(row =>
        row.isHeading ? (
          <Text bold>{row.text}</Text>
        ) : (
          <Text inverse={row.isCursor} dimColor={row.isDone && !row.isCursor}>
            {row.isCursor ? '› ' : '  '}
            {row.head} <Text color={row.isClaude ? 'cyan' : undefined}>{row.who}</Text> {row.text}
            {row.note ? <Text color={row.tone || undefined}> {row.note}</Text> : ''}
          </Text>
        ),
      )}
    </Box>
  )
}

export default List
