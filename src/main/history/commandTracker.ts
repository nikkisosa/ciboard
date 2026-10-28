import { decodeCommand } from './mdFormat'

export interface FinishedCommand {
  command: string
  cwd: string
  startedAt: Date
  durationMs: number
  /** Exit code as text, `?` when unknown. */
  exit: string
  output: string[]
}

export interface RunningCommand {
  command: string
  cwd: string
  startedAt: Date
  output: string[]
}

export interface TrackerHooks {
  /** Log whatever is on screen now (so the prompt/echo row is not mistaken for output). */
  flush(): void
  /** Remember the cursor position at the end of the prompt (marker B). */
  markAnchor(): void
  onCwd(cwd: string): void
  onStart(running: RunningCommand): void
  onFinished(done: FinishedCommand): void
  now?: () => Date
  /** Infer commands from the screen (shells without a C marker, i.e. cmd). */
  infer?: boolean
}

/** `file://host/C:/Users/me` or `file:///home/me` -> native path. */
export function parseOsc7(uri: string): string | null {
  const m = /^file:\/\/[^/]*(\/.*)$/.exec(uri)
  if (!m) return null
  let path: string
  try {
    path = decodeURIComponent(m[1])
  } catch {
    return null
  }
  return /^\/[A-Za-z]:/.test(path) ? path.slice(1).replace(/\//g, '\\') : path
}

interface Active extends RunningCommand {
  inferred: boolean
}

/**
 * Turns shell-integration markers into command entries.
 *
 *   A prompt start · B prompt end/command start · C output start · D;<code> command end
 *   633;E;<command> command line · 633;P;Cwd=<dir> / OSC 7 working directory
 *
 * Shells that cannot emit C (cmd) are handled by `inferred()`, fed from the screen model when
 * Enter is pressed on the line after marker B; shells that do emit C take over from there.
 */
export class CommandTracker {
  /** True once any prompt marker was seen: the session gets a structured .md. */
  integrated = false
  cwd = ''
  private explicitC = false
  private pendingCommand = ''
  private active: Active | null = null

  constructor(private hooks: TrackerHooks) {}

  private now(): Date {
    return this.hooks.now?.() ?? new Date()
  }

  get running(): RunningCommand | null {
    return this.active
  }

  /** Handle an OSC payload such as `133;D;0`. */
  osc(payload: string): void {
    const sep = payload.indexOf(';')
    const code = sep < 0 ? payload : payload.slice(0, sep)
    const rest = sep < 0 ? '' : payload.slice(sep + 1)
    if (code === '7') {
      const cwd = parseOsc7(rest)
      if (cwd) this.setCwd(cwd)
    } else if (code === '633') {
      if (rest.startsWith('E;')) this.command(decodeCommand(rest.slice(2)))
      else if (rest.startsWith('P;Cwd=')) this.setCwd(rest.slice(6))
    } else if (code === '133') {
      const kind = rest[0]
      if (kind === 'A') this.integrated = true
      else if (kind === 'B') {
        this.integrated = true
        this.hooks.markAnchor()
      } else if (kind === 'C') this.start(false)
      else if (kind === 'D') this.end(rest.length > 2 ? rest.slice(2) : '')
    }
  }

  private setCwd(cwd: string): void {
    if (cwd === this.cwd) return
    this.cwd = cwd
    this.hooks.onCwd(cwd)
  }

  private command(text: string): void {
    this.pendingCommand = text
    if (this.active) this.active.command = text
  }

  /** Screen model saw Enter after the prompt; only trusted until a real C marker shows up. */
  inferred(text: string): void {
    if (!this.hooks.infer || this.explicitC || this.active || !text) return
    this.pendingCommand = text
    this.start(true)
  }

  private start(inferred: boolean): void {
    if (!inferred) this.explicitC = true
    if (this.active) {
      // First command of an integrated shell: inference raced the real marker.
      this.active.inferred = false
      if (this.pendingCommand) this.active.command = this.pendingCommand
      return
    }
    this.hooks.flush()
    this.active = {
      command: this.pendingCommand,
      cwd: this.cwd,
      startedAt: this.now(),
      output: [],
      inferred
    }
    this.hooks.onStart(this.active)
  }

  /** A finished screen line while a command runs is part of its output. */
  line(text: string): void {
    this.active?.output.push(text)
  }

  private end(code: string): void {
    this.hooks.flush()
    const a = this.active
    this.active = null
    this.pendingCommand = ''
    if (!a || !a.command.trim()) return
    this.hooks.onFinished(this.finish(a, /^-?\d+$/.test(code) ? code : '?'))
  }

  private finish(a: Active, exit: string): FinishedCommand {
    const out = [...a.output]
    while (out.length && !out[0]) out.shift()
    while (out.length && !out[out.length - 1]) out.pop()
    return {
      command: a.command,
      cwd: a.cwd,
      startedAt: a.startedAt,
      durationMs: Math.max(0, this.now().getTime() - a.startedAt.getTime()),
      exit,
      output: out
    }
  }

  /** The session ended while a command was in flight. */
  interrupt(): void {
    this.hooks.flush()
    const a = this.active
    this.active = null
    if (a && a.command.trim()) this.hooks.onFinished(this.finish(a, '?'))
  }
}
