import { existsSync } from 'node:fs'
import { appendFile, mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { app, BrowserWindow, clipboard, dialog, ipcMain, Menu, nativeTheme, shell } from 'electron'
import { AGENTS } from '../shared/agents'
import { Invoke, Push } from '../shared/ipc'
import type {
  AdminMode,
  LayoutFile,
  Settings,
  SpawnRequest,
  WorkflowRunRequest
} from '../shared/types'
import {
  isAppElevated,
  planElevation,
  realDeps,
  relaunchElevated,
  wrapWithHelper
} from './elevation'
import { ContextWatcher } from './claude/contextWatcher'
import { buildSessionExport } from './history/exportSession'
import { buildIntegration } from './integration'
import { ResourceMonitor } from './monitor/resourceMonitor'
import {
  currentHistoryDir,
  HistoryManager,
  insideHistory,
  listHistoryFiles,
  mdPathOf,
  readEntries,
  readHistoryTail,
  refreshHistoryDir
} from './history/historyManager'
import { PtyManager } from './ptyManager'
import { getProfile, listProfiles } from './profiles'
import { getSettings, setSettings } from './settings'
import { dataDir, readJson, writeJson } from './store'
import { decisionLine, decisionLogPath, listWorkflows, readWorkflow } from './workflow/files'
import { WorkflowRunner } from './workflow/runner'
import { installBuiltin, listBuiltin } from './workflow/builtin'
import { listInstalledSkills } from './workflow/skills'

let win: BrowserWindow | null = null

const send = (channel: string, payload: unknown): void => win?.webContents.send(channel, payload)

const history = new HistoryManager({
  append: (e) => send(Push.historyAppend, e),
  entry: (sessionId, entry) => send(Push.historyEntry, { sessionId, entry }),
  running: (sessionId, running) => send(Push.historyRunning, { sessionId, running }),
  cwd: (sessionId, cwd) => send(Push.sessionCwd, { sessionId, cwd })
})

const workflows = new WorkflowRunner({
  write: (id, data) => ptys.write(id, data),
  emit: (state) => send(Push.workflowState, state),
  command: (agent) => cachedAgentCommands[agent] || AGENTS[agent]?.command || agent,
  record: (file, d) =>
    void appendFile(decisionLogPath(file), decisionLine(d), 'utf8').catch(() => {})
})

const ptys = new PtyManager({
  data: (id, data) => {
    history.output(id, data)
    workflows.feed(id)
    win?.webContents.send(Push.ptyData, id, data)
  },
  exit: (id, code) => {
    void history.end(id, code)
    workflows.sessionExited(id)
    win?.webContents.send(Push.ptyExit, id, code)
  }
})

const monitor = new ResourceMonitor({
  sessionPids: () => ptys.pids(),
  emit: (sample) => send(Push.monitorSample, sample)
})

const contextWatcher = new ContextWatcher({
  sessionPids: () => ptys.pids(),
  window: () => cachedContextWindow,
  emit: (usage) => send(Push.contextUsage, usage)
})
let cachedContextWindow = 200000
let cachedAgentCommands: Record<string, string> = {}

/** Start or stop the Claude context watcher to match the settings. */
function syncContextWatcher(s: Settings): void {
  cachedContextWindow = s.contextWindow
  cachedAgentCommands = s.agentCommands
  if (s.contextAlerts) contextWatcher.start()
  else contextWatcher.stop()
}

/** Start or stop the sampler to match the settings. */
function syncMonitor(s: Settings): void {
  if (s.resourceMonitor) monitor.start(s.monitorIntervalSec)
  else monitor.stop()
}

const layoutFile = (): string => join(dataDir(), 'layout.json')

/** The same icon.ico electron-builder embeds in the exe (copied to resources when packaged). */
const appIconPath = (): string =>
  app.isPackaged
    ? join(process.resourcesPath, 'icon.ico')
    : join(app.getAppPath(), 'build', 'icon.ico')

async function createWindow(): Promise<void> {
  win = new BrowserWindow({
    icon: appIconPath(),
    width: 1500,
    height: 900,
    minWidth: 900,
    minHeight: 600,
    backgroundColor: '#1e1e1e',
    title: 'CIBoard',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  })
  win.setMenuBarVisibility(false)
  // The page title must not replace the title that shows whether we run as administrator.
  const title = (await isAppElevated()) ? 'CIBoard — Administrator' : 'CIBoard'
  win.setTitle(title)
  win.on('page-title-updated', (e) => e.preventDefault())
  // Terminal links open in the default browser; the app itself never navigates away.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//i.test(url)) void shell.openExternal(url)
    return { action: 'deny' }
  })
  if (process.env.ELECTRON_RENDERER_URL) void win.loadURL(process.env.ELECTRON_RENDERER_URL)
  else void win.loadFile(join(__dirname, '../renderer/index.html'))
  win.on('closed', () => (win = null))
}

ipcMain.handle(Invoke.ptyCreate, async (_e, req: SpawnRequest) => {
  const profile = await getProfile(req.profileId)
  if (!profile) throw new Error(`Unknown profile: ${req.profileId}`)
  // A stale restored cwd must not stop the shell from starting.
  const wanted = req.cwd ?? profile.cwd
  const cwd = wanted && existsSync(wanted) ? wanted : undefined
  const settings = await getSettings()
  const integration = buildIntegration(profile, settings.shellIntegration)

  // Elevation only ever happens because the user asked for this terminal to be admin.
  const wantAdmin = req.admin ?? profile.admin
  const appElevated = await isAppElevated()
  let file = profile.file
  let args = integration.args
  if (wantAdmin && !appElevated) {
    if (settings.adminMode === 'whole-app')
      throw new Error(
        'Administrator mode is set to "whole app", and CIBoard is not running as administrator.\n' +
          'Use File > Restart as Administrator, or switch File > Administrator mode to "per terminal".'
      )
    const plan = await planElevation(realDeps())
    if (!plan.ok) throw new Error(plan.message)
    ;({ file, args } = wrapWithHelper(plan, file, args))
  }
  const elevated = wantAdmin || appElevated
  const result = ptys.create({
    file,
    args,
    cwd,
    env: { ...profile.env, ...integration.env },
    cols: req.cols,
    rows: req.rows
  })
  const logFile = history.start(
    {
      sessionId: result.id,
      title: req.title,
      profileName: profile.name,
      shell: profile.kind === 'gitbash' ? 'bash' : profile.kind,
      cols: req.cols,
      rows: req.rows,
      elevated
    },
    req.paused ?? false
  )
  return { ...result, logFile, elevated }
})
ipcMain.on(Invoke.ptyWrite, (_e, id: string, data: string) => ptys.write(id, data))
ipcMain.on(Invoke.ptyResize, (_e, id: string, c: number, r: number) => {
  ptys.resize(id, c, r)
  history.resize(id, c, r)
})
ipcMain.on(Invoke.ptyKill, (_e, id: string) => ptys.kill(id))

ipcMain.handle(Invoke.workflowList, (_e, root: string) => listWorkflows(root))
ipcMain.handle(Invoke.workflowRun, async (_e, root: string, req: WorkflowRunRequest) => {
  const wf = await readWorkflow(root, req.file)
  if (!wf.steps.length) throw new Error('This file has no steps.')
  return workflows.start(req, wf.steps)
})
ipcMain.handle(Invoke.workflowSkills, (_e, root: string) => listInstalledSkills(root))
ipcMain.handle(Invoke.workflowDecide, (_e, id: string, go: boolean, reason: string) =>
  workflows.decide(id, go, String(reason ?? ''))
)
ipcMain.handle(Invoke.workflowBuiltin, (_e, root: string) => listBuiltin(root))
ipcMain.handle(Invoke.workflowInstall, (_e, root: string, names: string[]) =>
  installBuiltin(root, names)
)
ipcMain.on(Invoke.workflowStop, (_e, id: string) => workflows.stop(id))

ipcMain.handle(Invoke.appInfo, async () => ({
  elevated: await isAppElevated(),
  adminMode: (await getSettings()).adminMode,
  defaultHistoryDir: join(dataDir(), 'history')
}))
ipcMain.handle(Invoke.appRestartAdmin, restartAsAdmin)

ipcMain.handle(Invoke.profilesList, () => listProfiles())
ipcMain.handle(Invoke.settingsGet, () => getSettings())
/** Apply a settings change everywhere it matters and tell the renderer. */
async function applySettings(patch: Partial<Settings>): Promise<Settings> {
  const s = await setSettings(patch)
  const before = currentHistoryDir()
  await refreshHistoryDir()
  if (before !== currentHistoryDir()) void history.buildIndex()
  history.refreshRedaction()
  nativeTheme.themeSource = s.theme
  syncMonitor(s)
  syncContextWatcher(s)
  void history.enforceRetention()
  send(Push.settingsChanged, s)
  return s
}

ipcMain.handle(Invoke.settingsSet, (_e, patch: Partial<Settings>) => applySettings(patch))
ipcMain.handle(Invoke.sessionSetLogging, (_e, id: string, enabled: boolean) =>
  history.setPaused(id, !enabled)
)
ipcMain.handle(Invoke.dialogPickFolder, async (_e, current?: string) => {
  const r = await dialog.showOpenDialog(win!, {
    properties: ['openDirectory', 'createDirectory'],
    defaultPath: current
  })
  return r.canceled ? null : (r.filePaths[0] ?? null)
})

async function confirmDelete(message: string, detail: string, button: string): Promise<boolean> {
  const r = await dialog.showMessageBox(win!, {
    type: 'warning',
    buttons: [button, 'Cancel'],
    defaultId: 1,
    cancelId: 1,
    message,
    detail
  })
  return r.response === 0
}

ipcMain.handle(Invoke.historyClearSession, async (_e, rawFile: string) => {
  if (!insideHistory(rawFile)) throw new Error('Not a history file')
  const ok = await confirmDelete(
    'Delete this session’s history?',
    'The structured history and the raw transcript of this session are deleted permanently.',
    'Delete'
  )
  if (ok) await history.clearSession(rawFile)
  return ok
})
ipcMain.handle(Invoke.historyClearAll, async () => {
  const ok = await confirmDelete(
    'Delete ALL history?',
    `Everything in ${currentHistoryDir()} is deleted permanently, for every session and every day.`,
    'Delete everything'
  )
  if (ok) await history.clearAll()
  return ok
})
ipcMain.handle(Invoke.historyExport, async (_e, rawFile: string) => {
  if (!insideHistory(rawFile)) throw new Error('Not a history file')
  const out = await buildSessionExport(rawFile, currentHistoryDir())
  const r = await dialog.showSaveDialog(win!, {
    title: 'Export session history',
    defaultPath: join(app.getPath('documents'), out.name),
    filters: [{ name: 'Markdown', extensions: ['md'] }]
  })
  if (r.canceled || !r.filePath) return null
  await writeFile(r.filePath, out.markdown, 'utf8')
  shell.showItemInFolder(r.filePath)
  return r.filePath
})
ipcMain.handle(Invoke.clipboardRead, () => clipboard.readText())
ipcMain.on(Invoke.clipboardWrite, (_e, text: string) => clipboard.writeText(String(text)))
ipcMain.handle(Invoke.layoutLoad, () => readJson<LayoutFile>(layoutFile()))
ipcMain.on(Invoke.layoutSave, (_e, layout: LayoutFile) => void writeJson(layoutFile(), layout))

ipcMain.handle(Invoke.historyList, () => listHistoryFiles())
ipcMain.handle(Invoke.historyRead, (_e, file: string) => readHistoryTail(file))
ipcMain.handle(Invoke.historySessionFile, (_e, id: string) => history.fileOf(id))
ipcMain.handle(Invoke.historyEntries, (_e, rawFile: string) => readEntries(rawFile))
ipcMain.handle(Invoke.historySearch, (_e, query: string, files: string[] | null) =>
  history.index.search(query, files)
)
ipcMain.handle(Invoke.historyOpen, async (_e, file: string, kind: 'md' | 'raw') => {
  if (!insideHistory(file)) throw new Error('Not a history file')
  const err = await shell.openPath(kind === 'md' ? mdPathOf(file) : file)
  if (err) throw new Error(err)
})
const openHistoryFolder = async (): Promise<void> => {
  await mkdir(currentHistoryDir(), { recursive: true })
  await shell.openPath(currentHistoryDir())
}
ipcMain.handle(Invoke.historyOpenFolder, openHistoryFolder)

/** Relaunch the whole app through the `runas` verb. The UAC prompt is Windows', not ours. */
async function restartAsAdmin(): Promise<boolean> {
  if (await isAppElevated()) return false
  const ok = await relaunchElevated(process.cwd(), process.execPath, process.argv.slice(1))
  if (ok) {
    // Give the renderer a moment to flush layout.json before the new instance reads it.
    setTimeout(() => app.quit(), 600)
  }
  return ok
}

async function setAdminMode(mode: AdminMode): Promise<void> {
  await applySettings({ adminMode: mode })
  await buildMenu()
}

async function buildMenu(): Promise<void> {
  const elevated = await isAppElevated()
  const mode = (await getSettings()).adminMode
  Menu.setApplicationMenu(
    Menu.buildFromTemplate([
      {
        label: 'File',
        submenu: [
          {
            label: 'Settings…',
            accelerator: 'CmdOrCtrl+,',
            click: () => send(Push.openSettings, null)
          },
          { label: 'Open history folder', click: () => void openHistoryFolder() },
          { type: 'separator' },
          {
            label: 'Administrator mode',
            submenu: [
              {
                label: 'Per terminal (sudo / gsudo)',
                type: 'radio',
                checked: mode === 'per-terminal',
                click: () => void setAdminMode('per-terminal')
              },
              {
                label: 'Whole app elevated',
                type: 'radio',
                checked: mode === 'whole-app',
                click: () => void setAdminMode('whole-app')
              }
            ]
          },
          {
            label: elevated ? 'Running as Administrator' : 'Restart as Administrator…',
            enabled: !elevated,
            click: () => void restartAsAdmin()
          },
          { type: 'separator' },
          { role: 'quit' }
        ]
      },
      // No Edit menu: its Ctrl+V / Ctrl+C accelerators paste natively on top of the terminal's own
      // clipboard handling, which doubled every paste.
      {
        // No zoom roles: Ctrl +/-/0 and Ctrl+wheel change the terminal font size instead.
        label: 'View',
        submenu: [
          { role: 'reload' },
          { role: 'toggleDevTools' },
          { type: 'separator' },
          { role: 'togglefullscreen' }
        ]
      }
    ])
  )
}

// Same id the installer gives its shortcuts: the taskbar then groups the window under our icon
// instead of electron.exe's (matters most when running unpackaged).
app.setAppUserModelId('com.ciboard.app')

app.whenReady().then(async () => {
  await refreshHistoryDir()
  const startup = await getSettings()
  nativeTheme.themeSource = startup.theme
  syncMonitor(startup)
  syncContextWatcher(startup)
  void history.buildIndex().then(() => history.enforceRetention())
  setInterval(() => void history.enforceRetention(), 60 * 60 * 1000)
  await buildMenu()
  await createWindow()
})

// Let transcript streams flush before the process exits.
let flushed = false
app.on('before-quit', (e) => {
  monitor.stop()
  contextWatcher.stop()
  ptys.killAll()
  if (flushed) return
  e.preventDefault()
  void history.closeAll().finally(() => {
    flushed = true
    app.quit()
  })
})
app.on('window-all-closed', () => app.quit())
