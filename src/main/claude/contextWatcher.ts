import { execFile } from 'node:child_process'
import { existsSync } from 'node:fs'
import { open, readdir, readFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'
import type { ContextUsage } from '../../shared/types'
import { contextPercent, lastContextTokens } from './transcript'

/** How much of the end of a transcript is read; one model response is far smaller than this. */
const TAIL_BYTES = 1024 * 1024
const POLL_MS = 3000

const claudeDir = (): string => process.env.CLAUDE_CONFIG_DIR || join(homedir(), '.claude')

interface ClaudeProcess {
  pid: number
  sessionId: string
  updatedAt: number
}

export interface WatcherDeps {
  /** Terminal session id -> pid of the shell the pty started. */
  sessionPids(): Map<string, number>
  /** Context window (tokens) to assume; sessions beyond it count as the 1M window. */
  window(): number
  emit(usage: Record<string, ContextUsage>): void
}

/**
 * Finds the Claude Code sessions running inside terminals and reports how full their context is.
 * Claude Code writes `sessions/<pid>.json` (pid, session id) and a transcript per session; the pid
 * is matched to a terminal through the process tree, and the transcript's last model response says
 * how many tokens the context holds. Nothing is read from the terminal screen.
 */
export class ContextWatcher {
  private timer: NodeJS.Timeout | null = null
  private busy = false
  private last = ''
  private transcripts = new Map<string, string>()

  constructor(private deps: WatcherDeps) {}

  start(): void {
    if (this.timer) return
    this.timer = setInterval(() => void this.poll(), POLL_MS)
    void this.poll()
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer)
    this.timer = null
    this.last = ''
    this.deps.emit({})
  }

  private async poll(): Promise<void> {
    if (this.busy) return
    this.busy = true
    try {
      const usage = await this.collect()
      const key = JSON.stringify(usage)
      if (key !== this.last) {
        this.last = key
        this.deps.emit(usage)
      }
    } catch {
      /* unreadable state this round; try again on the next one */
    } finally {
      this.busy = false
    }
  }

  private async collect(): Promise<Record<string, ContextUsage>> {
    const pids = this.deps.sessionPids()
    const claudes = await readClaudeProcesses()
    if (pids.size === 0 || claudes.length === 0) return {}
    const parents = await processParents()
    const result: Record<string, ContextUsage> = {}
    const roots = new Map([...pids].map(([id, pid]) => [pid, id]))
    // Newest first: if a terminal hosts several Claude processes, the most recent one wins.
    for (const c of claudes.sort((a, b) => b.updatedAt - a.updatedAt)) {
      const terminal = roots.get(ancestorIn(c.pid, parents, roots))
      if (!terminal || result[terminal]) continue
      const used = await this.read(c.sessionId)
      if (!used) continue
      const { percent, window } = contextPercent(used.tokens, this.deps.window())
      result[terminal] = { percent, tokens: used.tokens, window, model: used.model }
    }
    return result
  }

  private async read(
    claudeSessionId: string
  ): Promise<{ tokens: number; model: string | null } | null> {
    const file = await this.transcriptPath(claudeSessionId)
    if (!file) return null
    const fh = await open(file, 'r')
    try {
      const { size } = await fh.stat()
      const length = Math.min(size, TAIL_BYTES)
      const buf = Buffer.alloc(length)
      await fh.read(buf, 0, length, size - length)
      return lastContextTokens(buf.toString('utf8'))
    } finally {
      await fh.close()
    }
  }

  private async transcriptPath(sessionId: string): Promise<string | null> {
    const known = this.transcripts.get(sessionId)
    if (known && existsSync(known)) return known
    const root = join(claudeDir(), 'projects')
    for (const dir of await readdir(root).catch(() => [])) {
      const file = join(root, dir, `${sessionId}.jsonl`)
      if (existsSync(file)) {
        this.transcripts.set(sessionId, file)
        return file
      }
    }
    return null
  }
}

async function readClaudeProcesses(): Promise<ClaudeProcess[]> {
  const dir = join(claudeDir(), 'sessions')
  const out: ClaudeProcess[] = []
  for (const name of await readdir(dir).catch(() => [])) {
    if (!name.endsWith('.json')) continue
    try {
      const o = JSON.parse(await readFile(join(dir, name), 'utf8')) as Partial<ClaudeProcess>
      if (typeof o.pid === 'number' && typeof o.sessionId === 'string')
        out.push({ pid: o.pid, sessionId: o.sessionId, updatedAt: o.updatedAt ?? 0 })
    } catch {
      /* half-written file */
    }
  }
  return out
}

/** The first of `pid` and its ancestors that is a terminal's shell, or -1. */
export function ancestorIn(
  pid: number,
  parents: Map<number, number>,
  roots: Map<number, unknown>
): number {
  let cur: number | undefined = pid
  for (let depth = 0; cur !== undefined && depth < 32; depth++) {
    if (roots.has(cur)) return cur
    cur = parents.get(cur)
  }
  return -1
}

/** pid -> parent pid for every running process (one hidden, read-only PowerShell query). */
function processParents(): Promise<Map<number, number>> {
  return new Promise((resolve) => {
    execFile(
      'powershell.exe',
      [
        '-NoProfile',
        '-NonInteractive',
        '-Command',
        "Get-CimInstance Win32_Process -Property ProcessId,ParentProcessId | ForEach-Object { '{0},{1}' -f $_.ProcessId,$_.ParentProcessId }"
      ],
      { windowsHide: true, timeout: 10_000, maxBuffer: 8 * 1024 * 1024 },
      (err, stdout) => {
        const map = new Map<number, number>()
        if (!err)
          for (const line of stdout.split(/\r?\n/)) {
            const [p, pp] = line.split(',').map(Number)
            if (Number.isFinite(p) && Number.isFinite(pp)) map.set(p, pp)
          }
        resolve(map)
      }
    )
  })
}
