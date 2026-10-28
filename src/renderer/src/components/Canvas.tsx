import ReactGridLayout, { noCompactor, useContainerWidth } from 'react-grid-layout'
import 'react-grid-layout/css/styles.css'
import { GRID_COLS } from '@shared/layout'
import { workspace, type WorkspaceState } from '../workspace'
import { Tile } from './Tile'

export function Canvas({ ws }: { ws: WorkspaceState }): React.JSX.Element {
  const { width, containerRef, mounted } = useContainerWidth()
  // Rows grow and shrink with the columns, so tiles keep their proportions when the window
  // is resized instead of becoming wide-and-short or narrow-and-tall.
  const colWidth = (width - 12 - 6 * (GRID_COLS - 1)) / GRID_COLS
  const rowHeight = Math.max(20, Math.min(90, Math.round(colWidth * 0.85)))
  const layout = ws.tiles.map((t) => ({
    i: t.id,
    x: t.x,
    y: t.y,
    w: t.w,
    h: t.h,
    minW: 3,
    minH: 4
  }))

  return (
    <div className="canvas-scroll" ref={containerRef}>
      {mounted && (
        <ReactGridLayout
          width={width}
          layout={layout}
          gridConfig={{ cols: GRID_COLS, rowHeight, margin: [6, 6], containerPadding: [6, 6] }}
          dragConfig={{ enabled: true, handle: '.tile-drag', cancel: '.tile-nodrag', threshold: 3 }}
          resizeConfig={{ enabled: true }}
          compactor={noCompactor}
          onLayoutChange={(l) => workspace.setGeometry(l)}
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
      {ws.ready && ws.tiles.length === 0 && (
        <div className="empty">No terminals. Press Ctrl+Shift+T or click + to add one.</div>
      )}
    </div>
  )
}
