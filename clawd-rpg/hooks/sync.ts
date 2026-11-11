import type { Save } from '../types'

/** Where a save lives: shared by every session on the machine. */
export type SaveIO = {
  read: () => Promise<Save>
  /** The revision on disk right now, or 0 when nothing is stored yet. */
  peekRev: () => Promise<number>
  write: (save: Save) => Promise<void>
  /**
   * Takes the save's lock, shared by every session on the machine: resolves the call that gives it
   * back, or null when it can't be had (the write then goes ahead unlocked, guarded by `rev` alone).
   */
  lock?: () => Promise<(() => Promise<void>) | null>
}

/** A stored value's revision, in any format; 0 when it has none. */
export const revOf = (value: unknown) => {
  const rev = typeof value === 'object' && value !== null ? (value as { rev?: unknown }).rev : undefined
  return typeof rev === 'number' ? rev : 0
}

/**
 * Applies `change` to the stored save and writes the result one revision on, holding the save's lock
 * from the read to the write, so no other session's write lands in between and is lost. Without the
 * lock (it couldn't be had), a write another session made in between is noticed by its revision and
 * the change made again on its save, up to `attempts` times: that narrows the window, not closes it.
 */
export async function mutate<T>(
  io: SaveIO,
  change: (save: Save) => { save: Save; extra: T },
  attempts = 3,
): Promise<{ before: Save; save: Save; extra: T; tries: number }> {
  const release = io.lock ? await io.lock().catch(() => null) : null
  try {
    for (let tries = 1; ; tries++) {
      const before = await io.read()
      const { save, extra } = change(before)
      const written: Save = { ...save, rev: revOf(before) + 1 }
      if (tries < attempts && (await io.peekRev()) !== revOf(before)) continue
      await io.write(written)
      return { before, save: written, extra, tries }
    }
  } finally {
    await release?.().catch(() => undefined)
  }
}
