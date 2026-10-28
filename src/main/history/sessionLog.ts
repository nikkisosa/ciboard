import { createWriteStream, existsSync, mkdirSync, rmSync, type WriteStream } from 'node:fs'
import { basename, join } from 'node:path'
import type { HistoryEntry, HistoryRunning } from '../../shared/types'
import { ScreenLog } from './ansi'
import { CommandTracker, type FinishedCommand } from './commandTracker'
import { DEFAULT_REDACTION_PATTERNS, Redactor } from './redact'
import { fenceLang, formatDuration, formatEntry, formatHeader, truncateOutput } from './mdFormat'
import { clock, clockMs, dateStr, dateTime, fileTime, slug } from './time'

export interface SessionMeta {
  sessionId: string
  title: string
  profileName: string
  /** Short shell label used in file names: cmd, powershell, pwsh, bash, wsl, custom. */
  shell: string
  elevated: boolean
  cols: number
  rows: number
}

export interface AppendEvent {
  sessionId: string
  file: string
  text: string
}

export interface SessionLogEvents {
  append(e: AppendEvent): void
  entry(sessionId: string, entry: HistoryEntry): void
  running(sessionId: string, running: HistoryRunning | null): void
  cwd(sessionId: string, cwd: string): void
}

/** Flush an unfinished line (usually a prompt) after this much silence so a crash loses nothing. */
const IDLE_FLUSH_MS = 1500
/** How often the live "running command" view is refreshed. */
const RUNNING_PUSH_MS = 400
const RUNNING_TAIL_LINES = 200

function uniquePath(dir: string, stem: string, ext: string): string {
  let p = join(dir, stem + ext)
  for (let i = 2; existsSync(p); i++) p = join(dir, `${stem}-${i}${ext}`)
  return p
}

const mdPathOf = (raw: string): string => raw.replace(/\.raw\.txt$/, '.md')

/**
 * Per-session writer for both files:
 *
 *   <history>/<day>/<HHmmss>_<shell>_<title>.raw.txt   every line of output, timestamped
 *   <history>/<day>/<HHmmss>_<shell>_<title>.md        one entry per finished command
 *
 * The .md only exists for sessions whose shell reports prompt markers. When the date changes
 * mid-session both files continue in the next day's folder with a "continued" note.
 */
export class SessionLog {
  private screen: ScreenLog
  private tracker: CommandTracker
  private raw!: WriteStream
  private md: WriteStream | null = null
  private day = ''
  private idle: ReturnType<typeof setTimeout> | null = null
  private runningTimer: ReturnType<typeof setInterval> | null = null
  private closed = false
  private entryCount = 0
  private redactor: Redactor
  private paused = false
  /** The command that is running now started while logging was paused. */
  private cmdPaused = false
  /** Every raw transcript this session has produced (one per day). */
  private files: string[] = []
  private stem: string
  rawFile = ''

  constructor(
    private meta: SessionMeta,
    private historyDir: () => string,
    private outputLimit: () => number,
    private events: SessionLogEvents,
    options: { redactor?: Redactor; paused?: boolean } = {}
  ) {
    this.redactor = options.redactor ?? new Redactor(DEFAULT_REDACTION_PATTERNS)
    this.screen = new ScreenLog(
      {
        onLine: (l) => {
          const clean = this.redactor.line(l)
          this.writeRaw([clean])
          this.tracker.line(clean)
        },
        onOsc: (p) => this.tracker.osc(p),
        onEnter: (t) => this.tracker.inferred(t)
      },
      meta.rows,
      meta.cols
    )
    this.tracker = new CommandTracker({
      flush: () => this.screen.flush(),
      markAnchor: () => this.screen.markAnchor(),
      infer: meta.shell === 'cmd',
      onCwd: (cwd) => this.events.cwd(meta.sessionId, cwd),
      onStart: (r) => this.onStart(r.command, r.cwd, r.startedAt),
      onFinished: (d) => this.onFinished(d)
    })
    this.stem = `${fileTime(new Date())}_${slug(meta.shell, 12)}_${slug(meta.title)}`
    this.openRaw(null)
    if (options.paused) this.setPaused(true)
  }

  // ---- files -------------------------------------------------------------------------------

  private openRaw(continuedFrom: string | null): void {
    const now = new Date()
    this.day = dateStr(now)
    const dir = join(this.historyDir(), this.day)
    mkdirSync(dir, { recursive: true })
    const stem = continuedFrom
      ? `${fileTime(now)}_${slug(this.meta.shell, 12)}_${slug(this.meta.title)}`
      : this.stem
    this.rawFile = uniquePath(dir, stem, '.raw.txt')
    this.files.push(this.rawFile)
    this.raw = createWriteStream(this.rawFile, { flags: 'a', encoding: 'utf8' })
    const head = [
      `# CIBoard raw transcript — ${this.meta.title}`,
      `# Profile: ${this.meta.profileName}`,
      `# Elevated: ${this.meta.elevated ? 'yes' : 'no'}`,
      `# Started: ${dateTime(now)}`,
      ...(continuedFrom ? [`# Continued from: ${basename(continuedFrom)}`] : []),
      ''
    ].join('\n')
    this.raw.write(head + '\n')
  }

  private openMd(continuedFrom: string | null): void {
    this.entryCount = 0
    this.md = createWriteStream(mdPathOf(this.rawFile), { flags: 'a', encoding: 'utf8' })
    this.md.write(
      formatHeader({
        shell: this.meta.shell,
        title: this.meta.title,
        started: dateTime(new Date()),
        profile: this.meta.profileName,
        elevated: this.meta.elevated,
        continuedFrom: continuedFrom ? basename(mdPathOf(continuedFrom)) : undefined
      })
    )
  }

  private rotate(): void {
    const previous = this.rawFile
    this.raw.end()
    const hadMd = this.md !== null
    this.md?.end()
    this.md = null
    this.openRaw(previous)
    if (hadMd) this.openMd(previous)
  }

  private checkDay(now: Date): void {
    if (dateStr(now) !== this.day) this.rotate()
  }

  // ---- input from the pty ------------------------------------------------------------------

  /** Feed raw pty output. */
  output(data: string): void {
    if (this.closed) return
    this.screen.write(data)
    if (this.tracker.integrated && !this.md) this.openMd(null)
    if (this.idle) clearTimeout(this.idle)
    this.idle = setTimeout(() => this.flushPending(), IDLE_FLUSH_MS)
  }

  resize(cols: number, rows: number): void {
    this.screen.resize(cols, rows)
  }

  private flushPending(): void {
    if (this.idle) clearTimeout(this.idle)
    this.idle = null
    if (!this.closed) this.screen.flush()
  }

  // ---- raw transcript ----------------------------------------------------------------------

  private writeRaw(lines: string[]): void {
    if (this.paused) return
    const now = new Date()
    this.checkDay(now)
    const ts = clockMs(now)
    const text = lines.map((l) => `[${ts}] ${l}\n`).join('')
    this.raw.write(text)
    this.events.append({ sessionId: this.meta.sessionId, file: this.rawFile, text })
  }

  /** Note a lifecycle event (pause/resume, exit) as its own line. */
  note(message: string): void {
    if (this.closed) return
    this.flushPending()
    this.writeRaw([`-- ${message} --`])
  }

  // ---- structured entries ------------------------------------------------------------------

  private onStart(command: string, cwd: string, startedAt: Date): void {
    this.cmdPaused = this.paused
    if (this.paused) return
    this.pushRunning({ command, cwd, startedAt: startedAt.getTime(), output: '' })
    if (this.runningTimer) clearInterval(this.runningTimer)
    this.runningTimer = setInterval(() => this.pushRunning(), RUNNING_PUSH_MS)
  }

  private pushRunning(initial?: HistoryRunning): void {
    const r = this.tracker.running
    if (this.paused || (!r && !initial)) return
    this.events.running(
      this.meta.sessionId,
      initial ?? {
        command: r!.command,
        cwd: r!.cwd,
        startedAt: r!.startedAt.getTime(),
        output: r!.output.slice(-RUNNING_TAIL_LINES).join('\n')
      }
    )
  }

  private onFinished(d: FinishedCommand): void {
    if (this.runningTimer) clearInterval(this.runningTimer)
    this.runningTimer = null
    this.events.running(this.meta.sessionId, null)
    // Nothing is recorded for a command that started or ended while logging was paused.
    if (this.paused || this.cmdPaused) return

    const now = new Date()
    this.checkDay(now)
    if (!this.md) this.openMd(null)
    const lang = fenceLang(this.meta.shell)
    const duration = formatDuration(d.durationMs)
    const time = clock(d.startedAt)
    const cwd = d.cwd || '?'
    const command = this.redactor.text(d.command)
    const output = truncateOutput(d.output, this.outputLimit(), basename(this.rawFile))
    this.md!.write(formatEntry({ time, cwd, exit: d.exit, duration, command, lang, output }))

    const index = this.entryCount++
    this.events.entry(this.meta.sessionId, {
      id: `${this.rawFile}#${index}`,
      file: this.rawFile,
      index,
      date: this.day,
      time,
      cwd,
      exit: d.exit,
      duration,
      command,
      lang,
      output,
      session: `${this.meta.shell} — ${this.meta.title}`
    })
  }

  // ---- privacy -----------------------------------------------------------------------------

  get isPaused(): boolean {
    return this.paused
  }

  setRedactor(redactor: Redactor): void {
    this.redactor = redactor
  }

  private mdNote(message: string): void {
    this.md?.write(`\n> ${message} at ${clock(new Date())}\n`)
  }

  /**
   * Pause or resume logging. Both transitions leave a note in the raw transcript and the .md.
   * While paused nothing is written; on resume whatever sits on screen counts as already logged,
   * so text typed or printed during the pause is never written afterwards.
   */
  setPaused(paused: boolean): void {
    if (this.closed || paused === this.paused) return
    this.flushPending()
    if (paused) {
      this.writeRaw(['-- logging paused --'])
      this.mdNote('Logging paused')
      this.paused = true
    } else {
      this.paused = false
      this.screen.markAllLogged()
      this.writeRaw(['-- logging resumed --'])
      this.mdNote('Logging resumed')
    }
  }

  /** Delete every file of this session and carry on logging into fresh ones. */
  async clear(): Promise<string[]> {
    if (this.closed) return []
    this.screen.markAllLogged()
    const files = [...this.files]
    await this.endStreams()
    for (const f of files) {
      rmSync(f, { force: true })
      rmSync(mdPathOf(f), { force: true })
    }
    this.files = []
    this.entryCount = 0
    this.openRaw(null)
    if (this.paused) this.raw.write('-- logging is paused for this session --\n')
    return files
  }

  /** Raw transcript paths this session has written (for clearing and index removal). */
  get rawFiles(): readonly string[] {
    return this.files
  }

  private async endStreams(): Promise<void> {
    const ends = [this.raw, this.md].filter((s): s is WriteStream => s !== null)
    this.md = null
    await Promise.all(ends.map((s) => new Promise<void>((resolve) => s.end(resolve))))
  }

  async close(): Promise<void> {
    if (this.closed) return
    this.flushPending()
    this.tracker.interrupt()
    this.closed = true
    if (this.idle) clearTimeout(this.idle)
    if (this.runningTimer) clearInterval(this.runningTimer)
    await this.endStreams()
  }
}
