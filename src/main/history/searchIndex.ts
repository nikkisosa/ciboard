import { readdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import MiniSearch from 'minisearch'
import type { HistoryEntry } from '../../shared/types'
import { parseMd } from './mdFormat'

const DAY_RE = /^\d{4}-\d{2}-\d{2}$/
/** Output indexed per entry; the full text stays in the .md. */
const OUTPUT_INDEX_CHARS = 4000

type Doc = {
  id: string
  file: string
  command: string
  cwd: string
  session: string
  output: string
}

/** In-memory full-text index over every entry in the history folder. */
export class SearchIndex {
  private mini = this.create()
  private entries = new Map<string, HistoryEntry>()
  private ready: Promise<void> = Promise.resolve()

  private create(): MiniSearch<Doc> {
    return new MiniSearch<Doc>({
      fields: ['command', 'output', 'cwd', 'session'],
      storeFields: ['file'],
      searchOptions: {
        boost: { command: 3, cwd: 1.5 },
        prefix: true,
        fuzzy: 0.15,
        combineWith: 'AND'
      },
      // Treat paths and flags as separate words: C:\dev\api -> c, dev, api; --force -> force.
      tokenize: (text) =>
        text
          .toLowerCase()
          .split(/[^\p{L}\p{N}_]+/u)
          .filter(Boolean)
    })
  }

  /** (Re)build from every .md file below `root`. Safe to call again after the folder changed. */
  build(root: string): Promise<void> {
    this.ready = this.scan(root)
    return this.ready
  }

  private async scan(root: string): Promise<void> {
    this.mini = this.create()
    this.entries.clear()
    let days: string[]
    try {
      days = (await readdir(root)).filter((d) => DAY_RE.test(d))
    } catch {
      return
    }
    for (const day of days) {
      let names: string[]
      try {
        names = (await readdir(join(root, day))).filter((n) => n.endsWith('.md'))
      } catch {
        continue
      }
      for (const name of names) {
        try {
          const md = join(root, day, name)
          const raw = md.replace(/\.md$/, '.raw.txt')
          for (const e of parseMd(await readFile(md, 'utf8'), raw, day)) this.insert(e)
        } catch {
          /* unreadable file: skip, never block startup */
        }
      }
    }
  }

  private insert(e: HistoryEntry): void {
    if (this.entries.has(e.id)) return
    this.entries.set(e.id, e)
    this.mini.add({
      id: e.id,
      file: e.file,
      command: e.command,
      cwd: e.cwd,
      session: e.session,
      output: e.output.slice(0, OUTPUT_INDEX_CHARS)
    })
  }

  /** Called as each entry is written. */
  add(e: HistoryEntry): void {
    this.insert(e)
  }

  /** Forget everything stored for these raw-transcript paths (after "clear history"). */
  removeFiles(files: ReadonlySet<string>): void {
    for (const [id, e] of this.entries) {
      if (files.has(e.file)) {
        this.mini.discard(id)
        this.entries.delete(id)
      }
    }
  }

  clear(): void {
    this.mini = this.create()
    this.entries.clear()
  }

  /** Search; `files` restricts to those sessions' raw-transcript paths (null = everything). */
  async search(
    query: string,
    files: readonly string[] | null,
    limit = 100
  ): Promise<HistoryEntry[]> {
    await this.ready
    const q = query.trim()
    if (!q) return []
    const allow = files ? new Set(files) : null
    const hits = this.mini.search(q, allow ? { filter: (r) => allow.has(r.file as string) } : {})
    return hits
      .slice(0, limit)
      .map((h) => this.entries.get(h.id))
      .filter((e): e is HistoryEntry => !!e)
  }
}
