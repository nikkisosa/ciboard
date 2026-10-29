import { contextBridge, ipcRenderer } from 'electron'
import { Invoke, Push, type CiBoardApi } from '../shared/ipc'
import type {
  ContextUsage,
  HistoryAppend,
  HistoryEntry,
  HistoryRunning,
  ResourceSample,
  Settings,
  WorkflowRunState
} from '../shared/types'

const api: CiBoardApi = {
  pty: {
    create: (req) => ipcRenderer.invoke(Invoke.ptyCreate, req),
    write: (id, data) => ipcRenderer.send(Invoke.ptyWrite, id, data),
    resize: (id, cols, rows) => ipcRenderer.send(Invoke.ptyResize, id, cols, rows),
    kill: (id) => ipcRenderer.send(Invoke.ptyKill, id),
    onData: (cb) => {
      const h = (_e: unknown, id: string, data: string): void => cb(id, data)
      ipcRenderer.on(Push.ptyData, h)
      return () => ipcRenderer.removeListener(Push.ptyData, h)
    },
    onExit: (cb) => {
      const h = (_e: unknown, id: string, code: number): void => cb(id, code)
      ipcRenderer.on(Push.ptyExit, h)
      return () => ipcRenderer.removeListener(Push.ptyExit, h)
    }
  },
  profiles: { list: () => ipcRenderer.invoke(Invoke.profilesList) },
  settings: {
    get: () => ipcRenderer.invoke(Invoke.settingsGet),
    set: (patch) => ipcRenderer.invoke(Invoke.settingsSet, patch),
    onChanged: (cb) => {
      const h = (_e: unknown, s: Settings): void => cb(s)
      ipcRenderer.on(Push.settingsChanged, h)
      return () => ipcRenderer.removeListener(Push.settingsChanged, h)
    }
  },
  dialog: { pickFolder: (current) => ipcRenderer.invoke(Invoke.dialogPickFolder, current) },
  layout: {
    load: () => ipcRenderer.invoke(Invoke.layoutLoad),
    save: (layout) => ipcRenderer.send(Invoke.layoutSave, layout)
  },
  monitor: {
    onSample: (cb) => {
      const h = (_e: unknown, s: ResourceSample): void => cb(s)
      ipcRenderer.on(Push.monitorSample, h)
      return () => ipcRenderer.removeListener(Push.monitorSample, h)
    }
  },
  context: {
    onUsage: (cb) => {
      const h = (_e: unknown, u: Record<string, ContextUsage>): void => cb(u)
      ipcRenderer.on(Push.contextUsage, h)
      return () => ipcRenderer.removeListener(Push.contextUsage, h)
    }
  },
  workflow: {
    list: (root) => ipcRenderer.invoke(Invoke.workflowList, root),
    run: (root, req) => ipcRenderer.invoke(Invoke.workflowRun, root, req),
    stop: (runId) => ipcRenderer.send(Invoke.workflowStop, runId),
    decide: (runId, go, reason) => ipcRenderer.invoke(Invoke.workflowDecide, runId, go, reason),
    builtin: (root) => ipcRenderer.invoke(Invoke.workflowBuiltin, root),
    install: (root, names) => ipcRenderer.invoke(Invoke.workflowInstall, root, names),
    skills: (root) => ipcRenderer.invoke(Invoke.workflowSkills, root),
    onState: (cb) => {
      const h = (_e: unknown, s: WorkflowRunState): void => cb(s)
      ipcRenderer.on(Push.workflowState, h)
      return () => ipcRenderer.removeListener(Push.workflowState, h)
    }
  },
  clipboard: {
    readText: () => ipcRenderer.invoke(Invoke.clipboardRead),
    writeText: (text) => ipcRenderer.send(Invoke.clipboardWrite, text)
  },
  app: {
    info: () => ipcRenderer.invoke(Invoke.appInfo),
    restartAsAdmin: () => ipcRenderer.invoke(Invoke.appRestartAdmin),
    onOpenSettings: (cb) => {
      const h = (): void => cb()
      ipcRenderer.on(Push.openSettings, h)
      return () => ipcRenderer.removeListener(Push.openSettings, h)
    }
  },
  history: {
    list: () => ipcRenderer.invoke(Invoke.historyList),
    read: (file) => ipcRenderer.invoke(Invoke.historyRead, file),
    sessionFile: (id) => ipcRenderer.invoke(Invoke.historySessionFile, id),
    entries: (rawFile) => ipcRenderer.invoke(Invoke.historyEntries, rawFile),
    search: (query, files) => ipcRenderer.invoke(Invoke.historySearch, query, files),
    open: (file, kind) => ipcRenderer.invoke(Invoke.historyOpen, file, kind),
    openFolder: () => ipcRenderer.invoke(Invoke.historyOpenFolder),
    clearSession: (rawFile) => ipcRenderer.invoke(Invoke.historyClearSession, rawFile),
    clearAll: () => ipcRenderer.invoke(Invoke.historyClearAll),
    export: (rawFile) => ipcRenderer.invoke(Invoke.historyExport, rawFile),
    onAppend: (cb) => {
      const h = (_e: unknown, ev: HistoryAppend): void => cb(ev)
      ipcRenderer.on(Push.historyAppend, h)
      return () => ipcRenderer.removeListener(Push.historyAppend, h)
    },
    onEntry: (cb) => {
      const h = (_e: unknown, ev: { sessionId: string; entry: HistoryEntry }): void => cb(ev)
      ipcRenderer.on(Push.historyEntry, h)
      return () => ipcRenderer.removeListener(Push.historyEntry, h)
    },
    onRunning: (cb) => {
      const h = (_e: unknown, ev: { sessionId: string; running: HistoryRunning | null }): void =>
        cb(ev)
      ipcRenderer.on(Push.historyRunning, h)
      return () => ipcRenderer.removeListener(Push.historyRunning, h)
    }
  },
  session: {
    setLogging: (sessionId, enabled) =>
      ipcRenderer.invoke(Invoke.sessionSetLogging, sessionId, enabled),
    onCwd: (cb) => {
      const h = (_e: unknown, ev: { sessionId: string; cwd: string }): void =>
        cb(ev.sessionId, ev.cwd)
      ipcRenderer.on(Push.sessionCwd, h)
      return () => ipcRenderer.removeListener(Push.sessionCwd, h)
    }
  }
}

contextBridge.exposeInMainWorld('ciboard', api)
