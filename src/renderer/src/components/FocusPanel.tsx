import { workspace, type WorkspaceState } from '../workspace'
import { ContextBanner, ContextChip, useContextCritical } from './ContextAlert'
import { FocusTerminal } from './FocusTerminal'
import { UsageChip } from './StatusBar'
import { isElevated, TileMessage } from './Tile'

export function FocusPanel({
  ws,
  width
}: {
  ws: WorkspaceState
  width: number
}): React.JSX.Element {
  const tile = ws.tiles.find((t) => t.id === ws.activeTileId)
  const runtime = tile ? ws.runtime[tile.id] : undefined
  const elevated = tile ? isElevated(tile, runtime) : false
  const critical = useContextCritical(runtime?.sessionId ?? null)
  const profile = tile ? ws.profiles.find((p) => p.id === tile.profileId) : undefined

  return (
    <aside
      className={`focus${elevated ? ' admin' : ''}${critical ? ' ctx-critical' : ''}`}
      style={{ width }}
    >
      <header className="region-title">
        {tile ? (
          <>
            <span className="tile-icon" style={{ color: profile?.color }}>
              {profile?.icon}
            </span>
            <span className="focus-title">{tile.title}</span>
            {elevated && <span className="badge-admin">ADMIN</span>}
            <span className={`dot ${runtime?.status ?? 'starting'}`} />
            <ContextChip sessionId={runtime?.sessionId ?? null} />
            <UsageChip sessionId={runtime?.sessionId ?? null} />
          </>
        ) : (
          <span>Focus</span>
        )}
        <span className="grow" />
        <button
          className="icon-btn"
          title="Collapse focus panel"
          onClick={() => workspace.setUi({ focusOpen: false })}
        >
          »
        </button>
      </header>
      <div className="region-body">
        <ContextBanner sessionId={runtime?.sessionId ?? null} />
        {runtime?.sessionId ? (
          <FocusTerminal
            key={runtime.sessionId}
            sessionId={runtime.sessionId}
            focusNonce={ws.focusNonce}
          />
        ) : (
          <div className="muted pad">
            {tile ? (
              <TileMessage tile={tile} runtime={runtime} />
            ) : (
              'Select a terminal to show it here.'
            )}
          </div>
        )}
      </div>
    </aside>
  )
}
