import { useEffect, useRef, useState } from 'react'
import { FitAddon } from '@xterm/addon-fit'
import { SearchAddon, type ISearchOptions } from '@xterm/addon-search'
import type { Terminal } from '@xterm/xterm'
import { sessionBus } from '../sessionBus'
import { useAppearance } from '../settingsStore'
import {
  attachContextPaste,
  createTerminal,
  followAppearance,
  handleClipboardKey,
  isAppShortcut
} from '../terminalFactory'
import { workspace } from '../workspace'

interface Props {
  sessionId: string
  /** Bumped to ask the terminal to grab keyboard focus. */
  focusNonce: number
}

const MATCH_COLORS: ISearchOptions['decorations'] = {
  matchBackground: '#515c6a',
  matchOverviewRuler: '#d18616',
  activeMatchBackground: '#ea5c00',
  activeMatchColorOverviewRuler: '#a0a0a0'
}

/** Full-size interactive view. While mounted it owns the session's pty size. */
export function FocusTerminal({ sessionId, focusNonce }: Props): React.JSX.Element {
  const host = useRef<HTMLDivElement>(null)
  const termRef = useRef<Terminal | null>(null)
  const searchRef = useRef<SearchAddon | null>(null)
  const findInput = useRef<HTMLInputElement>(null)
  const [findOpen, setFindOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [found, setFound] = useState<boolean | null>(null)

  useEffect(() => {
    const el = host.current!
    const bus = sessionBus()
    const term = createTerminal({ cursorBlink: true })
    const fit = new FitAddon()
    const search = new SearchAddon()
    term.loadAddon(fit)
    term.loadAddon(search)
    term.open(el)
    termRef.current = term
    searchRef.current = search

    // Ctrl+Shift+F opens find (plain Ctrl+F stays readline's "forward-char" for the shell).
    term.attachCustomKeyEventHandler((e) => {
      if (e.type === 'keydown' && e.ctrlKey && e.shiftKey && e.key.toUpperCase() === 'F') {
        setFindOpen(true)
        setTimeout(() => findInput.current?.select(), 0)
        return false
      }
      return !handleClipboardKey(term, e) && !isAppShortcut(e)
    })
    const offMenu = attachContextPaste(term, el)

    const refit = (): void => {
      try {
        fit.fit()
      } catch {
        return
      }
      bus.setSize(sessionId, term.cols, term.rows)
    }
    refit() // sets mirror + pty size first, so the snapshot below matches this view
    const detach = bus.attach(sessionId, term)
    const input = term.onData((d) => workspace.input(sessionId, d))
    const offLook = followAppearance(term, refit)
    const ro = new ResizeObserver(refit)
    ro.observe(el)
    term.focus()

    return () => {
      offMenu()
      offLook()
      ro.disconnect()
      input.dispose()
      detach()
      termRef.current = null
      searchRef.current = null
      term.dispose()
    }
  }, [sessionId])

  useEffect(() => {
    termRef.current?.focus()
  }, [focusNonce])

  const find = (backwards: boolean, incremental = false, text = query): void => {
    if (!text) {
      searchRef.current?.clearDecorations()
      setFound(null)
      return
    }
    const opts: ISearchOptions = { incremental, decorations: MATCH_COLORS }
    setFound(
      backwards
        ? (searchRef.current?.findPrevious(text, opts) ?? false)
        : (searchRef.current?.findNext(text, opts) ?? false)
    )
  }

  const closeFind = (): void => {
    searchRef.current?.clearDecorations()
    setFindOpen(false)
    setFound(null)
    termRef.current?.focus()
  }

  const { background } = useAppearance()
  return (
    <div className="term-wrap">
      <div className="term-host" ref={host} style={{ background }} />
      {findOpen && (
        <div className="findbar">
          <input
            ref={findInput}
            autoFocus
            placeholder="Find in terminal"
            value={query}
            className={found === false ? 'invalid' : ''}
            onChange={(e) => {
              setQuery(e.target.value)
              find(false, true, e.target.value) // search as you type
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') find(e.shiftKey)
              else if (e.key === 'Escape') closeFind()
              e.stopPropagation()
            }}
          />
          <button className="icon-btn" title="Previous (Shift+Enter)" onClick={() => find(true)}>
            ↑
          </button>
          <button className="icon-btn" title="Next (Enter)" onClick={() => find(false)}>
            ↓
          </button>
          <button className="icon-btn" title="Close (Esc)" onClick={closeFind}>
            ×
          </button>
        </div>
      )}
    </div>
  )
}
