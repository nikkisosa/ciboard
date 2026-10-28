import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { HistoryEntry, HistoryFileInfo, HistoryRunning } from '@shared/types'
import { workspace, type WorkspaceState } from '../workspace'

const MAX_RAW_LINES = 5000
const MAX_OUTPUT_LINES = 1000
const ACTIVE = 'active'

const LINE_RE = /^\[(\d\d:\d\d:\d\d\.\d{3})\] (.*)$/
const splitLines = (text: string): string[] =>
  text.split(/\r?\n/).filter((l, i, a) => l || i < a.length - 1)

const copy = (text: string): void => void navigator.clipboard.writeText(text)

function RawLine({ line }: { line: string }): React.JSX.Element {
  const m = LINE_RE.exec(line)
  if (m) {
    return (
      <div className={`hl${m[2].startsWith('-- ') ? ' note' : ''}`}>
        <span className="hl-ts">{m[1]}</span>
        {m[2]}
      </div>
    )
  }
  return <div className="hl meta">{line}</div>
}

function clip(output: string): string {
  const lines = output.split('\n')
  if (lines.length <= MAX_OUTPUT_LINES) return output
  return (
    lines.slice(0, MAX_OUTPUT_LINES).join('\n') +
    `\n[… ${lines.length - MAX_OUTPUT_LINES} more lines — open the file to see all]`
  )
}

interface RowProps {
  entry: HistoryEntry
  defaultOpen: boolean
  showSession: boolean
  canRerun: boolean
  onRerun: (command: string) => void
}

function EntryRow({
  entry,
  defaultOpen,
  showSession,
  canRerun,
  onRerun
}: RowProps): React.JSX.Element {
  const [open, setOpen] = useState<boolean | null>(null)
  const expanded = open ?? defaultOpen
  const unknown = entry.exit === '?'
  const ok = entry.exit === '0'
  return (
    <div className="entry">
      <div className="entry-head" onClick={() => setOpen(!expanded)}>
        <span className="entry-twist">{entry.output ? (expanded ? '▾' : '▸') : ' '}</span>
        <span className="entry-time">
          {showSession ? `${entry.date} ` : ''}
          {entry.time}
        </span>
        <span className="entry-cwd" title={entry.cwd}>
          {`‎${entry.cwd}`}
        </span>
        <code className="entry-cmd" title={entry.command}>
          {entry.command}
        </code>
        {showSession && <span className="entry-session">{entry.session}</span>}
        <span className={`exit ${unknown ? 'unknown' : ok ? 'ok' : 'fail'}`}>
          {unknown ? 'exit ?' : `exit ${entry.exit}`}
        </span>
        <span className="entry-dur">{entry.duration}</span>
        <span className="entry-actions" onClick={(e) => e.stopPropagation()}>
          <button className="icon-btn" title="Copy command" onClick={() => copy(entry.command)}>
            ⧉
          </button>
          <button
            className="icon-btn"
            title="Copy output"
            disabled={!entry.output}
            onClick={() => copy(entry.output)}
          >
            ❐
          </button>
          <button
            className="icon-btn"
            title={canRerun ? 'Re-run in the active session' : 'No active session'}
            disabled={!canRerun}
            onClick={() => onRerun(entry.command)}
          >
            ↻
          </button>
        </span>
      </div>
      {expanded && entry.output && <pre className="entry-out">{clip(entry.output)}</pre>}
    </div>
  )
}

function RunningRow({ r }: { r: HistoryRunning }): React.JSX.Element {
  const [now, setNow] = useState(Date.now())
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 500)
    return () => clearInterval(t)
  }, [])
  const secs = Math.max(0, (now - r.startedAt) / 1000)
  return (
    <div className="entry running">
      <div className="entry-head">
        <span className="entry-twist spin">◌</span>
        <span className="entry-time">{new Date(r.startedAt).toTimeString().slice(0, 8)}</span>
        <span className="entry-cwd" title={r.cwd}>
          {`‎${r.cwd}`}
        </span>
        <code className="entry-cmd">{r.command}</code>
        <span className="exit running">running</span>
        <span className="entry-dur">{secs.toFixed(1)}s</span>
      </div>
      {r.output && <pre className="entry-out">{clip(r.output)}</pre>}
    </div>
  )
}

export function HistoryPanel({ ws }: { ws: WorkspaceState }): React.JSX.Element {
  const open = ws.ui.historyOpen
  const tile = ws.tiles.find((t) => t.id === ws.activeTileId)
  const sessionId = tile ? (ws.runtime[tile.id]?.sessionId ?? null) : null
  const profile = tile ? ws.profiles.find((p) => p.id === tile.profileId) : undefined

  const [files, setFiles] = useState<HistoryFileInfo[]>([])
  const [mode, setMode] = useState<string>(ACTIVE)
  const [activeRaw, setActiveRaw] = useState<string | null>(null)
  const [entries, setEntries] = useState<HistoryEntry[]>([])
  const [running, setRunning] = useState<HistoryRunning | null>(null)
  const [rawLines, setRawLines] = useState<string[]>([])
  const [rawView, setRawView] = useState(false)
  const [query, setQuery] = useState('')
  const [allSessions, setAllSessions] = useState(false)
  const [results, setResults] = useState<HistoryEntry[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [reload, setReload] = useState(0)
  const scroller = useRef<HTMLDivElement>(null)
  const stick = useRef(true)

  const isActive = mode === ACTIVE
  const rawFile = isActive ? activeRaw : mode
  const selectedInfo = files.find((f) => f.file === mode)
  // Custom profiles get no shell integration, so their history is the raw transcript only.
  const integrated = isActive ? profile?.kind !== 'custom' : (selectedInfo?.hasMd ?? false)
  const showRaw = rawView || !integrated

  const refreshFiles = useCallback(() => {
    void window.ciboard.history.list().then(setFiles)
  }, [])

  useEffect(() => {
    if (open) refreshFiles()
  }, [open, refreshFiles])

  // Load the selected session and, for the active one, follow it live.
  useEffect(() => {
    if (!open) return
    let cancelled = false
    const offs: (() => void)[] = []
    setError(null)
    setEntries([])
    setRunning(null)
    setRawLines([])
    refreshFiles()

    const load = async (): Promise<void> => {
      try {
        let file: string | null = mode
        if (isActive) {
          if (!sessionId) {
            setActiveRaw(null)
            return
          }
          offs.push(
            window.ciboard.history.onEntry((e) => {
              if (e.sessionId !== sessionId) return
              setEntries((prev) =>
                prev.some((x) => x.id === e.entry.id) ? prev : [...prev, e.entry]
              )
            }),
            window.ciboard.history.onRunning((e) => {
              if (e.sessionId === sessionId) setRunning(e.running)
            }),
            window.ciboard.history.onAppend((e) => {
              if (e.sessionId !== sessionId) return
              setActiveRaw(e.file)
              setRawLines((prev) => [...prev, ...splitLines(e.text)].slice(-MAX_RAW_LINES))
            })
          )
          file = await window.ciboard.history.sessionFile(sessionId)
          if (cancelled) return
          setActiveRaw(file)
        }
        if (!file) return
        const [loaded, raw] = await Promise.all([
          window.ciboard.history.entries(file),
          window.ciboard.history.read(file)
        ])
        if (cancelled) return
        // Keep anything that arrived live while loading (ids are unique per file+index).
        setEntries((prev) => [...loaded, ...prev.filter((p) => !loaded.some((l) => l.id === p.id))])
        setRawLines((prev) => {
          const base = splitLines(raw)
          const extra = prev.filter((l) => !base.includes(l))
          return [...base, ...extra].slice(-MAX_RAW_LINES)
        })
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e))
      }
    }
    void load()
    return () => {
      cancelled = true
      offs.forEach((o) => o())
    }
  }, [open, mode, sessionId, isActive, refreshFiles, reload])

  // Debounced search: this session only, or everything in the history folder.
  useEffect(() => {
    const q = query.trim()
    if (!open || !q) {
      setResults(null)
      return
    }
    const t = setTimeout(() => {
      const scope = allSessions ? null : rawFile ? [rawFile] : []
      void window.ciboard.history.search(q, scope).then(setResults)
    }, 150)
    return () => clearTimeout(t)
  }, [open, query, allSessions, rawFile, entries.length])

  useLayoutEffect(() => {
    const el = scroller.current
    if (el && stick.current) el.scrollTop = el.scrollHeight
  }, [entries, running, rawLines, results, showRaw])

  const rerun = useCallback(
    (command: string) => {
      if (sessionId) window.ciboard.pty.write(sessionId, command + '\r')
    },
    [sessionId]
  )

  const label = (f: HistoryFileInfo): string =>
    `${f.date} ${f.time} · ${f.shell} · ${f.title}${f.hasMd ? '' : ' (raw only)'}`

  const searching = results !== null
  const list = searching ? results : entries

  return (
    <>
      <header className="region-title history-bar">
        <span>History</span>
        {open && (
          <>
            <select
              value={mode}
              onChange={(e) => setMode(e.target.value)}
              onFocus={refreshFiles}
              title="Session to show"
            >
              <option value={ACTIVE}>Active session{tile ? ` — ${tile.title}` : ''}</option>
              {files.map((f) => (
                <option key={f.file} value={f.file}>
                  {label(f)}
                </option>
              ))}
            </select>
            <input
              className="history-search"
              type="search"
              placeholder="Search commands and output…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
            <label className="check-inline" title="Search every session in the history folder">
              <input
                type="checkbox"
                checked={allSessions}
                onChange={(e) => setAllSessions(e.target.checked)}
              />
              all sessions
            </label>
            {integrated && (
              <label className="check-inline" title="Show the raw timestamped transcript">
                <input
                  type="checkbox"
                  checked={rawView}
                  onChange={(e) => setRawView(e.target.checked)}
                />
                raw
              </label>
            )}
            <button
              disabled={!rawFile}
              onClick={() =>
                rawFile && void window.ciboard.history.open(rawFile, showRaw ? 'raw' : 'md')
              }
              title="Open this session's file in the default app"
            >
              Open in editor
            </button>
            <button onClick={() => void window.ciboard.history.openFolder()}>Open folder</button>
            <button
              disabled={!rawFile}
              title="Save this session as one combined Markdown file"
              onClick={() => rawFile && void window.ciboard.history.export(rawFile)}
            >
              Export
            </button>
            <button
              className="danger"
              disabled={!rawFile}
              title="Delete this session's history files"
              onClick={() =>
                rawFile &&
                void window.ciboard.history.clearSession(rawFile).then((deleted) => {
                  if (!deleted) return
                  if (!isActive) setMode(ACTIVE)
                  setReload((n) => n + 1)
                })
              }
            >
              Delete
            </button>
          </>
        )}
        <span className="grow" />
        <button
          className="icon-btn"
          title={open ? 'Collapse history' : 'Expand history'}
          onClick={() => workspace.setUi({ historyOpen: !open })}
        >
          {open ? '▾' : '▴'}
        </button>
      </header>
      {open && (
        <div
          className="region-body history-body"
          ref={scroller}
          onScroll={(e) => {
            const el = e.currentTarget
            stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 24
          }}
        >
          {error && <div className="pad">{error}</div>}
          {!error && showRaw && !searching && (
            <>
              {rawLines.length === 0 && (
                <div className="muted pad">
                  {isActive && !sessionId ? 'No active session.' : 'Nothing recorded yet.'}
                </div>
              )}
              {rawLines.map((l, i) => (
                <RawLine key={i} line={l} />
              ))}
            </>
          )}
          {!error && (!showRaw || searching) && (
            <>
              {searching && (
                <div className="muted pad-sm">
                  {list.length} result{list.length === 1 ? '' : 's'} for “{query.trim()}”{' '}
                  {allSessions ? 'in all sessions' : 'in this session'}
                </div>
              )}
              {!searching && list.length === 0 && !running && (
                <div className="muted pad">
                  {isActive && !sessionId
                    ? 'No active session.'
                    : 'No commands recorded yet. Run a command in the terminal.'}
                </div>
              )}
              {list.map((e, i) => (
                <EntryRow
                  key={e.id}
                  entry={e}
                  defaultOpen={!searching && i === list.length - 1 && !running}
                  showSession={searching && allSessions}
                  canRerun={!!sessionId}
                  onRerun={rerun}
                />
              ))}
              {!searching && running && <RunningRow r={running} />}
            </>
          )}
        </div>
      )}
    </>
  )
}
