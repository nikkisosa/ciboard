import { useEffect, useRef, useState } from 'react'
import { Canvas } from './components/Canvas'
import { HistoryPanel } from './components/HistoryPanel'
import { FocusPanel } from './components/FocusPanel'
import { TabBar } from './components/TabBar'
import { ProfilePicker } from './components/ProfilePicker'
import { SettingsDialog } from './components/SettingsDialog'
import { StatusBar } from './components/StatusBar'
import { initContextMonitor } from './contextMonitor'
import { initMonitor, resetMonitor } from './monitorStore'
import { Splitter } from './components/Splitter'
import { DEFAULT_FONT_SIZE } from '@shared/defaults'
import { getSettings, initSettings, updateSettings, useSettings } from './settingsStore'
import type { AppInfo } from '@shared/types'
import { useWorkspace, workspace } from './workspace'

const clamp = (v: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, v))

/** Terminal font size +1 / -1 / reset (delta 0), applied to every terminal. */
function zoomFont(delta: number): void {
  const current = getSettings()?.fontSize ?? DEFAULT_FONT_SIZE
  const next = delta === 0 ? DEFAULT_FONT_SIZE : clamp(current + delta, 8, 40)
  if (next !== current) void updateSettings({ fontSize: next })
}

export function App(): React.JSX.Element {
  const ws = useWorkspace()
  const settings = useSettings()
  const [picker, setPicker] = useState(false)
  const [settingsInfo, setSettingsInfo] = useState<AppInfo | null>(null)
  const dragStart = useRef({ focusWidth: 0, historyHeight: 0 })

  useEffect(() => {
    void initSettings().then(initContextMonitor)
    initMonitor()
    void workspace.init()
  }, [])

  // Switched off in Settings: drop the last numbers instead of leaving them frozen on screen.
  const monitorOn = settings?.resourceMonitor
  useEffect(() => {
    if (monitorOn === false) resetMonitor()
  }, [monitorOn])

  const openSettings = (): void => void window.ciboard.app.info().then(setSettingsInfo)
  useEffect(() => window.ciboard.app.onOpenSettings(openSettings), [])

  // Capture phase so app shortcuts win over xterm's own key handling.
  useEffect(() => {
    const h = (e: KeyboardEvent): void => {
      const key = e.key.toLowerCase()
      if (e.ctrlKey && e.shiftKey && key === 't') {
        e.preventDefault()
        e.stopPropagation()
        setPicker(true)
      } else if (e.ctrlKey && e.shiftKey && key === 'n') {
        e.preventDefault()
        e.stopPropagation()
        workspace.addTab()
      } else if (e.ctrlKey && !e.shiftKey && (e.key === 'PageUp' || e.key === 'PageDown')) {
        e.preventDefault()
        e.stopPropagation()
        workspace.cycleTab(e.key === 'PageUp' ? -1 : 1)
      } else if (e.ctrlKey && e.key === 'Tab') {
        e.preventDefault()
        e.stopPropagation()
        workspace.cycleActive(e.shiftKey ? -1 : 1)
        workspace.requestFocus()
      } else if (e.ctrlKey && e.shiftKey && key === 'l') {
        e.preventDefault()
        e.stopPropagation()
        const id = workspace.getSnapshot().activeTileId
        if (id) workspace.toggleLogging(id)
      } else if (e.ctrlKey && e.shiftKey && key === 'b') {
        e.preventDefault()
        e.stopPropagation()
        const id = workspace.getSnapshot().activeTileId
        if (id) workspace.toggleBroadcast(id)
      } else if (e.ctrlKey && !e.altKey && ['=', '+', '-', '_', '0'].includes(e.key)) {
        e.preventDefault()
        e.stopPropagation()
        zoomFont(e.key === '0' ? 0 : e.key === '-' || e.key === '_' ? -1 : 1)
      } else if (e.ctrlKey && !e.shiftKey && e.key === ',') {
        e.preventDefault()
        e.stopPropagation()
        openSettings()
      }
    }
    // Ctrl + mouse wheel zooms the terminal font like in a browser or editor.
    const wheel = (e: WheelEvent): void => {
      if (!e.ctrlKey) return
      e.preventDefault()
      zoomFont(e.deltaY < 0 ? 1 : -1)
    }
    window.addEventListener('keydown', h, true)
    window.addEventListener('wheel', wheel, { passive: false, capture: true })
    return () => {
      window.removeEventListener('keydown', h, true)
      window.removeEventListener('wheel', wheel, true)
    }
  }, [])

  // The focus panel keeps its share of the window. The share is stored, not the pixels, and is
  // clamped only here: clamping a stored width would make it drift when the window is resized
  // back and forth.
  const [winWidth, setWinWidth] = useState(window.innerWidth)
  useEffect(() => {
    let frame = 0
    const onResize = (): void => {
      cancelAnimationFrame(frame)
      frame = requestAnimationFrame(() => setWinWidth(window.innerWidth))
    }
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [])
  const focusPx = clamp(
    Math.round(ws.ui.focusFraction * winWidth),
    280,
    Math.max(300, winWidth - 360)
  )

  return (
    <div className="app">
      <TabBar ws={ws} />
      <div className="top">
        <section className="canvas">
          <header className="region-title">
            <span>Canvas</span>
            {ws.broadcast.length > 0 && (
              <span className="bc-banner">
                📡 Typing goes to {ws.broadcast.length} terminal
                {ws.broadcast.length === 1 ? '' : 's'}
                <button onClick={() => workspace.clearBroadcast()}>Stop</button>
              </span>
            )}
            <span className="grow" />
            {!ws.ui.focusOpen && (
              <button
                className="icon-btn"
                title="Show focus panel"
                onClick={() => workspace.setUi({ focusOpen: true })}
              >
                «
              </button>
            )}
            <button className="icon-btn" title="Settings (Ctrl+,)" onClick={openSettings}>
              ⚙
            </button>
            <button
              className="add-btn"
              title="New terminal (Ctrl+Shift+T)"
              onClick={() => setPicker(true)}
            >
              +
            </button>
          </header>
          <div className="region-body">
            <Canvas ws={ws} />
          </div>
        </section>
        {ws.ui.focusOpen && (
          <>
            <Splitter
              orientation="vertical"
              onStart={() => (dragStart.current.focusWidth = focusPx)}
              onDrag={(d) =>
                workspace.setUi({
                  focusFraction: clamp(
                    (dragStart.current.focusWidth - d) / window.innerWidth,
                    0.15,
                    0.7
                  )
                })
              }
            />
            <FocusPanel ws={ws} width={focusPx} />
          </>
        )}
      </div>
      <section className="history" style={{ height: ws.ui.historyOpen ? ws.ui.historyHeight : 28 }}>
        <HistoryPanel ws={ws} />
      </section>
      {ws.ui.historyOpen && (
        <Splitter
          orientation="horizontal"
          onStart={() => (dragStart.current.historyHeight = ws.ui.historyHeight)}
          onDrag={(d) =>
            workspace.setUi({
              historyHeight: clamp(
                dragStart.current.historyHeight - d,
                80,
                Math.max(120, window.innerHeight - 220)
              )
            })
          }
        />
      )}
      {monitorOn && <StatusBar />}
      {settingsInfo && settings && (
        <SettingsDialog
          settings={settings}
          appInfo={settingsInfo}
          onClose={() => setSettingsInfo(null)}
        />
      )}
      {picker && <ProfilePicker profiles={ws.profiles} onClose={() => setPicker(false)} />}
    </div>
  )
}
