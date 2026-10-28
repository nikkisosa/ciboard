import { Terminal } from '@xterm/xterm'
import { SerializeAddon } from '@xterm/addon-serialize'
import { Unicode11Addon } from '@xterm/addon-unicode11'

type DataListener = (data: string) => void
type SizeListener = (cols: number, rows: number) => void

interface Entry {
  /** Never opened in the DOM: a parsed copy of the session's screen used to bootstrap new views. */
  mirror: Terminal
  serialize: SerializeAddon
  cols: number
  rows: number
  data: Set<DataListener>
  size: Set<SizeListener>
}

const DEFAULT_COLS = 80
const DEFAULT_ROWS = 24

/**
 * Renderer-side fan-out for pty sessions.
 *
 * - Every session has a mirror terminal that sees all output from the first byte, so a view
 *   mounted later (focus panel switching sessions) can start from a serialized snapshot.
 * - The bus owns the session's pty size. Only one view at a time should call `setSize`
 *   (the focus view while active, the tile otherwise); all other views follow `onSize`.
 */
class SessionBus {
  private entries = new Map<string, Entry>()
  private disposed = new Set<(id: string) => void>()

  constructor() {
    window.ciboard.pty.onData((id, d) => this.push(id, d))
    window.ciboard.pty.onExit((id, code) =>
      this.push(id, `\r\n\x1b[2m[process exited with code ${code}]\x1b[0m\r\n`)
    )
  }

  /** Entries are created lazily so output arriving before `pty.create` resolves is not lost. */
  private entry(id: string): Entry {
    let e = this.entries.get(id)
    if (!e) {
      const mirror = new Terminal({
        cols: DEFAULT_COLS,
        rows: DEFAULT_ROWS,
        scrollback: 5000,
        allowProposedApi: true
      })
      const serialize = new SerializeAddon()
      mirror.loadAddon(serialize)
      mirror.loadAddon(new Unicode11Addon())
      mirror.unicode.activeVersion = '11'
      e = {
        mirror,
        serialize,
        cols: DEFAULT_COLS,
        rows: DEFAULT_ROWS,
        data: new Set(),
        size: new Set()
      }
      this.entries.set(id, e)
    }
    return e
  }

  private push(id: string, data: string): void {
    const e = this.entry(id)
    e.mirror.write(data)
    e.data.forEach((l) => l(data))
  }

  onDispose(l: (id: string) => void): () => void {
    this.disposed.add(l)
    return () => this.disposed.delete(l)
  }

  size(id: string): { cols: number; rows: number } {
    const e = this.entry(id)
    return { cols: e.cols, rows: e.rows }
  }

  /** Cursor row on the visible screen (0-based), for views that show only part of it. */
  cursorRow(id: string): number {
    return this.entry(id).mirror.buffer.active.cursorY
  }

  /** Resize the pty (and every follower). No-op when unchanged, so views cannot ping-pong. */
  setSize(id: string, cols: number, rows: number): void {
    const e = this.entry(id)
    if (cols < 2 || rows < 1 || (e.cols === cols && e.rows === rows)) return
    e.cols = cols
    e.rows = rows
    e.mirror.resize(cols, rows)
    e.size.forEach((l) => l(cols, rows))
    window.ciboard.pty.resize(id, cols, rows)
  }

  onSize(id: string, l: SizeListener): () => void {
    const e = this.entry(id)
    e.size.add(l)
    return () => e.size.delete(l)
  }

  onData(id: string, l: DataListener): () => void {
    const e = this.entry(id)
    e.data.add(l)
    return () => e.data.delete(l)
  }

  /**
   * Show a session in `term`: replay the mirror's snapshot, then stream live output with no gap
   * or duplicate. Writes are FIFO, so an empty write acts as a marker: everything before it is in
   * the snapshot, everything after it is queued by this subscription.
   * `term` must already have the session's current cols/rows.
   */
  attach(id: string, term: Terminal): () => void {
    const e = this.entry(id)
    const queued: string[] = []
    let live = false
    let disposed = false
    e.data.add(onLive)
    function onLive(d: string): void {
      if (live) term.write(d)
      else queued.push(d)
    }
    e.mirror.write('', () => {
      if (disposed) return
      term.write(e.serialize.serialize())
      for (const d of queued) term.write(d)
      queued.length = 0
      live = true
    })
    return () => {
      disposed = true
      e.data.delete(onLive)
    }
  }

  dispose(id: string): void {
    this.entries.get(id)?.mirror.dispose()
    this.entries.delete(id)
    this.disposed.forEach((l) => l(id))
  }
}

let bus: SessionBus | null = null
export const sessionBus = (): SessionBus => (bus ??= new SessionBus())
