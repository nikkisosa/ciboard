import { useEffect, useRef, useState } from 'react'
import { sessionBus } from '../sessionBus'
import { useAppearance } from '../settingsStore'
import { attachContextPaste, createTerminal, followAppearance } from '../terminalFactory'
import { workspace } from '../workspace'

/** Smallest scale at which a tile still shows legible text (14px font -> ~8.4px). */
const MIN_READABLE_SCALE = 0.6

interface Props {
  sessionId: string
  /**
   * True when this tile decides the pty size (the session is not shown in the focus panel).
   * Otherwise the tile is a read-write view of a pty sized by the focus panel, scaled to fit.
   */
  ownsSize: boolean
}

/** Live view with the pty's exact cols x rows, shrunk with a CSS transform to fit the tile. */
export function ScaledTerminal({ sessionId, ownsSize }: Props): React.JSX.Element {
  const box = useRef<HTMLDivElement>(null)
  const inner = useRef<HTMLDivElement>(null)
  const relayout = useRef<() => void>(() => {})
  const owns = useRef(ownsSize)
  owns.current = ownsSize
  const [view, setView] = useState({ scale: 1, w: 0, h: 0, y: 0 })

  useEffect(() => {
    const boxEl = box.current!
    const bus = sessionBus()
    const term = createTerminal({ cursorBlink: false, scrollback: 1000 })
    term.open(inner.current!)
    const offMenu = attachContextPaste(term, boxEl)
    const start = bus.size(sessionId)
    term.resize(start.cols, start.rows)
    const detach = bus.attach(sessionId, term)

    let cellW = 0
    let cellH = 0
    let sizeTimer: ReturnType<typeof setTimeout> | null = null

    const measure = (): boolean => {
      const screen = inner.current?.querySelector<HTMLElement>('.xterm-screen')
      if (!screen || !screen.offsetWidth || !term.cols || !term.rows) return false
      cellW = screen.offsetWidth / term.cols
      cellH = screen.offsetHeight / term.rows
      return true
    }

    const layout = (): void => {
      if (!cellW && !measure()) {
        requestAnimationFrame(layout) // renderer has not painted yet
        return
      }
      const { cols, rows } = bus.size(sessionId)
      const natW = cols * cellW
      const natH = rows * cellH
      const bw = boxEl.clientWidth
      const bh = boxEl.clientHeight
      if (!bw || !bh) return
      // The pty is sized to the focus panel, so this is a smaller copy of it. Fit the copy to the
      // tile's WIDTH (lines are never cut off) and, if that is taller than the tile, show the
      // rows around the cursor instead of shrinking everything until it is unreadable. The focus
      // panel always shows the whole screen. Never go below a legible size.
      const scale = owns.current
        ? Math.min(1, bw / natW, bh / natH)
        : Math.max(Math.min(1, bw / natW), MIN_READABLE_SCALE)
      const shown = bh / (cellH * scale) // rows that fit at this scale
      const top =
        shown >= rows
          ? 0
          : Math.min(rows - shown, Math.max(0, bus.cursorRow(sessionId) - shown + 2))
      setView({ scale, w: natW, h: natH, y: -top * cellH * scale })
      if (owns.current) {
        if (sizeTimer) clearTimeout(sizeTimer)
        sizeTimer = setTimeout(
          () => bus.setSize(sessionId, Math.floor(bw / cellW), Math.floor(bh / cellH)),
          80
        )
      }
    }
    relayout.current = layout
    // A new font changes the cell size: measure again, then fit.
    const offLook = followAppearance(term, () => {
      cellW = 0
      cellH = 0
      layout()
    })

    // Output moves the cursor, which moves the visible window of a cropped view.
    let frame = 0
    const offData = bus.onData(sessionId, () => {
      if (owns.current || frame) return
      frame = requestAnimationFrame(() => {
        frame = 0
        layout()
      })
    })

    const offSize = bus.onSize(sessionId, (c, r) => {
      term.resize(c, r)
      layout()
    })
    const input = term.onData((d) => workspace.input(sessionId, d))
    const ro = new ResizeObserver(layout)
    ro.observe(boxEl)
    layout()

    return () => {
      if (sizeTimer) clearTimeout(sizeTimer)
      ro.disconnect()
      cancelAnimationFrame(frame)
      offData()
      offSize()
      offLook()
      offMenu()
      input.dispose()
      detach()
      term.dispose()
    }
  }, [sessionId])

  // Losing (or gaining) the focus panel changes who owns the pty size.
  useEffect(() => relayout.current(), [ownsSize])

  const { background } = useAppearance()
  return (
    <div className="scaled-box" ref={box} style={{ background }}>
      <div
        className="scaled-inner"
        ref={inner}
        style={{
          width: view.w || undefined,
          height: view.h || undefined,
          transform: `translateY(${view.y}px) scale(${view.scale})`
        }}
      />
    </div>
  )
}
