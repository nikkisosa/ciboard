export type ShellKind = 'cmd' | 'powershell' | 'pwsh' | 'gitbash' | 'wsl' | 'custom'

export interface Profile {
  id: string
  name: string
  kind: ShellKind
  /** Executable path or name resolvable on PATH. */
  file: string
  args: string[]
  cwd?: string
  env?: Record<string, string>
  /** Short glyph shown in tile headers. */
  icon: string
  /** CSS color for the icon / accent. */
  color: string
  /** "Run as administrator" toggle (honoured from milestone 6). */
  admin: boolean
  /** True for auto-detected profiles (cannot be deleted, only hidden/admin-toggled). */
  builtin: boolean
}

export interface SpawnRequest {
  profileId: string
  /** Overrides the profile cwd (e.g. when restoring a tile). */
  cwd?: string
  /** Overrides the profile admin toggle. */
  admin?: boolean
  /** Tile title, used in the history file name. */
  title: string
  /** Start with logging paused. */
  paused?: boolean
  cols: number
  rows: number
}

export interface SpawnResult {
  id: string
  pid: number
  /** Raw transcript path for this session. */
  logFile: string
  /** True when the shell really runs elevated (helper used, or the whole app is elevated). */
  elevated: boolean
}

export type AdminMode = 'per-terminal' | 'whole-app'
export type ThemeSetting = 'system' | 'light' | 'dark'

export interface AppInfo {
  /** The app itself runs with an elevated token. */
  elevated: boolean
  adminMode: AdminMode
  /** Where history goes when no custom folder is chosen. */
  defaultHistoryDir: string
}

export interface Settings {
  version: 1
  customProfiles: Profile[]
  /** Admin toggle overrides for built-in profiles, keyed by profile id. */
  builtinAdmin: Record<string, boolean>
  /** Custom history folder; null = %APPDATA%/CIBoard/history. */
  historyDir: string | null
  /** How administrator terminals are obtained (see elevation.ts). */
  adminMode: AdminMode
  /** App theme; `system` follows Windows. */
  theme: ThemeSetting
  /** Terminal colour scheme name, or `auto` to match the app theme. */
  terminalScheme: string
  fontFamily: string
  fontSize: number
  /** Regular expressions (source text, case-insensitive) masked before anything is written to disk. */
  redactionPatterns: string[]
  /** Delete day folders older than this many days; null keeps everything. */
  historyRetentionDays: number | null
  /** Show the CPU / memory status bar and per-terminal usage (runs a small sampler). */
  resourceMonitor: boolean
  /** Seconds between samples (1 - 30). */
  monitorIntervalSec: number
  /** Raise a critical alert on a terminal whose Claude session has used too much context. */
  contextAlerts: boolean
  /** Context usage (percent, 1 - 99) at which the alert fires. */
  contextAlertPercent: number
  /** Context window (tokens) the percentage is measured against; sessions beyond it count as 1M. */
  contextWindow: number
  /** Inject OSC 133 shell integration so history is stored as command -> output entries. */
  shellIntegration: boolean
  /** Max output lines kept per command in the .md file (full output stays in .raw.txt). */
  historyOutputLimit: number
}

export interface TileState {
  id: string
  title: string
  profileId: string
  cwd?: string
  admin?: boolean
  /** Logging is paused for this terminal (kept across restarts, so it never silently resumes). */
  loggingPaused?: boolean
  /** Grid position and size (react-grid-layout units). */
  x: number
  y: number
  w: number
  h: number
}

export interface UiState {
  focusOpen: boolean
  /** Focus panel width as a share of the window width (0.15 - 0.7). */
  focusFraction: number
  historyOpen: boolean
  historyHeight: number
}

/** A tab is a workspace: a named set of terminals whose shells keep their last folders. */
export interface WorkspaceTab {
  id: string
  name: string
  tiles: TileState[]
  activeTileId: string | null
}

export interface LayoutFile {
  version: 1
  tiles: TileState[]
  activeTileId: string | null
  ui?: UiState
  /** Open tabs in order. Layouts from before tabs have none and are migrated on load. */
  tabs?: WorkspaceTab[]
  activeTabId?: string
  /** Pre-tab "saved workspaces"; read for migration only, never written. */
  workspaces?: WorkspaceTab[]
  activeWorkspaceId?: string | null
}

/** One finished command, as stored in a session .md file. */
export interface HistoryEntry {
  /** `<raw transcript path>#<index in the .md file>` */
  id: string
  /** Raw transcript path of the session file this entry belongs to. */
  file: string
  index: number
  /** Day folder, YYYY-MM-DD. */
  date: string
  /** Start time, HH:mm:ss. */
  time: string
  cwd: string
  /** Exit code as text; `?` when the shell cannot report it (cmd). */
  exit: string
  /** Display duration, e.g. `1.2s`. */
  duration: string
  command: string
  /** Fence language of the command block (powershell, bash, bat, text). */
  lang: string
  output: string
  /** Session title from the .md header. */
  session: string
}

/** A command that has started but not finished yet. */
export interface HistoryRunning {
  command: string
  cwd: string
  /** Epoch ms. */
  startedAt: number
  /** Output so far (tail). */
  output: string
}

export interface HistoryFileInfo {
  /** Absolute path of the .raw.txt file. */
  file: string
  /** Day folder, YYYY-MM-DD. */
  date: string
  /** Session start time, HH:mm:ss. */
  time: string
  shell: string
  title: string
  sizeBytes: number
  /** True when a structured .md exists next to the transcript. */
  hasMd: boolean
}

export interface HistoryAppend {
  sessionId: string
  file: string
  text: string
}

export interface SessionUsage {
  /** CPU of the shell and everything it started, % of the whole machine (Task Manager style). */
  cpu: number
  /** Working set of that process tree, bytes. */
  mem: number
  /** Processes in the tree. */
  procs: number
}

/** How full the context of the Claude Code session running in a terminal is. */
export interface ContextUsage {
  /** 0 - 100 of the context window. */
  percent: number
  tokens: number
  window: number
  model: string | null
}

export interface ResourceSample {
  /** Epoch ms. */
  time: number
  cores: number
  system: { cpu: number; memUsed: number; memTotal: number }
  /** All CIBoard processes (main, renderer, GPU, utility). */
  app: { cpu: number; mem: number }
  /** Per terminal session id. Empty while the process sampler is not available. */
  sessions: Record<string, SessionUsage>
}
