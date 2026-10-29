import ReactGridLayout, { useContainerWidth, verticalCompactor } from 'react-grid-layout'
import 'react-grid-layout/css/styles.css'
import { flowLayout, GRID_COLS } from '@shared/layout'
import { workspace, type WorkspaceState } from '../workspace'
import { Tile } from './Tile'

/** Narrowest a terminal tile is drawn, in pixels. */
const MIN_TILE_PX = 340

export function Canvas({ ws }: { ws: WorkspaceState }): React.JSX.Element {
  const { width, containerRef, mounted } = useContainerWidth()
  // Rows grow and shrink with the columns, so tiles keep their proportions when the window
  // is resized instead of becoming wide-and-short or narrow-and-tall.
  const colWidth = (width - 12 - 6 * (GRID_COLS - 1)) / GRID_COLS
  const rowHeight = Math.max(20, Math.min(90, Math.round(colWidth * 0.85)))
  const opened = ws.openTabs.includes(ws.activeTabId)
  // Browser-style flow: a tile never gets narrower than MIN_TILE_PX, so on a small window the
  // tiles widen and wrap onto more rows instead of shrinking to nothing. Positions come from
  // order and size alone, so closing or resizing a tile re-packs the others.
  const minCols = Math.ceil((MIN_TILE_PX + 6) / (colWidth + 6))
  const shownW: Record<string, number> = {}
  for (const t of ws.tiles) shownW[t.id] = Math.min(GRID_COLS, Math.max(t.w, minCols))
  const flow = flowLayout(ws.tiles.map((t) => ({ id: t.id, w: shownW[t.id], h: t.h })))
  const layout = ws.tiles.map((t) => ({ i: t.id, ...flow[t.id], minW: 3, minH: 4 }))

  return (
    <div className="canvas-scroll" ref={containerRef}>
      {mounted && opened && (
        <ReactGridLayout
          width={width}
          layout={layout}
          gridConfig={{ cols: GRID_COLS, rowHeight, margin: [6, 6], containerPadding: [6, 6] }}
          dragConfig={{ enabled: true, handle: '.tile-drag', cancel: '.tile-nodrag', threshold: 3 }}
          resizeConfig={{ enabled: true }}
          compactor={verticalCompactor}
          onDragStop={(l) => workspace.applyLayout(l, shownW)}
          onResizeStop={(l) => workspace.applyLayout(l, shownW)}
        >
          {ws.tiles.map((t) => (
            <div key={t.id}>
              <Tile
                tile={t}
                profile={ws.profiles.find((p) => p.id === t.profileId)}
                runtime={ws.runtime[t.id]}
                active={ws.activeTileId === t.id}
                focusOpen={ws.ui.focusOpen}
                broadcast={ws.broadcast.includes(t.id)}
              />
            </div>
          ))}
        </ReactGridLayout>
      )}
      {ws.ready && !opened && (
        <div className="empty ask">
          <p>This workspace is not open.</p>
          <button onClick={() => workspace.openTab(ws.activeTabId)}>
            Open workspace{ws.tiles.length ? ` (${ws.tiles.length} terminals)` : ''}
          </button>
        </div>
      )}
      {ws.ready && opened && ws.tiles.length === 0 && (
        <div className="empty">No terminals. Press Ctrl+Shift+T or click + to add one.</div>
      )}
    </div>
  )
}
