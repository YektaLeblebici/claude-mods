import { update } from 'claude-code'
import type { EngineInterface as Engine, Register, Timer } from 'claude-code'

import type { Burst, Enemy, Fx, LogKind, PetId, Rarity, Save, View } from '../types'
import { ACHIEVEMENTS, AFFIX_INFO, MODIFIERS, PETS, SKILLS } from './content'
import {
  bar,
  heroName,
  heroStats,
  isCommit,
  isSave,
  itemLabel,
  newSave,
  nextLuck,
  openChest,
  setActivePet,
  setLuck,
  statusLine,
  tick,
  xpToNext,
} from './engine'
import { composePixelScene } from './pixel'
import { burstFx, SCENE_ROWS } from './scene'
import { mutate, revOf, type SaveIO } from './sync'

const PANE = 'clawd-rpg'
const COMMAND = 'rpg'
const SAVE_KEY = 'save'
const VIEW_KEY = 'view'
const BACKUP_KEY = 'save-backup'
const RESET_WINDOW_MS = 2 * 60 * 1000
const FRAME_MS = 333
const SYNC_MS = 3000
/** How long the band may go undrawn before the animation clock stops bumping frames. */
const IDLE_MS = 2000
const saveRef = { plugin: 'clawd-rpg', key: 'save' } as const
const viewRef = { plugin: 'clawd-rpg', key: 'view' } as const
/** This session's own view, set with `/rpg <view> here`: session state, so it outlives a reload but not the session. */
const viewHereRef = { plugin: 'clawd-rpg', key: 'viewHere' } as const
const frameRef = { plugin: 'clawd-rpg', key: 'frame' } as const
const burstRef = { plugin: 'clawd-rpg', key: 'burst' } as const

/**
 * How much of the game shows: `show` the status line and the animated band, `mini` the status line
 * alone, `hide` nothing (the game plays on). The last choice is kept; with none, `mini`. A store from
 * before views reads its old switches: hidden as `hide`, animation on as `show`, otherwise `mini`.
 */
async function readView($: Engine): Promise<View> {
  const stored = await $.store.get(VIEW_KEY)
  if (stored === 'show' || stored === 'mini' || stored === 'hide') return stored
  if ((await $.store.get('hidden')) === true) return 'hide'
  return (await $.store.get('anim')) === true ? 'show' : 'mini'
}

const RARITY_COLOR: Record<Rarity, string> = {
  common: 'subtle',
  uncommon: 'success',
  rare: 'suggestion',
  epic: 'merged',
  legendary: 'warning',
}

const LOG_COLOR: Partial<Record<LogKind, string>> = {
  lucky: 'success',
  unlucky: 'error',
  ko: 'error',
  loot: 'warning',
  level: 'claude',
  boss: 'merged',
}

// Ticks and luck updates read-modify-write one save; run them one at a time.
let queue: Promise<unknown> = Promise.resolve()
const serial = <T,>(work: () => Promise<T>): Promise<T> => {
  const run = queue.then(work, work)
  queue = run.catch(() => undefined)
  return run
}

// $.store is the save shared by every session; $.state mirrors it for drawing.
async function load($: Engine): Promise<Save> {
  const stored = await $.store.get(SAVE_KEY)
  return isSave(stored) ? stored : newSave(Math.random)
}

const storeIO = ($: Engine): SaveIO => ({
  read: () => load($),
  peekRev: async () => revOf(await $.store.get(SAVE_KEY)),
  write: async save => {
    await $.store.set(SAVE_KEY, save)
    await $.state.set(saveRef, save)
  },
})

const advance = ($: Engine) =>
  serial(async () => {
    const { before, save, extra } = await mutate(storeIO($), current => {
      const result = tick(current, Math.random)
      return { save: result.save, extra: result }
    })
    for (const text of extra.toasts) notify($, text)
    await playBurst($, extra.fx, save.enemy ?? before.enemy)
  })

/** Plays a burst of effects in the band, when the full view is on. */
async function playBurst($: Engine, fx: Fx[], enemy: Enemy | null) {
  const played = burstFx(fx)
  if (view !== 'show' || played.length === 0) return
  const { value: at = 0 } = await $.state.get(frameRef)
  const burst: Burst = { fx: played, at, enemy }
  await $.state.set(burstRef, burst)
}

/** A successful commit: luck, plus a chest (good once per 30 minutes, small in between). */
const commitChest = ($: Engine) =>
  serial(async () => {
    const now = await $.clock.now()
    const { save, extra } = await mutate(storeIO($), current => {
      const opened = openChest(setLuck(current, false), now, Math.random)
      return { save: opened.save, extra: opened }
    })
    for (const text of extra.toasts) notify($, text)
    await playBurst($, extra.fx, save.enemy)
  })

const choosePet = ($: Engine, id: PetId) =>
  serial(() => mutate(storeIO($), current => ({ save: setActivePet(current, id), extra: null })))

// Another session may have ticked or changed the view: pick both up from the store.
async function refresh($: Engine) {
  const stored = await $.store.get(SAVE_KEY)
  if (isSave(stored)) {
    const { value: shown } = await $.state.get(saveRef)
    if (!shown || revOf(shown) !== revOf(stored)) await $.state.set(saveRef, stored)
  }
  // A session with its own view keeps it, whatever the default becomes.
  shared = await readView($)
  if (viewHere === null && shared !== view) await setView($, shared)
}

// The animation clock: one frame every FRAME_MS while the full view is on.
// Module-scoped, so a reload drops it and session.start starts it again.
let clock: Timer | null = null
// When /rpg reset was asked for in this session; /rpg reset confirm only counts within RESET_WINDOW_MS of it.
let resetAskedAt: number | null = null
let syncClock: Timer | null = null
// When the band's caption line last changed, so a long line scrolls from its start. Drawing-only
// bookkeeping: a reload just restarts the current line's marquee.
let captionLine = ''
let captionSince = 0

// The view in force. Module state, set again by session.start and the sync after a reload.
let view: View = 'mini'
// The shared default (the last plain /rpg show|mini|hide, in every session) and this session's own
// view, when it has one (/rpg <view> here). The view in force is this session's own, else the default.
let shared: View = 'mini'
let viewHere: View | null = null
// Whether any screen is attached to the session, and when the animated band was last drawn: frames
// are only worth bumping for a band someone can see. A session sent to the background stops being
// drawn, so its animation idles until it is drawn again, whatever the engine reports about screens.
let hasScreen = true
let lastDrawnAt = Number.NEGATIVE_INFINITY

/** Starts or stops the animation clock: it runs in the full view, while a screen is attached. */
function runClock($: Engine) {
  clock?.cancel()
  clock =
    view === 'show' && hasScreen
      ? $.clock.every(FRAME_MS, () => {
          void (async () => {
            if ((await $.clock.now()) - lastDrawnAt > IDLE_MS) return
            await update($, frameRef, n => (n ?? 0) + 1)
          })()
        })
      : null
}

/** A screen joined or left: re-read the screens and start or stop the clock to match. */
async function screensChanged($: Engine) {
  hasScreen = await readScreens($)
  runClock($)
}

/** Reads whether the session draws on any screen; where that cannot be told, assume it does. */
const readScreens = ($: Engine) => $.session.surfaces().then(
  screens => screens.length > 0,
  () => true,
)

/** A toast, unless the game is hidden. */
function notify($: Engine, text: string) {
  if (view !== 'hide') $.ui.toast(text)
}

/** Puts a view in force: the animation clock runs only for the full view, and hiding closes the pane. */
async function setView($: Engine, next: View) {
  view = next
  await $.state.set(viewRef, next)
  runClock($)
  if (next === 'hide' && (await $.ui.panes()).some(p => p.id === PANE)) await $.ui.close({ id: PANE })
}

const VIEW_SAID: Record<View, string> = {
  show: 'Claude RPG full view: the status line and the animated band above your prompt.',
  mini: 'Claude RPG mini view: just the status line above your prompt.',
  hide: 'Claude RPG hidden: Clawd keeps adventuring out of sight. /rpg mini or /rpg show brings it back.',
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: COMMAND,
      description: 'Claude RPG: toggle the character pane; `show` the full animated view, `mini` just the status line, `hide` nothing (it keeps playing), for every session or, with `here`, this one; `reset` starts a new hero',
      argumentHint: '[show | mini | hide] [here] | reset',
    })
    // The status line is drawn above the prompt; clear any pinned one an older version left.
    $.ui.status(undefined)
    await serial(async () => $.state.set(saveRef, await load($)))
    hasScreen = await readScreens($)
    shared = await readView($)
    viewHere = (await $.state.get(viewHereRef)).value ?? null
    await setView($, viewHere ?? shared)
    syncClock?.cancel()
    syncClock = $.clock.every(SYNC_MS, () => void serial(() => refresh($)).catch(() => undefined))
    return next(e)
  })

  // A screen joined or left: animate only while one is attached.
  on('session.attach', async ($, e, next) => {
    const done = await next(e)
    await screensChanged($)
    return done
  })
  on('session.detach', async ($, e, next) => {
    const done = await next(e)
    await screensChanged($)
    return done
  })

  on('command.run', { command: COMMAND }, async ($, e) => {
    const arg = e.args.trim().toLowerCase()
    // `/rpg <view>` sets the shared default, and this session follows it too (dropping any view of its
    // own); `/rpg <view> here` gives this session alone its own view.
    const [verb, scope] = arg.split(/\s+/)
    if ((verb === 'show' || verb === 'mini' || verb === 'hide') && (scope === undefined || scope === 'here')) {
      if (scope === 'here') {
        if (viewHere === verb) return { text: `${VIEW_SAID[verb]} (Already this session's view.)` }
        viewHere = verb
        await $.state.set(viewHereRef, verb)
        await setView($, verb)
        return { text: `${VIEW_SAID[verb]} This session only; a plain /rpg ${shared} (or show, mini, hide) returns it to the shared default.` }
      }
      if (shared === verb && viewHere === null) return { text: `${VIEW_SAID[verb]} (Already in that view.)` }
      shared = verb
      await $.store.set(VIEW_KEY, verb)
      if (viewHere !== null) {
        viewHere = null
        await $.state.set(viewHereRef, null)
      }
      await setView($, verb)
      return { text: `${VIEW_SAID[verb]} (Now the default for every session.)` }
    }
    if (arg === 'reset') {
      const s = await load($)
      resetAskedAt = await $.clock.now()
      return {
        text: [
          `This permanently deletes ${heroName(s)}: level ${s.hero.level}, depth ${s.zone.depth}, ${s.hero.gold}g,`,
          `all gear and upgrades, ${s.hero.pets?.length ?? 0} pet(s), ${s.achievements.length} achievement(s) and ${s.stats.kills} kills.`,
          'Every open Claude Code session shares this save, so all of them switch to a new level-1 Clawd.',
          'To go ahead, run /rpg reset confirm within 2 minutes. The current save is backed up first; /rpg reset undo restores it.',
        ].join('\n'),
      }
    }
    if (arg === 'reset confirm') {
      const now = await $.clock.now()
      if (resetAskedAt === null || now - resetAskedAt > RESET_WINDOW_MS)
        return { text: 'Nothing was reset. Run /rpg reset first to see what would be lost, then /rpg reset confirm within 2 minutes.' }
      resetAskedAt = null
      // Back up first: if anything below fails, the old hero is still recoverable.
      const before = await serial(async () => {
        const current = await load($)
        await $.store.set(BACKUP_KEY, current)
        await mutate(storeIO($), () => ({ save: newSave(Math.random), extra: null }))
        return current
      })
      return { text: `Reset done: a new Clawd the Newbie sets out. The old save (${heroName(before)}, level ${before.hero.level}) is backed up; /rpg reset undo restores it.` }
    }
    if (arg === 'reset undo') {
      const backup = await $.store.get(BACKUP_KEY)
      if (!isSave(backup)) return { text: 'There is no backup to restore.' }
      await serial(() => mutate(storeIO($), () => ({ save: backup, extra: null })))
      await $.store.delete(BACKUP_KEY)
      return { text: `Restored ${heroName(backup)}, level ${backup.hero.level}. The backup is used up.` }
    }
    if (arg !== '')
      return {
        text: 'Usage: /rpg toggles the pane; /rpg show (full animated view), /rpg mini (just the status line) or /rpg hide (nothing; it keeps playing) set the default for every session, and with `here` (/rpg show here) this session only; /rpg reset starts a new hero.',
      }
    const panes = await $.ui.panes()
    if (panes.some(p => p.id === PANE)) {
      await $.ui.close({ id: PANE })
      return { text: 'Claude RPG pane closed.' }
    }
    await $.ui.open({ id: PANE, title: 'Claude RPG' })
    return { text: 'Claude RPG pane opened.' }
  }).catch(() => ({ text: 'Claude RPG: the pane could not be toggled.' }))

  // A game failure must never hold up the prompt or the tool call it rides on,
  // and never runs either twice: only the game's own work is guarded.
  on('prompt.submit', async ($, e, next) => {
    await advance($).catch(() => undefined)
    return next(e)
  })

  on('turn.complete', async ($, e, next) => {
    const done = await next(e)
    if (e.agentId === undefined) await advance($).catch(() => undefined)
    return done
  })

  // Only whether the command failed leaves this hook: never its text or output,
  // which can hold secrets (tokens in curl headers, passwords in URLs).
  on('tool.call', { tool: 'Bash' }, async ($, e, next) => {
    const ran = await next(e)
    if (ran.deny === undefined) {
      const hasFailed = ran.isError === true
      // Only whether it failed and whether it was a commit are read; the command is never kept.
      const work = !hasFailed && isCommit(e.command)
        ? commitChest($)
        : serial(() => mutate(storeIO($), current => ({ save: setLuck(current, hasFailed), extra: null })))
      await work.catch(() => undefined)
    }
    return ran
  })

  // The band above the prompt: nothing when hidden, Clawd's status line in the mini view, and the
  // animated scene under it in the full view.
  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (e.props.hasSurvey || e.props.maxRows < 1) return next(e)
    const { value: shown = 'mini' } = await $.state.get(viewRef)
    if (shown === 'hide') return next(e)
    const { value: save } = await $.state.get(saveRef)
    if (!save) return next(e)
    const { Box, Text } = $.ui.resolve(e)
    const status = <Text wrap="truncate-end">{statusLine(save)}</Text>
    if (shown === 'mini' || e.props.maxRows < SCENE_ROWS + 1) return status

    // Drawn now: the clock may bump frames for the next IDLE_MS.
    lastDrawnAt = await $.clock.now()
    const { value: frame = 0 } = await $.state.get(frameRef)
    const { value: burst = null } = await $.state.get(burstRef)
    const line = save.log[save.log.length - 1]?.text ?? ''
    if (line !== captionLine) {
      captionLine = line
      captionSince = frame
    }
    const rows = composePixelScene(save, frame, burst, e.props.bodyColumns, frame - captionSince)

    return (
      <Box flexDirection="column">
        {status}
        {rows.map(row => (
          <Box flexDirection="row">
            {row.map(seg => (
              <Text color={seg.color} backgroundColor={seg.bg} bold={seg.bold}>
                {seg.text}
              </Text>
            ))}
          </Box>
        ))}
      </Box>
    )
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Button, Text } = $.ui.resolve(e)
    const { value: s } = await $.state.get(saveRef)
    if (!s) return <Text dimColor>Clawd is lacing up their boots…</Text>

    const st = heroStats(s.hero)
    const z = s.zone
    const rows = e.viewport?.rows ?? 40
    const logRoom = Math.max(3, Math.min(15, rows - 34))
    const upcoming = nextLuck(s)
    const luck =
      upcoming === 'lucky'
        ? { text: '🍀 Next tick is lucky', color: 'success' }
        : upcoming === 'unlucky'
          ? { text: `💀 Next tick is unlucky${(s.omens ?? 0) > 1 ? ` (${s.omens} omens)` : ''}`, color: 'error' }
          : { text: 'Next tick is neutral', color: 'subtle' }
    const unlocked = ACHIEVEMENTS.filter(a => s.achievements.includes(a.id))
    const nextSkill = SKILLS.find(k => k.level > s.hero.level)
    const heading = (text: string) => (
      <Text bold color="claude">
        {text}
      </Text>
    )

    return (
      <Box flexDirection="column">
        <Text bold>
          {heroName(s)} · Level {s.hero.level}
        </Text>
        <Text>
          XP {bar(s.hero.xp, xpToNext(s.hero.level), 14)} {s.hero.xp}/{xpToNext(s.hero.level)}
        </Text>
        <Text color={s.hero.hp < st.maxHp * 0.3 ? 'error' : 'success'}>
          HP {bar(s.hero.hp, st.maxHp, 14)} {s.hero.hp}/{st.maxHp}
        </Text>
        <Text>
          ATK {st.atk} DEF {st.def} LUCK {st.luck} CRIT {st.crit}%
        </Text>
        <Text>
          Gold {s.hero.gold} · Potions {s.hero.potions}
        </Text>
        <Text color={luck.color}>{luck.text}</Text>

        <Text> </Text>
        {heading('Gear')}
        {(['weapon', 'armor', 'trinket'] as const).map(slot => {
          const item = s.hero.gear[slot]
          const icon = slot === 'weapon' ? '⚔' : slot === 'armor' ? '🛡' : '💍'
          if (!item) return <Text dimColor>{icon} (empty)</Text>
          const affixes = item.affixes.map(a => AFFIX_INFO[a].desc).join(', ')
          return (
            <Text color={RARITY_COLOR[item.rarity]} wrap="wrap">
              {icon} {itemLabel(item)} ({item.rarity}, power {item.power}
              {item.upgrades ? `+${item.upgrades}` : ''}){affixes ? ` · ${affixes}` : ''}
            </Text>
          )
        })}

        <Text> </Text>
        {heading(`Depth ${z.depth} · ${z.name}${z.modifier ? ` [${MODIFIERS[z.modifier].label}]` : ''}`)}
        <Text dimColor wrap="wrap">
          {z.desc}
          {z.modifier ? ` ${MODIFIERS[z.modifier].desc}` : ''}
        </Text>
        <Text>
          Progress {bar(z.progress, z.length, 14, '▓', '░')} {z.progress}/{z.length}
        </Text>
        {s.phase === 'fighting' && s.enemy ? (
          <Box flexDirection="column">
            <Text bold color={s.enemy.isBoss ? 'merged' : s.enemy.isElite ? 'warning' : 'error'}>
              vs {s.enemy.name} {bar(Math.max(0, s.enemy.hp), s.enemy.maxHp, 10)} {Math.max(0, s.enemy.hp)}/
              {s.enemy.maxHp}
            </Text>
            <Text dimColor wrap="wrap">
              {s.enemy.desc}
            </Text>
          </Box>
        ) : (
          <Text dimColor>
            {s.phase === 'recovering'
              ? `💤 Recovering (${s.recoverLeft} ticks)`
              : s.phase === 'camp'
                ? '🏕 Resting at camp'
                : '🧭 Exploring'}
          </Text>
        )}

        <Text> </Text>
        {heading(`Pets ${s.hero.pets?.length ?? 0}/${Object.keys(PETS).length}`)}
        {(s.hero.pets ?? []).length === 0 ? (
          <Text dimColor>None yet.</Text>
        ) : (
          (s.hero.pets ?? []).map((owned, i) => {
            const pet = PETS[owned.id]
            const isActive = s.hero.activePet === owned.id
            const amount = pet.base * (1 + 0.5 * (owned.level - 1))
            return (
              <Button
                key={`pet-${owned.id}`}
                hotkey={i < 9 ? String(i + 1) : undefined}
                label={`${isActive ? '● ' : '○ '}${pet.name} Lv${owned.level} · +${amount}${pet.unit}${isActive ? ' (following)' : ''}`}
                onPress={() => void choosePet($, owned.id)}
              />
            )
          })
        )}

        <Text> </Text>
        {heading('Skills')}
        {SKILLS.filter(k => k.level <= s.hero.level).map(k => (
          <Text wrap="wrap">
            • {k.name}: {k.desc}
          </Text>
        ))}
        {nextSkill ? (
          <Text dimColor>
            Next: {nextSkill.name} at level {nextSkill.level}
          </Text>
        ) : null}

        <Text> </Text>
        {heading('Log')}
        {s.log.slice(-logRoom).map(entry => (
          <Text color={entry.tone ?? LOG_COLOR[entry.kind]} bold={entry.strong} wrap="wrap">
            {entry.text}
          </Text>
        ))}

        <Text> </Text>
        {heading(`Achievements ${unlocked.length}/${ACHIEVEMENTS.length}`)}
        {unlocked.length === 0 ? (
          <Text dimColor>None yet.</Text>
        ) : (
          <Text wrap="wrap">{unlocked.map(a => `🏆 ${a.name}`).join('  ')}</Text>
        )}
        <Text dimColor>
          {s.stats.kills} kills · {s.stats.bosses} bosses · {s.stats.ticks} ticks · deepest {s.stats.maxDepth}
        </Text>
      </Box>
    )
  })
}
