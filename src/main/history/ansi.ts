/**
 * Minimal virtual screen used only for logging.
 *
 * ConPTY does not forward a clean byte stream: it repaints the screen with absolute cursor
 * positioning, erases and re-draws rows after resizes, and addresses the cursor in the
 * coordinates of its own wrapped buffer. Stripping escapes from that stream yields duplicated and
 * glued-together lines, so output is replayed onto a screen model of the same width and rows are
 * logged as logical lines (wrapped rows joined) when they scroll off the top, or (changed rows
 * only) when output goes quiet.
 *
 * Deliberately not a full emulator: colours, scroll regions, wide characters and the alternate
 * screen are not modelled. Alternate-screen apps (vim, less) are not logged.
 */

type State = 'text' | 'esc' | 'csi' | 'str' | 'strEsc' | 'skip1'

/** After a resize ConPTY repaints the screen at new row positions; ignore repeats for this long. */
const RESYNC_MS = 1500
const RECENT_MAX = 400

export interface ScreenHooks {
  /** A finished (or flushed) line of plain text. */
  onLine(line: string): void
  /** Payload of an OSC sequence, without the `ESC ]` and terminator. */
  onOsc?(payload: string): void
  /** Enter was pressed after `markAnchor()`: `text` is what was typed after the prompt. */
  onEnter?(text: string): void
}

interface Row {
  cells: string[]
  /** This row ended by auto-wrap: the next row continues the same logical line. */
  wrapped: boolean
  /** Text of the logical line starting here that was last written to the log. */
  logged: string | null
}

const newRow = (): Row => ({ cells: [], wrapped: false, logged: null })

export class ScreenLog {
  private rows: Row[] = []
  private cursorRow = 0
  private col = 0
  private saved = { row: 0, col: 0 }
  private state: State = 'text'
  private csi = ''
  private osc = ''
  private alt = false
  private lastWasBlank = true
  private dirty = false
  /** Prompt text left of the cursor at marker B; Enter is recognised by it. */
  private anchor: { prompt: string } | null = null
  private resyncUntil = 0
  /** Output arrived inside a resync window; dedupe until the next flush logs it. */
  private repainting = false
  private recent: string[] = []
  /** The row now at the top continues a logical line whose first row already scrolled off. */
  private topContinues = false

  constructor(
    private hooks: ScreenHooks,
    private height = 24,
    private cols = 80
  ) {
    for (let i = 0; i < height; i++) this.rows.push(newRow())
  }

  get inAltScreen(): boolean {
    return this.alt
  }

  resize(cols: number, rows: number): void {
    rows = Math.max(1, rows)
    this.cols = Math.max(2, cols)
    this.resyncUntil = Date.now() + RESYNC_MS
    const was = this.repainting
    this.repainting = true // rows pushed off by a shrink are not output: skip blanks
    while (this.rows.length > rows) {
      if (this.cursorRow < this.rows.length - 1) {
        // Like a real terminal: empty space below the cursor goes first, content stays put.
        if (this.rows[this.rows.length - 1].cells.length) this.emitRow(this.rows.length - 1)
        this.rows.pop()
      } else {
        this.emitRow(0)
        this.dropTopRow()
      }
    }
    while (this.rows.length < rows) this.rows.push(newRow())
    this.repainting = was
    this.height = rows
    this.cursorRow = Math.min(this.cursorRow, rows - 1)
    this.col = Math.min(this.col, this.cols)
  }

  write(data: string): void {
    if (Date.now() < this.resyncUntil) this.repainting = true
    for (const ch of data) this.feed(ch)
  }

  private feed(ch: string): void {
    const c = ch.charCodeAt(0)
    switch (this.state) {
      case 'text':
        if (c === 0x1b) this.state = 'esc'
        else this.text(ch, c)
        break
      case 'esc':
        this.escape(ch)
        break
      case 'csi':
        if (c >= 0x40 && c <= 0x7e) {
          this.state = 'text'
          this.runCsi(ch, this.csi)
        } else if (c === 0x1b) {
          this.state = 'esc' // aborted sequence
        } else {
          this.csi += ch
        }
        break
      case 'str':
        if (c === 0x07) this.endString()
        else if (c === 0x1b) this.state = 'strEsc'
        else this.osc += ch
        break
      case 'strEsc':
        if (ch === '\\') this.endString()
        else {
          this.osc += '\x1b' + ch
          this.state = 'str'
        }
        break
      case 'skip1':
        this.state = 'text'
        break
    }
  }

  private endString(): void {
    this.state = 'text'
    const payload = this.osc
    this.osc = ''
    if (payload.startsWith('\u0000')) return
    this.hooks.onOsc?.(payload)
  }

  private escape(ch: string): void {
    this.state = 'text'
    switch (ch) {
      case '[':
        this.csi = ''
        this.state = 'csi'
        break
      case ']':
        this.osc = ''
        this.state = 'str'
        break
      case 'P':
      case '^':
      case '_':
      case 'X':
        this.osc = '\u0000' // DCS/PM/APC: swallow, never reported as OSC
        this.state = 'str'
        break
      case '7':
        this.saved = { row: this.cursorRow, col: this.col }
        break
      case '8':
        this.cursorRow = this.saved.row
        this.col = this.saved.col
        break
      case 'M':
        if (this.cursorRow === 0) this.insertRows(0, 1)
        else this.cursorRow--
        break
      case 'c':
        this.flush()
        break
      default:
        if ('()*+-./#%'.includes(ch)) this.state = 'skip1'
    }
  }

  private text(ch: string, c: number): void {
    switch (c) {
      case 0x0a:
        this.hardLineFeed()
        return
      case 0x0d:
        this.col = 0
        return
      case 0x08:
        this.col = Math.max(0, this.col - 1)
        return
      case 0x09:
        this.col = Math.min(this.cols - 1, (Math.floor(this.col / 8) + 1) * 8)
        return
    }
    if (c < 0x20 || c === 0x7f || this.alt) return
    if (this.col >= this.cols) {
      // Deferred auto-wrap: the cursor sat past the last column until this character arrived.
      this.rows[this.cursorRow].wrapped = true
      this.col = 0
      this.moveDown()
    }
    const row = this.rows[this.cursorRow]
    while (row.cells.length < this.col) row.cells.push(' ')
    row.cells[this.col++] = ch
    this.dirty = true
  }

  /** Remember the cursor position (end of the prompt) to read the typed command back later. */
  markAnchor(): void {
    this.anchor = { prompt: this.lineTextThroughCursor() }
  }

  /** Text of the logical line containing the cursor, from its first row up to the cursor. */
  private lineTextThroughCursor(): string {
    const start = this.lineStart(this.cursorRow)
    let text = ''
    for (let r = start; r < this.cursorRow; r++) text += this.rowString(r)
    return text + this.rows[this.cursorRow].cells.slice(0, this.col).join('')
  }

  /** An explicit LF (end of a logical line, possibly Enter on the command line). */
  private hardLineFeed(): void {
    const a = this.anchor
    if (a) {
      // Only a line that still begins with the prompt and has text after it is a typed command.
      // Anything else (ConPTY repaints re-wrapping the screen after a resize) is ignored.
      const line = this.logicalText(this.lineStart(this.cursorRow), false)
      const typed = line.startsWith(a.prompt) ? line.slice(a.prompt.length).trim() : ''
      if (typed) {
        this.anchor = null
        this.hooks.onEnter?.(typed)
      }
    }
    this.rows[this.cursorRow].wrapped = false
    this.moveDown()
  }

  private moveDown(): void {
    if (this.cursorRow < this.height - 1) this.cursorRow++
    else this.scrollUp()
  }

  private scrollUp(): void {
    if (!this.alt) this.emitRow(0)
    const cursor = this.cursorRow // a scroll leaves the cursor on the same screen row
    this.dropTopRow()
    this.rows.push(newRow())
    this.cursorRow = cursor
  }

  /** Remove row 0, remembering whether the new top row continues a wrapped line. */
  private dropTopRow(): void {
    this.topContinues = this.rows[0].wrapped
    this.rows.shift()
    this.cursorRow = Math.max(0, this.cursorRow - 1)
  }

  private insertRows(at: number, n: number): void {
    for (let i = 0; i < n; i++) {
      this.rows.splice(at, 0, newRow())
      this.rows.pop()
    }
  }

  private deleteRows(at: number, n: number): void {
    for (let i = 0; i < n; i++) {
      this.rows.splice(at, 1)
      this.rows.push(newRow())
    }
  }

  // ---- logical lines -----------------------------------------------------------------------

  private lineStart(r: number): number {
    while (r > 0 && this.rows[r - 1].wrapped) r--
    return r
  }

  /** One row as a string, padded to the full width when it wrapped on. */
  private rowString(r: number): string {
    const row = this.rows[r]
    const s = row.cells.join('')
    return row.wrapped ? s.padEnd(this.cols, ' ') : s
  }

  private logicalText(start: number, trim = true): string {
    let text = ''
    let r = start
    for (;;) {
      text += this.rowString(r)
      if (!this.rows[r].wrapped || r >= this.rows.length - 1) break
      r++
    }
    return trim ? text.trimEnd() : text
  }

  /** Log the row about to leave the screen (as a whole logical line when it starts one). */
  private emitRow(r: number): void {
    if (r === 0 && this.topContinues) return // its first row was logged when it scrolled off
    if (r > 0 && this.rows[r - 1].wrapped) return
    const text = this.logicalText(r)
    if (text) {
      if (text !== this.rows[r].logged) this.out(text)
      this.lastWasBlank = false
    } else if (!this.lastWasBlank && !this.repainting) {
      this.hooks.onLine('')
      this.lastWasBlank = true
    }
  }

  /** Emit a non-empty line, unless it is a post-resize repaint of something already logged. */
  private out(text: string): boolean {
    if (this.repainting && this.recent.includes(text)) return false
    this.recent.push(text)
    if (this.recent.length > RECENT_MAX) this.recent.shift()
    this.hooks.onLine(text)
    return true
  }

  /** Treat everything currently on screen as already logged (used when logging resumes). */
  markAllLogged(): void {
    for (let r = 0; r < this.rows.length; r++) {
      if (r > 0 && this.rows[r - 1].wrapped) continue
      this.rows[r].logged = this.logicalText(r)
    }
    this.dirty = false
    this.repainting = false
  }

  /** Log lines whose text changed since they were last logged (prompt, partial output, ...). */
  flush(): void {
    if (!this.dirty || this.alt) return
    this.dirty = false
    for (let r = 0; r < this.rows.length; r++) {
      if (r > 0 && this.rows[r - 1].wrapped) continue
      if (r === 0 && this.topContinues) continue
      const text = this.logicalText(r)
      if (text && text !== this.rows[r].logged) {
        this.out(text)
        this.rows[r].logged = text
        this.lastWasBlank = false
      }
    }
    this.repainting = false
  }

  // ---- CSI ---------------------------------------------------------------------------------

  private clamp(col: number): number {
    return Math.max(0, Math.min(this.cols - 1, col))
  }

  private runCsi(final: string, raw: string): void {
    const priv = /^[?<=>]/.test(raw) ? raw[0] : ''
    const nums = raw
      .slice(priv.length)
      .split(';')
      .map((p) => (p === '' ? 0 : parseInt(p, 10) || 0))
    const n = (i: number, def = 1): number => (nums[i] ? nums[i] : def)
    const row = this.rows[this.cursorRow]

    if (priv === '?') {
      if (final === 'h' || final === 'l') {
        const altCodes = [47, 1047, 1049]
        if (nums.some((x) => altCodes.includes(x))) {
          this.flush()
          this.alt = final === 'h'
        }
      }
      return
    }
    if (priv) return

    switch (final) {
      case 'A':
        this.cursorRow = Math.max(0, this.cursorRow - n(0))
        break
      case 'B':
      case 'e':
        this.cursorRow = Math.min(this.height - 1, this.cursorRow + n(0))
        break
      case 'C':
      case 'a':
        this.col = this.clamp(this.col + n(0))
        break
      case 'D':
        this.col = this.clamp(this.col - n(0))
        break
      case 'E':
        this.cursorRow = Math.min(this.height - 1, this.cursorRow + n(0))
        this.col = 0
        break
      case 'F':
        this.cursorRow = Math.max(0, this.cursorRow - n(0))
        this.col = 0
        break
      case 'G':
      case '`':
        this.col = this.clamp(n(0) - 1)
        break
      case 'd':
        this.cursorRow = Math.min(this.height - 1, n(0) - 1)
        break
      case 'H':
      case 'f':
        this.cursorRow = Math.min(this.height - 1, n(0) - 1)
        this.col = this.clamp(n(1) - 1)
        break
      case 'K': {
        const mode = nums[0] ?? 0
        if (mode === 0) row.cells.length = Math.min(row.cells.length, this.col)
        else if (mode === 1)
          for (let i = 0; i <= Math.min(this.col, row.cells.length - 1); i++) row.cells[i] = ' '
        else row.cells.length = 0
        row.wrapped = false
        this.dirty = true
        break
      }
      case 'J': {
        const mode = nums[0] ?? 0
        this.flush() // keep whatever was on screen before it is wiped
        const wipe = (r: number): void => {
          this.rows[r].cells = []
          this.rows[r].wrapped = false
        }
        if (mode === 0) {
          row.cells.length = Math.min(row.cells.length, this.col)
          row.wrapped = false
          for (let r = this.cursorRow + 1; r < this.height; r++) wipe(r)
        } else if (mode === 1) {
          for (let r = 0; r < this.cursorRow; r++) wipe(r)
        } else {
          for (let r = 0; r < this.height; r++) wipe(r)
        }
        break
      }
      case 'X':
        for (let i = 0; i < n(0); i++)
          if (this.col + i < row.cells.length) row.cells[this.col + i] = ' '
        break
      case 'P':
        row.cells.splice(this.col, n(0))
        this.dirty = true
        break
      case '@':
        row.cells.splice(this.col, 0, ...Array<string>(n(0)).fill(' '))
        this.dirty = true
        break
      case 'L':
        this.insertRows(this.cursorRow, n(0))
        break
      case 'M':
        this.deleteRows(this.cursorRow, n(0))
        break
      case 'S':
        for (let i = 0; i < n(0); i++) this.scrollUp()
        break
      case 'T':
        this.insertRows(0, n(0))
        break
      case 's':
        this.saved = { row: this.cursorRow, col: this.col }
        break
      case 'u':
        this.cursorRow = this.saved.row
        this.col = this.saved.col
        break
    }
  }
}
