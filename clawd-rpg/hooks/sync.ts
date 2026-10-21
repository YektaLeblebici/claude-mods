import type { Save } from '../types'

/** Where a save lives: shared by every session on the machine. */
export type SaveIO = {
  read: () => Promise<Save>
  /** The revision on disk right now, or 0 when nothing is stored yet. */
  peekRev: () => Promise<number>
  write: (save: Save) => Promise<void>
}

/** A stored value's revision, in any format; 0 when it has none. */
export const revOf = (value: unknown) => {
  const rev = typeof value === 'object' && value !== null ? (value as { rev?: unknown }).rev : undefined
  return typeof rev === 'number' ? rev : 0
}

/**
 * Applies `change` to the stored save and writes the result one revision on.
 * When another session wrote in between, the change is made again on its save,
 * up to `attempts` times; the store has no compare-and-set, so this narrows the
 * window for a lost update rather than closing it.
 */
export async function mutate<T>(
  io: SaveIO,
  change: (save: Save) => { save: Save; extra: T },
  attempts = 3,
): Promise<{ before: Save; save: Save; extra: T; tries: number }> {
  for (let tries = 1; ; tries++) {
    const before = await io.read()
    const { save, extra } = change(before)
    const written: Save = { ...save, rev: revOf(before) + 1 }
    if (tries < attempts && (await io.peekRev()) !== revOf(before)) continue
    await io.write(written)
    return { before, save: written, extra, tries }
  }
}
