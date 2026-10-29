import { useSyncExternalStore } from 'react'
import { findSlot } from '@shared/layout'
import type { LayoutFile, Profile, TileState, UiState, WorkspaceTab } from '@shared/types'
import { sessionBus } from './sessionBus'

/** `idle`: an administrator tile restored from the layout, waiting for the user to start it. */
export type TileStatus = 'idle' | 'starting' | 'running' | 'exited' | 'error'

export interface TileRuntime {
  sessionId: string | null
  status: TileStatus
  exitCode?: number
  error?: string
  /** The shell really runs elevated (helper used, or the whole app is elevated). */
  elevated?: boolean
}

export interface WorkspaceState {
  ready: boolean
  profiles: Profile[]
  /** Terminals of the active tab. */
  tiles: TileState[]
  runtime: Record<string, TileRuntime>
  activeTileId: string | null
  /** The app itself runs elevated. */
  appElevated: boolean
  /** Tiles that receive each other's keyboard input (broadcast). */
  broadcast: string[]
  ui: UiState
  /** Bumped to ask the focus panel terminal to take keyboard focus. */
  focusNonce: number
  /** Every tab (workspace) in order. The active one's tiles here may lag behind `tiles`. */
  tabs: WorkspaceTab[]
  activeTabId: string
  /** Tabs the person has opened this run. Shells only start for these; none open at launch. */
  openTabs: string[]
}

/** Layouts saved before the panel width became a fraction stored pixels (`focusWidth`). */
function migrateUi(saved: (Partial<UiState> & { focusWidth?: number }) | undefined): UiState {
  const { focusWidth, ...rest } = saved ?? {}
  const fraction =
    rest.focusFraction ?? (focusWidth ? focusWidth / Math.max(900, window.innerWidth) : undefined)
  return { ...DEFAULT_UI, ...rest, focusFraction: fraction ?? DEFAULT_UI.focusFraction }
}

export const DEFAULT_UI: UiState = {
  focusOpen: true,
  focusFraction: 0.32,
  historyOpen: true,
  historyHeight: 220
}

const DEFAULT_W = 8
const DEFAULT_H = 9

/**
 * Renderer-side owner of tiles and their sessions. Lives outside React so effects that re-run
 * (StrictMode, remounts) can never spawn or kill a pty by accident.
 */
class Workspace {
  private state: WorkspaceState = {
    ready: false,
    profiles: [],
    tiles: [],
    runtime: {},
    activeTileId: null,
    appElevated: false,
    broadcast: [],
    ui: DEFAULT_UI,
    focusNonce: 0,
    tabs: [],
    activeTabId: '',
    openTabs: []
  }
  private listeners = new Set<() => void>()
  private sessionToTile = new Map<string, string>()
  private initPromise: Promise<void> | null = null
  private saveTimer: ReturnType<typeof setTimeout> | null = null

  subscribe = (l: () => void): (() => void) => {
    this.listeners.add(l)
    return () => this.listeners.delete(l)
  }

  getSnapshot = (): WorkspaceState => this.state

  private set(patch: Partial<WorkspaceState>, persist = false): void {
    this.state = { ...this.state, ...patch }
    this.listeners.forEach((l) => l())
    if (persist) this.scheduleSave()
  }

  init(): Promise<void> {
    return (this.initPromise ??= this.doInit())
  }

  private async doInit(): Promise<void> {
    sessionBus() // start listening before any session exists
    window.ciboard.pty.onExit((sid, code) => {
      const tileId = this.sessionToTile.get(sid)
      if (tileId) this.patchRuntime(tileId, { status: 'exited', exitCode: code })
    })
    window.ciboard.session.onCwd((sid, cwd) => {
      const tileId = this.sessionToTile.get(sid)
      if (tileId) this.patchTile(tileId, (t) => ({ ...t, cwd }))
    })
    window.addEventListener('beforeunload', () => this.saveNow())

    const [profiles, layout, info] = await Promise.all([
      window.ciboard.profiles.list(),
      window.ciboard.layout.load(),
      window.ciboard.app.info()
    ])
    this.set({ profiles, appElevated: info.elevated })

    const tabs = this.loadTabs(layout, profiles)
    const activeTab = tabs.find((t) => t.id === layout?.activeTabId) ?? tabs[0]
    this.set({
      tabs,
      activeTabId: activeTab.id,
      tiles: activeTab.tiles,
      activeTileId: activeTab.activeTileId,
      ready: true,
      ui: migrateUi(layout?.ui),
      // Nothing starts at launch: a workspace opens when the person picks it. A first run
      // (no saved layout) opens its one starter terminal so the canvas is not a dead end.
      openTabs: layout ? [] : [activeTab.id]
    })
    if (!layout) this.ensureStarted(activeTab.tiles)
  }

  /** Tabs from the layout file; older layouts (one open set plus saved workspaces) are migrated. */
  private loadTabs(layout: LayoutFile | null, profiles: Profile[]): WorkspaceTab[] {
    const clean = (t: WorkspaceTab): WorkspaceTab => {
      const tiles = t.tiles.filter((x) => profiles.some((p) => p.id === x.profileId))
      return {
        ...t,
        tiles,
        activeTileId: tiles.some((x) => x.id === t.activeTileId)
          ? t.activeTileId
          : (tiles[0]?.id ?? null)
      }
    }
    let tabs = (layout?.tabs ?? []).map(clean)
    if (tabs.length === 0) {
      const saved = layout?.workspaces ?? []
      const current = saved.find((w) => w.id === layout?.activeWorkspaceId)
      const open = clean({
        id: current?.id ?? crypto.randomUUID(),
        name: current?.name ?? 'Workspace 1',
        tiles: layout?.tiles ?? [],
        activeTileId: layout?.activeTileId ?? null
      })
      tabs = [open, ...saved.filter((w) => w.id !== open.id).map(clean)]
    }
    // A brand-new install gets one terminal so the canvas is not empty.
    const first = profiles[0]
    if (first && tabs.length === 1 && tabs[0].tiles.length === 0 && !layout) {
      const tile = this.makeTile(first, [])
      tabs = [{ ...tabs[0], tiles: [tile], activeTileId: tile.id }]
    }
    return tabs
  }

  /**
   * Start the shell of every tile that has none yet. Administrator tiles are NOT started on their
   * own: that would raise a UAC prompt at launch, so they wait for an explicit click.
   */
  private ensureStarted(tiles: readonly TileState[]): void {
    for (const t of tiles) {
      if (this.state.runtime[t.id]) continue
      if (t.admin && !this.state.appElevated)
        this.patchRuntime(t.id, { status: 'idle', elevated: true })
      else void this.spawn(t)
    }
  }

  private makeTile(profile: Profile, existing: readonly TileState[], admin = false): TileState {
    const slot = findSlot(existing, DEFAULT_W, DEFAULT_H)
    return {
      id: crypto.randomUUID(),
      title: profile.name,
      profileId: profile.id,
      cwd: profile.cwd,
      admin: admin || profile.admin,
      ...slot
    }
  }

  private patchRuntime(tileId: string, patch: Partial<TileRuntime>): void {
    const cur = this.state.runtime[tileId] ?? { sessionId: null, status: 'starting' as const }
    this.set({ runtime: { ...this.state.runtime, [tileId]: { ...cur, ...patch } } })
  }

  private async spawn(tile: TileState): Promise<void> {
    const previous = this.state.runtime[tile.id]?.sessionId
    if (previous) {
      this.sessionToTile.delete(previous)
      sessionBus().dispose(previous)
    }
    this.patchRuntime(tile.id, { sessionId: null, status: 'starting', exitCode: undefined })
    try {
      const r = await window.ciboard.pty.create({
        profileId: tile.profileId,
        title: tile.title,
        paused: tile.loggingPaused,
        cwd: tile.cwd,
        admin: tile.admin,
        cols: 80,
        rows: 24
      })
      if (!this.allTiles().some((t) => t.id === tile.id)) {
        window.ciboard.pty.kill(r.id) // tile closed while the shell was starting
        return
      }
      this.sessionToTile.set(r.id, tile.id)
      this.patchRuntime(tile.id, { sessionId: r.id, status: 'running', elevated: r.elevated })
    } catch (e) {
      this.patchRuntime(tile.id, {
        status: 'error',
        error: cleanError(e)
      })
    }
  }

  addTile(profileId: string, opts: { admin?: boolean } = {}): void {
    const profile = this.state.profiles.find((p) => p.id === profileId)
    if (!profile) return
    const tile = this.makeTile(profile, this.state.tiles, opts.admin)
    this.set({ tiles: [...this.state.tiles, tile], activeTileId: tile.id }, true)
    void this.spawn(tile)
  }

  /** Restart the shell of a tile whose process has exited. */
  restartTile(tileId: string): void {
    const tile = this.state.tiles.find((t) => t.id === tileId)
    if (tile) void this.spawn(tile)
  }

  closeTile(tileId: string): void {
    const sid = this.state.runtime[tileId]?.sessionId
    if (sid) {
      this.sessionToTile.delete(sid)
      window.ciboard.pty.kill(sid)
      sessionBus().dispose(sid)
    }
    const tiles = this.state.tiles.filter((t) => t.id !== tileId)
    const broadcast = this.state.broadcast.filter((i) => i !== tileId)
    const { [tileId]: _gone, ...runtime } = this.state.runtime
    void _gone
    const activeTileId =
      this.state.activeTileId === tileId
        ? (tiles[tiles.length - 1]?.id ?? null)
        : this.state.activeTileId
    this.set({ tiles, runtime, activeTileId, broadcast }, true)
  }

  /** Every tile of every tab (the active tab's live copy wins over its stored one). */
  private allTiles(): TileState[] {
    return this.state.tabs.flatMap((t) =>
      t.id === this.state.activeTabId ? this.state.tiles : t.tiles
    )
  }

  /** Change one tile wherever it lives (a shell in a background tab still reports its folder). */
  private patchTile(tileId: string, fn: (t: TileState) => TileState): void {
    this.set(
      {
        tiles: this.state.tiles.map((t) => (t.id === tileId ? fn(t) : t)),
        tabs: this.state.tabs.map((tab) =>
          tab.id === this.state.activeTabId
            ? tab
            : { ...tab, tiles: tab.tiles.map((t) => (t.id === tileId ? fn(t) : t)) }
        )
      },
      true
    )
  }

  /** Where a session's terminal lives, so an alert can say which one and whether it is in view. */
  tileForSession(sessionId: string): { title: string; tabName: string; visible: boolean } | null {
    const tileId = this.sessionToTile.get(sessionId)
    const tab = this.state.tabs.find((t) =>
      (t.id === this.state.activeTabId ? this.state.tiles : t.tiles).some((x) => x.id === tileId)
    )
    const tile = this.allTiles().find((t) => t.id === tileId)
    if (!tile || !tab) return null
    return { title: tile.title, tabName: tab.name, visible: tab.id === this.state.activeTabId }
  }

  /** Copy the working tiles back into the active tab's stored entry. */
  private syncActiveTab(): void {
    const id = this.state.activeTabId
    this.state = {
      ...this.state,
      tabs: this.state.tabs.map((t) =>
        t.id === id ? { ...t, tiles: this.state.tiles, activeTileId: this.state.activeTileId } : t
      )
    }
  }

  /** Open a new, empty tab and switch to it. */
  addTab(name?: string): void {
    this.syncActiveTab()
    const tab: WorkspaceTab = {
      id: crypto.randomUUID(),
      name: name?.trim() || this.nextTabName(),
      tiles: [],
      activeTileId: null
    }
    this.set(
      {
        tabs: [...this.state.tabs, tab],
        activeTabId: tab.id,
        tiles: [],
        activeTileId: null,
        openTabs: [...this.state.openTabs, tab.id]
      },
      true
    )
  }

  private nextTabName(): string {
    let n = this.state.tabs.length + 1
    while (this.state.tabs.some((t) => t.name === `Workspace ${n}`)) n++
    return `Workspace ${n}`
  }

  /** Show another tab. Its shells kept running while it was hidden; unstarted ones start now. */
  switchTab(id: string): void {
    if (id === this.state.activeTabId) {
      this.openTab(id)
      return
    }
    this.syncActiveTab()
    const tab = this.state.tabs.find((t) => t.id === id)
    if (!tab) return
    this.set({ activeTabId: id, tiles: tab.tiles, activeTileId: tab.activeTileId }, true)
    this.openTab(id)
  }

  isTabOpen(id: string): boolean {
    return this.state.openTabs.includes(id)
  }

  /** Open a workspace: start its shells. Several can be open at once; they keep running. */
  openTab(id: string): void {
    if (this.state.openTabs.includes(id)) return
    const tab = this.state.tabs.find((t) => t.id === id)
    if (!tab) return
    this.set({ openTabs: [...this.state.openTabs, id] })
    this.ensureStarted(id === this.state.activeTabId ? this.state.tiles : tab.tiles)
  }

  /** Previous / next tab (wraps), e.g. Ctrl+PageUp / Ctrl+PageDown. */
  cycleTab(dir: 1 | -1): void {
    const { tabs, activeTabId } = this.state
    const i = tabs.findIndex((t) => t.id === activeTabId)
    this.switchTab(tabs[(i + dir + tabs.length) % tabs.length].id)
  }

  renameTab(id: string, name: string): void {
    const n = name.trim()
    if (!n) return
    this.set({ tabs: this.state.tabs.map((t) => (t.id === id ? { ...t, name: n } : t)) }, true)
  }

  /** Move a tab to a new position in the strip. */
  moveTab(id: string, toIndex: number): void {
    this.syncActiveTab()
    const tabs = this.state.tabs.slice()
    const from = tabs.findIndex((t) => t.id === id)
    if (from < 0) return
    const [tab] = tabs.splice(from, 1)
    tabs.splice(Math.max(0, Math.min(tabs.length, toIndex)), 0, tab)
    this.set({ tabs }, true)
  }

  /** Close a tab and every terminal in it. The last tab cannot be closed. */
  closeTab(id: string): void {
    if (this.state.tabs.length <= 1) return
    this.syncActiveTab()
    const idx = this.state.tabs.findIndex((t) => t.id === id)
    const tab = this.state.tabs[idx]
    if (!tab) return
    const runtime = { ...this.state.runtime }
    for (const t of tab.tiles) {
      const sid = runtime[t.id]?.sessionId
      if (sid) {
        this.sessionToTile.delete(sid)
        window.ciboard.pty.kill(sid)
        sessionBus().dispose(sid)
      }
      delete runtime[t.id]
    }
    const tabs = this.state.tabs.filter((t) => t.id !== id)
    const openTabs = this.state.openTabs.filter((t) => t !== id)
    const gone = new Set(tab.tiles.map((t) => t.id))
    const broadcast = this.state.broadcast.filter((i) => !gone.has(i))
    if (id !== this.state.activeTabId) {
      this.set({ tabs, runtime, broadcast, openTabs }, true)
      return
    }
    const next = tabs[Math.min(idx, tabs.length - 1)]
    this.set(
      {
        tabs,
        runtime,
        broadcast,
        openTabs,
        activeTabId: next.id,
        tiles: next.tiles,
        activeTileId: next.activeTileId
      },
      true
    )
  }

  /** Move the active tile through the tile list (wraps), e.g. Ctrl+Tab. */
  cycleActive(dir: 1 | -1): void {
    const { tiles, activeTileId } = this.state
    if (tiles.length === 0) return
    const i = tiles.findIndex((t) => t.id === activeTileId)
    const next = tiles[(i + dir + tiles.length) % tiles.length]
    this.set({ activeTileId: next.id }, true)
  }

  requestFocus(): void {
    this.set({ focusNonce: this.state.focusNonce + 1 })
  }

  setUi(patch: Partial<UiState>): void {
    this.set({ ui: { ...this.state.ui, ...patch } }, true)
  }

  /** Keyboard input from any view: goes to the session, and to every broadcast peer. */
  input(sessionId: string, data: string): void {
    window.ciboard.pty.write(sessionId, data)
    const tileId = this.sessionToTile.get(sessionId)
    if (!tileId || !this.state.broadcast.includes(tileId)) return
    for (const id of this.state.broadcast) {
      const rt = this.state.runtime[id]
      if (id !== tileId && rt?.sessionId && rt.status === 'running')
        window.ciboard.pty.write(rt.sessionId, data)
    }
  }

  toggleBroadcast(tileId: string): void {
    const on = this.state.broadcast.includes(tileId)
    this.set({
      broadcast: on
        ? this.state.broadcast.filter((i) => i !== tileId)
        : [...this.state.broadcast, tileId]
    })
  }

  clearBroadcast(): void {
    this.set({ broadcast: [] })
  }

  /** Pause or resume history logging for one terminal; the choice survives restarts. */
  toggleLogging(tileId: string): void {
    const tile = this.state.tiles.find((t) => t.id === tileId)
    if (!tile) return
    const paused = !tile.loggingPaused
    const sid = this.state.runtime[tileId]?.sessionId
    if (sid) void window.ciboard.session.setLogging(sid, !paused)
    this.set(
      {
        tiles: this.state.tiles.map((t) => (t.id === tileId ? { ...t, loggingPaused: paused } : t))
      },
      true
    )
  }

  isRunning(tileId: string): boolean {
    return this.state.runtime[tileId]?.status === 'running'
  }

  renameTile(tileId: string, title: string): void {
    const t = title.trim()
    if (!t) return
    this.set(
      { tiles: this.state.tiles.map((x) => (x.id === tileId ? { ...x, title: t } : x)) },
      true
    )
  }

  setActive(tileId: string): void {
    if (this.state.activeTileId !== tileId) this.set({ activeTileId: tileId }, true)
  }

  /**
   * Take the canvas layout after a drag or resize: the new order is the reading order of the
   * dropped positions, and a size is stored only when the person changed it (`shownW` is what
   * the tile was drawn at, which may be wider than its stored width on a narrow window).
   */
  applyLayout(
    items: readonly { i: string; x: number; y: number; w: number; h: number }[],
    shownW: Record<string, number>
  ): void {
    const byId = new Map(items.map((i) => [i.i, i]))
    const ordered = [...this.state.tiles].sort((a, b) => {
      const ga = byId.get(a.id)
      const gb = byId.get(b.id)
      return ga && gb ? ga.y - gb.y || ga.x - gb.x : 0
    })
    const tiles = ordered.map((t) => {
      const g = byId.get(t.id)
      if (!g) return t
      return { ...t, w: g.w !== shownW[t.id] ? g.w : t.w, h: g.h, x: g.x, y: g.y }
    })
    const same = tiles.every((t, i) => {
      const o = this.state.tiles[i]
      return o.id === t.id && o.w === t.w && o.h === t.h
    })
    if (!same) this.set({ tiles }, true)
  }

  /** Default "run as administrator" for a profile (shown as the shield toggle in the picker). */
  async setProfileAdmin(profile: Profile, admin: boolean): Promise<void> {
    if (profile.builtin) {
      const s = await window.ciboard.settings.get()
      await window.ciboard.settings.set({
        builtinAdmin: { ...s.builtinAdmin, [profile.id]: admin }
      })
      this.set({ profiles: await window.ciboard.profiles.list() })
    } else {
      await this.saveCustomProfiles(
        this.state.profiles
          .filter((p) => !p.builtin)
          .map((p) => (p.id === profile.id ? { ...p, admin } : p))
      )
    }
  }

  async saveCustomProfiles(customProfiles: Profile[]): Promise<void> {
    await window.ciboard.settings.set({ customProfiles })
    this.set({ profiles: await window.ciboard.profiles.list() })
  }

  private scheduleSave(): void {
    if (this.saveTimer) clearTimeout(this.saveTimer)
    this.saveTimer = setTimeout(() => this.saveNow(), 300)
  }

  private saveNow(): void {
    if (!this.state.ready) return
    if (this.saveTimer) clearTimeout(this.saveTimer)
    this.saveTimer = null
    this.syncActiveTab()
    const file: LayoutFile = {
      version: 1,
      // The active tab is also written at the top level so an older build still opens it.
      tiles: this.state.tiles,
      activeTileId: this.state.activeTileId,
      ui: this.state.ui,
      tabs: this.state.tabs,
      activeTabId: this.state.activeTabId
    }
    window.ciboard.layout.save(file)
  }
}

/** Strip Electron's IPC wrapper so the user sees only our message. */
function cleanError(e: unknown): string {
  const m = e instanceof Error ? e.message : String(e)
  return m.replace(/^Error invoking remote method '[^']*': (Error: )?/, '')
}

export const workspace = new Workspace()

export const useWorkspace = (): WorkspaceState =>
  useSyncExternalStore(workspace.subscribe, workspace.getSnapshot)
