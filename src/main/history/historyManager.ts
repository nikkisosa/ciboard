import { readdir, readFile, rm, stat, open } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { join, resolve, sep, basename, dirname } from 'node:path'
import { app } from 'electron'
import type { HistoryEntry, HistoryFileInfo } from '../../shared/types'
import { getSettings } from '../settings'
import { parseMd } from './mdFormat'
import { applyRetention } from './retention'
import { DEFAULT_REDACTION_PATTERNS, Redactor } from './redact'
import { SearchIndex } from './searchIndex'
import { SessionLog, type SessionLogEvents, type SessionMeta } from './sessionLog'

const RAW_RE = /^(\d{6})_([a-z0-9-]+)_(.+)\.raw\.txt$/
const DAY_RE = /^\d{4}-\d{2}-\d{2}$/

/** Resolved history folder; kept in memory so the writers never await. */
let historyDirCache = join(app.getPath('appData'), 'CIBoard', 'history')
let outputLimitCache = 2000
let patternsCache: string[] = DEFAULT_REDACTION_PATTERNS
let retentionCache: number | null = null
export const currentHistoryDir = (): string => historyDirCache

export async function refreshHistoryDir(): Promise<string> {
  const s = await getSettings()
  historyDirCache = s.historyDir || join(app.getPath('appData'), 'CIBoard', 'history')
  outputLimitCache = Math.max(10, s.historyOutputLimit || 2000)
  patternsCache = s.redactionPatterns
  retentionCache = s.historyRetentionDays
  return historyDirCache
}

export const currentRetentionDays = (): number | null => retentionCache
export const currentRedactionPatterns = (): string[] => patternsCache

export const mdPathOf = (raw: string): string => raw.replace(/\.raw\.txt$/, '.md')

export class HistoryManager {
  private logs = new Map<string, SessionLog>()
  readonly index = new SearchIndex()

  constructor(private events: SessionLogEvents) {}

  /** Index everything on disk (call after the history folder is known). */
  buildIndex(): Promise<void> {
    return this.index.build(currentHistoryDir())
  }

  start(meta: SessionMeta, paused = false): string {
    const log = new SessionLog(
      meta,
      currentHistoryDir,
      () => outputLimitCache,
      {
        ...this.events,
        entry: (id, entry) => {
          this.index.add(entry)
          this.events.entry(id, entry)
        }
      },
      { redactor: new Redactor(patternsCache), paused }
    )
    this.logs.set(meta.sessionId, log)
    return log.rawFile
  }

  /** Apply changed redaction patterns to sessions that are already running. */
  refreshRedaction(): void {
    for (const log of this.logs.values()) log.setRedactor(new Redactor(patternsCache))
  }

  setPaused(sessionId: string, paused: boolean): void {
    this.logs.get(sessionId)?.setPaused(paused)
  }

  /** Delete the files of one session (live or past). Running sessions continue in fresh files. */
  async clearSession(rawFile: string): Promise<void> {
    const live = [...this.logs.values()].find((l) => l.rawFiles.includes(rawFile))
    if (live) {
      this.index.removeFiles(new Set(await live.clear()))
      return
    }
    await rm(rawFile, { force: true })
    await rm(mdPathOf(rawFile), { force: true })
    this.index.removeFiles(new Set([rawFile]))
  }

  /** Empty the history folder. Running sessions continue in fresh files. */
  async clearAll(): Promise<void> {
    const root = currentHistoryDir()
    for (const log of this.logs.values()) await log.clear()
    for (const name of await readdir(root).catch(() => [] as string[])) {
      if (!DAY_RE.test(name)) continue
      const dir = join(root, name)
      // The fresh files of running sessions live in today's folder; keep exactly those.
      const keep = new Set(
        [...this.logs.values()].flatMap((l) => l.rawFiles.flatMap((f) => [f, mdPathOf(f)]))
      )
      for (const f of await readdir(dir)) {
        const path = join(dir, f)
        if (!keep.has(path)) await rm(path, { recursive: true, force: true })
      }
      if ((await readdir(dir)).length === 0) await rm(dir, { recursive: true, force: true })
    }
    this.index.clear()
  }

  /** Delete day folders older than the retention setting (if any). */
  async enforceRetention(): Promise<string[]> {
    if (retentionCache == null) return []
    const removed = await applyRetention(currentHistoryDir(), retentionCache)
    if (removed.length) void this.buildIndex()
    return removed
  }

  resize(sessionId: string, cols: number, rows: number): void {
    this.logs.get(sessionId)?.resize(cols, rows)
  }

  output(sessionId: string, data: string): void {
    this.logs.get(sessionId)?.output(data)
  }

  fileOf(sessionId: string): string | null {
    return this.logs.get(sessionId)?.rawFile ?? null
  }

  async end(sessionId: string, exitCode: number): Promise<void> {
    const log = this.logs.get(sessionId)
    if (!log) return
    log.note(`session ended (exit ${exitCode})`)
    this.logs.delete(sessionId)
    await log.close()
  }

  async closeAll(): Promise<void> {
    const all = [...this.logs.values()]
    this.logs.clear()
    await Promise.all(all.map((l) => l.close()))
  }
}

/** Only files below the history folder may be read or opened through IPC. */
export function insideHistory(file: string): boolean {
  const root = resolve(currentHistoryDir()) + sep
  return resolve(file).startsWith(root)
}

export async function listHistoryFiles(limit = 500): Promise<HistoryFileInfo[]> {
  const root = currentHistoryDir()
  let days: string[]
  try {
    days = (await readdir(root))
      .filter((d) => DAY_RE.test(d))
      .sort()
      .reverse()
  } catch {
    return []
  }
  const out: HistoryFileInfo[] = []
  for (const day of days) {
    const names = (await readdir(join(root, day)))
      .filter((n) => RAW_RE.test(n))
      .sort()
      .reverse()
    for (const name of names) {
      const m = RAW_RE.exec(name)!
      const file = join(root, day, name)
      const st = await stat(file).catch(() => null)
      out.push({
        file,
        date: day,
        time: `${m[1].slice(0, 2)}:${m[1].slice(2, 4)}:${m[1].slice(4, 6)}`,
        shell: m[2],
        title: m[3],
        sizeBytes: st?.size ?? 0,
        hasMd: existsSync(mdPathOf(file))
      })
      if (out.length >= limit) return out
    }
  }
  return out
}

/** Last `maxBytes` of a history file, cut at a line boundary. */
export async function readHistoryTail(file: string, maxBytes = 400_000): Promise<string> {
  if (!insideHistory(file)) throw new Error(`Not a history file: ${basename(file)}`)
  const fh = await open(file, 'r')
  try {
    const { size } = await fh.stat()
    const start = Math.max(0, size - maxBytes)
    const buf = Buffer.alloc(size - start)
    await fh.read(buf, 0, buf.length, start)
    const text = buf.toString('utf8')
    return start > 0 ? text.slice(text.indexOf('\n') + 1) : text
  } finally {
    await fh.close()
  }
}

/** Entries of a session, read back from its .md (given the raw transcript path). */
export async function readEntries(rawFile: string): Promise<HistoryEntry[]> {
  if (!insideHistory(rawFile)) throw new Error(`Not a history file: ${basename(rawFile)}`)
  const md = mdPathOf(rawFile)
  if (!existsSync(md)) return []
  return parseMd(await readFile(md, 'utf8'), rawFile, basename(dirname(rawFile)))
}
