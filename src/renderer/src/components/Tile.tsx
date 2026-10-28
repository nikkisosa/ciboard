import { useState } from 'react'
import type { Profile, TileState } from '@shared/types'
import { workspace, type TileRuntime } from '../workspace'
import { ScaledTerminal } from './ScaledTerminal'
import { ContextBanner, ContextChip, useContextCritical } from './ContextAlert'
import { UsageChip } from './StatusBar'

interface Props {
  tile: TileState
  profile: Profile | undefined
  runtime: TileRuntime | undefined
  active: boolean
  /** True when the focus panel is open, so the active tile does not own its pty size. */
  focusOpen: boolean
  /** This tile takes part in broadcast input. */
  broadcast: boolean
}

/** Elevated for real once running; before that, whatever the user asked for. */
export const isElevated = (tile: TileState, runtime: TileRuntime | undefined): boolean =>
  runtime?.elevated ?? !!tile.admin

export function Tile({
  tile,
  profile,
  runtime,
  active,
  focusOpen,
  broadcast
}: Props): React.JSX.Element {
  const [renaming, setRenaming] = useState(false)
  const status = runtime?.status ?? 'starting'
  const elevated = isElevated(tile, runtime)
  const critical = useContextCritical(runtime?.sessionId ?? null)

  const close = (): void => {
    if (
      workspace.isRunning(tile.id) &&
      !window.confirm(`"${tile.title}" is still running. Close it?`)
    )
      return
    workspace.closeTile(tile.id)
  }

  return (
    <div
      className={`tile${active ? ' active' : ''}${elevated ? ' admin' : ''}${broadcast ? ' broadcast' : ''}${critical ? ' ctx-critical' : ''}`}
      onMouseDown={() => workspace.setActive(tile.id)}
      onFocus={() => workspace.setActive(tile.id)}
    >
      <div className="tile-header tile-drag">
        <span className="tile-icon" style={{ color: profile?.color }}>
          {profile?.icon ?? '?'}
        </span>
        {renaming ? (
          <input
            className="tile-nodrag tile-rename"
            autoFocus
            defaultValue={tile.title}
            onBlur={(e) => {
              workspace.renameTile(tile.id, e.currentTarget.value)
              setRenaming(false)
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') e.currentTarget.blur()
              if (e.key === 'Escape') setRenaming(false)
            }}
          />
        ) : (
          <span
            className="tile-title"
            title="Double-click to rename"
            onDoubleClick={() => setRenaming(true)}
          >
            {tile.title}
          </span>
        )}
        {elevated && (
          <span className="badge-admin" title="Runs with administrator rights">
            ADMIN
          </span>
        )}
        <span className="tile-cwd" title={tile.cwd}>
          {tile.cwd ? `‎${tile.cwd}` : ''}
        </span>
        <ContextChip sessionId={runtime?.sessionId ?? null} />
        <UsageChip sessionId={runtime?.sessionId ?? null} />
        <button
          className={`tile-nodrag icon-btn tog${broadcast ? ' on' : ''}`}
          title="Broadcast: whatever you type goes to every terminal marked like this (Ctrl+Shift+B)"
          onClick={() => workspace.toggleBroadcast(tile.id)}
        >
          📡
        </button>
        <button
          className={`tile-nodrag icon-btn tog${tile.loggingPaused ? ' paused' : ''}`}
          title={
            tile.loggingPaused
              ? 'Logging is paused for this terminal. Click to resume (Ctrl+Shift+L)'
              : 'Logging is on. Click to pause (Ctrl+Shift+L)'
          }
          onClick={() => workspace.toggleLogging(tile.id)}
        >
          {tile.loggingPaused ? '⏸' : '●'}
        </button>
        <span className={`dot ${status}`} title={statusText(runtime)} />
        <button className="tile-nodrag icon-btn" title="Close" onClick={close}>
          ×
        </button>
      </div>
      <div className="tile-body">
        <ContextBanner sessionId={runtime?.sessionId ?? null} />
        {runtime?.sessionId ? (
          <ScaledTerminal sessionId={runtime.sessionId} ownsSize={!(active && focusOpen)} />
        ) : (
          <TileMessage tile={tile} runtime={runtime} />
        )}
        {status === 'exited' && (
          <button className="restart tile-nodrag" onClick={() => workspace.restartTile(tile.id)}>
            Restart shell
          </button>
        )}
      </div>
    </div>
  )
}

/** What a tile shows while it has no session: starting, waiting for an admin click, or failed. */
export function TileMessage({
  tile,
  runtime
}: {
  tile: TileState
  runtime: TileRuntime | undefined
}): React.JSX.Element {
  const status = runtime?.status ?? 'starting'
  if (status === 'idle') {
    return (
      <div className="tile-msg">
        <p>This administrator terminal was not started automatically.</p>
        <p className="muted">Windows will ask for your approval (UAC) when it starts.</p>
        <button className="tile-nodrag primary" onClick={() => workspace.restartTile(tile.id)}>
          Start as administrator
        </button>
      </div>
    )
  }
  if (status === 'error') {
    return (
      <div className="tile-msg">
        <p className="err">Could not start this terminal.</p>
        <pre className="tile-err">{runtime?.error}</pre>
        <button className="tile-nodrag" onClick={() => workspace.restartTile(tile.id)}>
          Try again
        </button>
      </div>
    )
  }
  return <div className="tile-msg">Starting…</div>
}

function statusText(r: TileRuntime | undefined): string {
  if (!r || r.status === 'starting') return 'Starting'
  if (r.status === 'idle') return 'Not started'
  if (r.status === 'running') return 'Running'
  if (r.status === 'error') return `Error: ${r.error}`
  return `Exited (${r.exitCode})`
}
