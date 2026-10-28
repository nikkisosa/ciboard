import { readdir, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { dateStr } from './time'

const DAY_RE = /^\d{4}-\d{2}-\d{2}$/

/**
 * Delete day folders older than `days` days (folder names are the local date, so this never
 * depends on file timestamps). Today and the last `days` days are kept. Returns what was removed.
 */
export async function applyRetention(
  root: string,
  days: number,
  now: Date = new Date()
): Promise<string[]> {
  if (!Number.isFinite(days) || days < 1) return []
  const cutoff = new Date(now.getFullYear(), now.getMonth(), now.getDate() - Math.floor(days))
  const cutoffName = dateStr(cutoff)
  let names: string[]
  try {
    names = await readdir(root)
  } catch {
    return []
  }
  const removed: string[] = []
  for (const name of names.filter((n) => DAY_RE.test(n)).sort()) {
    if (name >= cutoffName) continue
    await rm(join(root, name), { recursive: true, force: true })
    removed.push(name)
  }
  return removed
}
