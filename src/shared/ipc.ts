import type {
  AppInfo,
  ContextUsage,
  HistoryAppend,
  HistoryEntry,
  HistoryFileInfo,
  HistoryRunning,
  ResourceSample,
  LayoutFile,
  Profile,
  Settings,
  SpawnRequest,
  SpawnResult
} from './types'

/** Renderer -> main channels. */
export const Invoke = {
  ptyCreate: 'pty:create',
  ptyWrite: 'pty:write',
  ptyResize: 'pty:resize',
  ptyKill: 'pty:kill',
  profilesList: 'profiles:list',
  settingsGet: 'settings:get',
  settingsSet: 'settings:set',
  layoutLoad: 'layout:load',
  layoutSave: 'layout:save',
  appInfo: 'app:info',
  clipboardRead: 'clipboard:read',
  clipboardWrite: 'clipboard:write',
  appRestartAdmin: 'app:restartAdmin',
  sessionSetLogging: 'session:setLogging',
  historyClearSession: 'history:clearSession',
  historyClearAll: 'history:clearAll',
  historyExport: 'history:export',
  dialogPickFolder: 'dialog:pickFolder',
  historyList: 'history:list',
  historyRead: 'history:read',
  historySessionFile: 'history:sessionFile',
  historyEntries: 'history:entries',
  historySearch: 'history:search',
  historyOpen: 'history:open',
  historyOpenFolder: 'history:openFolder'
} as const

/** Main -> renderer push channels. */
export const Push = {
  ptyData: 'pty:data',
  ptyExit: 'pty:exit',
  historyAppend: 'history:append',
  historyEntry: 'history:entry',
  historyRunning: 'history:running',
  sessionCwd: 'session:cwd',
  settingsChanged: 'settings:changed',
  monitorSample: 'monitor:sample',
  contextUsage: 'context:usage',
  openSettings: 'app:openSettings'
} as const

export interface CiBoardApi {
  pty: {
    create(req: SpawnRequest): Promise<SpawnResult>
    write(id: string, data: string): void
    resize(id: string, cols: number, rows: number): void
    kill(id: string): void
    onData(cb: (id: string, data: string) => void): () => void
    onExit(cb: (id: string, exitCode: number) => void): () => void
  }
  profiles: {
    /** Detected built-in profiles merged with custom ones. */
    list(): Promise<Profile[]>
  }
  settings: {
    get(): Promise<Settings>
    set(patch: Partial<Settings>): Promise<Settings>
    /** Fires for every change, including ones made from the application menu. */
    onChanged(cb: (s: Settings) => void): () => void
  }
  dialog: {
    /** Folder picker; resolves null when cancelled. */
    pickFolder(current?: string): Promise<string | null>
  }
  layout: {
    load(): Promise<LayoutFile | null>
    save(layout: LayoutFile): void
  }
  monitor: {
    onSample(cb: (s: ResourceSample) => void): () => void
  }
  context: {
    /** Context usage of the Claude Code session in each terminal (by terminal session id). */
    onUsage(cb: (usage: Record<string, ContextUsage>) => void): () => void
  }
  clipboard: {
    readText(): Promise<string>
    writeText(text: string): void
  }
  app: {
    info(): Promise<AppInfo>
    /** Relaunch the whole app elevated (UAC prompt). Resolves false if declined. */
    restartAsAdmin(): Promise<boolean>
    /** File > Settings… was chosen in the application menu. */
    onOpenSettings(cb: () => void): () => void
  }
  history: {
    list(): Promise<HistoryFileInfo[]>
    /** Tail of a history file (path must be inside the history folder). */
    read(file: string): Promise<string>
    sessionFile(sessionId: string): Promise<string | null>
    /** Entries of a session (from its .md); empty when the shell has no integration. */
    entries(rawFile: string): Promise<HistoryEntry[]>
    /** Full-text search; `files` limits it to those sessions (raw transcript paths). */
    search(query: string, files: string[] | null): Promise<HistoryEntry[]>
    /** Open the session's structured .md or its raw transcript in the default app. */
    open(rawFile: string, kind: 'md' | 'raw'): Promise<void>
    openFolder(): Promise<void>
    /** Delete one session's history files (asks for confirmation). Resolves true if deleted. */
    clearSession(rawFile: string): Promise<boolean>
    /** Empty the whole history folder (asks for confirmation). Resolves true if deleted. */
    clearAll(): Promise<boolean>
    /** Save the session as one combined Markdown file; resolves the saved path or null. */
    export(rawFile: string): Promise<string | null>
    onAppend(cb: (e: HistoryAppend) => void): () => void
    onEntry(cb: (e: { sessionId: string; entry: HistoryEntry }) => void): () => void
    onRunning(cb: (e: { sessionId: string; running: HistoryRunning | null }) => void): () => void
  }
  session: {
    /** Pause or resume logging for one session. */
    setLogging(sessionId: string, enabled: boolean): Promise<void>
    /** Working directory reported by the shell (OSC 7 / 633). */
    onCwd(cb: (sessionId: string, cwd: string) => void): () => void
  }
}
