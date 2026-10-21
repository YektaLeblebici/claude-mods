import type { Save } from '../types'
import { FORMAT, hasSaveShape } from './engine'

/**
 * One step up from a format to the next, keyed by the format it starts from. Adding optional fields
 * needs no step and no new FORMAT; only a change older code would misread does, and every session
 * still running older code must be reloaded before the release that bumps FORMAT ships.
 */
export type Migration = (save: Record<string, unknown>) => Record<string, unknown>
export const MIGRATIONS: Record<number, Migration> = {}

/**
 * What a stored value is to this build: nothing yet, a save it can play (`from` the format it was
 * stored in, migrated up when older), one from a newer build, or something it cannot read.
 * A session never plays, nor writes over, a save that is `newer` or `unreadable`.
 */
export type Readout =
  | { kind: 'empty' }
  | { kind: 'ok'; save: Save; from: number }
  | { kind: 'newer'; format: number }
  | { kind: 'unreadable' }

export function readSave(value: unknown, format = FORMAT, migrations = MIGRATIONS): Readout {
  if (value === undefined || value === null) return { kind: 'empty' }
  const version = typeof value === 'object' ? (value as { version?: unknown }).version : undefined
  if (typeof version !== 'number' || !Number.isInteger(version) || version < 1) return { kind: 'unreadable' }
  if (version > format) return { kind: 'newer', format: version }
  let save = value as Record<string, unknown>
  try {
    for (let from = version; from < format; from++) {
      const step = migrations[from]
      if (!step) return { kind: 'unreadable' }
      save = { ...step(save), version: from + 1 }
    }
  } catch {
    return { kind: 'unreadable' }
  }
  return hasSaveShape(save) ? { kind: 'ok', save, from: version } : { kind: 'unreadable' }
}
