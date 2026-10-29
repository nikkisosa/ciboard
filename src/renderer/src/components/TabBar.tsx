import { useState } from 'react'
import { useContextUsage } from '../contextMonitor'
import { workspace, type WorkspaceState } from '../workspace'

/** One tab per workspace. Shells in background tabs keep running. */
export function TabBar({ ws }: { ws: WorkspaceState }): React.JSX.Element {
  const { alerts } = useContextUsage()
  const [renamingId, setRenamingId] = useState<string | null>(null)
  const [dragId, setDragId] = useState<string | null>(null)
  const [overId, setOverId] = useState<string | null>(null)

  const close = (id: string, name: string, tileIds: string[]): void => {
    const running = tileIds.filter((t) => workspace.isRunning(t)).length
    if (
      running > 0 &&
      !window.confirm(`Close "${name}"? Its ${running} running terminal(s) will be stopped.`)
    )
      return
    workspace.closeTab(id)
  }

  return (
    <div className="tabbar" role="tablist">
      {ws.tabs.map((tab, index) => {
        const active = tab.id === ws.activeTabId
        const tiles = active ? ws.tiles : tab.tiles
        const tileIds = tiles.map((t) => t.id)
        const critical = tiles.filter((t) => {
          const sid = ws.runtime[t.id]?.sessionId
          return sid ? sid in alerts : false
        }).length
        const drop = overId === tab.id && dragId !== tab.id
        return (
          <div
            key={tab.id}
            role="tab"
            aria-selected={active}
            className={`tab${active ? ' on' : ''}${critical ? ' critical' : ''}${drop ? ' drop' : ''}${ws.openTabs.includes(tab.id) ? '' : ' closed'}`}
            draggable={renamingId !== tab.id}
            onDragStart={() => setDragId(tab.id)}
            onDragOver={(e) => {
              if (!dragId) return
              e.preventDefault()
              setOverId(tab.id)
            }}
            onDrop={() => {
              if (dragId && dragId !== tab.id) workspace.moveTab(dragId, index)
              setDragId(null)
              setOverId(null)
            }}
            onDragEnd={() => {
              setDragId(null)
              setOverId(null)
            }}
            onClick={() => workspace.switchTab(tab.id)}
            onAuxClick={(e) => {
              if (e.button === 1 && ws.tabs.length > 1) close(tab.id, tab.name, tileIds)
            }}
            title={
              critical
                ? `${critical} terminal(s) past the context limit`
                : ws.openTabs.includes(tab.id)
                  ? 'Double-click to rename, drag to reorder'
                  : 'Not open. Click to open this workspace'
            }
          >
            {renamingId === tab.id ? (
              <input
                className="tab-rename"
                autoFocus
                defaultValue={tab.name}
                onClick={(e) => e.stopPropagation()}
                onBlur={(e) => {
                  workspace.renameTab(tab.id, e.currentTarget.value)
                  setRenamingId(null)
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') e.currentTarget.blur()
                  if (e.key === 'Escape') setRenamingId(null)
                  e.stopPropagation()
                }}
              />
            ) : (
              <span className="tab-name" onDoubleClick={() => setRenamingId(tab.id)}>
                {tab.name}
              </span>
            )}
            <span className="tab-count">{tiles.length}</span>
            {critical > 0 && (
              <span className="tab-alert" aria-label="critical context">
                ⚠ {critical}
              </span>
            )}
            {ws.tabs.length > 1 && (
              <button
                className="tab-close"
                title="Close tab"
                onClick={(e) => {
                  e.stopPropagation()
                  close(tab.id, tab.name, tileIds)
                }}
              >
                ×
              </button>
            )}
          </div>
        )
      })}
      <button
        className="tab-add"
        title="New workspace tab (Ctrl+Shift+N)"
        onClick={() => workspace.addTab()}
      >
        +
      </button>
    </div>
  )
}
