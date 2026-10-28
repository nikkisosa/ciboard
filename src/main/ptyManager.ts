import { randomUUID } from 'node:crypto'
import * as pty from 'node-pty'
type PtyResult = { id: string; pid: number }

export interface PtySpawnOptions {
  file: string
  args: string[]
  cwd?: string
  env?: Record<string, string>
  cols: number
  rows: number
}

interface Session {
  proc: pty.IPty
  buffer: string
  timer: NodeJS.Timeout | null
}

export interface PtyEvents {
  data(id: string, data: string): void
  exit(id: string, exitCode: number): void
}

/** Owns every pty. One pty per session UUID; output is coalesced to ~60Hz before leaving main. */
export class PtyManager {
  private sessions = new Map<string, Session>()

  constructor(private events: PtyEvents) {}

  create(req: PtySpawnOptions): PtyResult {
    const id = randomUUID()
    const proc = pty.spawn(req.file, req.args, {
      name: 'xterm-256color',
      cols: Math.max(2, req.cols),
      rows: Math.max(1, req.rows),
      cwd: req.cwd || process.env.USERPROFILE,
      env: { ...process.env, ...req.env } as Record<string, string>,
      useConpty: true
    })
    const s: Session = { proc, buffer: '', timer: null }
    this.sessions.set(id, s)

    proc.onData((chunk) => {
      s.buffer += chunk
      if (!s.timer) s.timer = setTimeout(() => this.flush(id), 16)
    })
    proc.onExit(({ exitCode }) => {
      this.flush(id)
      this.sessions.delete(id)
      this.events.exit(id, exitCode)
    })
    return { id, pid: proc.pid }
  }

  private flush(id: string): void {
    const s = this.sessions.get(id)
    if (!s) return
    if (s.timer) clearTimeout(s.timer)
    s.timer = null
    if (s.buffer) {
      const data = s.buffer
      s.buffer = ''
      this.events.data(id, data)
    }
  }

  /** Session id -> pid of the process the pty started (for resource monitoring). */
  pids(): Map<string, number> {
    return new Map([...this.sessions].map(([id, s]) => [id, s.proc.pid]))
  }

  write(id: string, data: string): void {
    this.sessions.get(id)?.proc.write(data)
  }

  resize(id: string, cols: number, rows: number): void {
    const s = this.sessions.get(id)
    if (!s || cols < 2 || rows < 1) return
    try {
      s.proc.resize(cols, rows)
    } catch {
      /* pty already closed */
    }
  }

  kill(id: string): void {
    this.sessions.get(id)?.proc.kill()
  }

  killAll(): void {
    for (const id of [...this.sessions.keys()]) this.kill(id)
  }
}
