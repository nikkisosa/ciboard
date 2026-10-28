import { spawn, type ChildProcess } from 'node:child_process'
import { app } from 'electron'
import { cpus, freemem, totalmem } from 'node:os'
import type { ResourceSample, SessionUsage } from '../../shared/types'
import {
  cpuPercent,
  cpuTable,
  parseProcLine,
  sessionUsage,
  sumCpuTimes,
  type CpuTimes
} from './usage'

/**
 * Prints one line per sample: `pid,ppid,cpu100ns,workingSetBytes;...` (read-only process list).
 * Passed with -Command rather than as a .ps1 file: no execution-policy problems, nothing to ship.
 */
export const samplerScript = (intervalMs: number): string =>
  [
    "$ErrorActionPreference='SilentlyContinue'",
    'while($true){',
    '$r=Get-CimInstance -ClassName Win32_Process -Property ProcessId,ParentProcessId,KernelModeTime,UserModeTime,WorkingSetSize',
    "$l=($r|ForEach-Object{'{0},{1},{2},{3}' -f $_.ProcessId,$_.ParentProcessId,([uint64]$_.KernelModeTime+[uint64]$_.UserModeTime),$_.WorkingSetSize}) -join ';'",
    '[Console]::Out.WriteLine($l);[Console]::Out.Flush()',
    `Start-Sleep -Milliseconds ${Math.round(intervalMs)}`,
    '}'
  ].join(';')

export interface MonitorDeps {
  /** Terminal session id -> pid of the process the pty started. */
  sessionPids(): Map<string, number>
  emit(sample: ResourceSample): void
}

/**
 * Samples CPU and memory: the machine (os module), CIBoard itself (Electron metrics) and, through
 * a hidden long-lived PowerShell, every terminal's process tree. Stopped means no process and no
 * timer, so turning the monitor off in Settings costs nothing.
 */
export class ResourceMonitor {
  private timer: NodeJS.Timeout | null = null
  private child: ChildProcess | null = null
  private restarts = 0
  private lastCpu: CpuTimes = sumCpuTimes(cpus())
  private prevProc: Map<number, number> | null = null
  private prevProcAt = 0
  private sessions: Record<string, SessionUsage> = {}
  private intervalMs = 2000

  constructor(private deps: MonitorDeps) {}

  get running(): boolean {
    return this.timer !== null
  }

  start(intervalSec: number): void {
    this.stop()
    this.intervalMs = Math.max(1, Math.min(30, intervalSec)) * 1000
    this.lastCpu = sumCpuTimes(cpus())
    this.restarts = 0
    this.timer = setInterval(() => this.tick(), this.intervalMs)
    this.startSampler()
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer)
    this.timer = null
    this.child?.removeAllListeners('exit')
    this.child?.kill()
    this.child = null
    this.prevProc = null
    this.sessions = {}
  }

  private startSampler(): void {
    let buffer = ''
    const child = spawn(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-Command', samplerScript(this.intervalMs)],
      { windowsHide: true, stdio: ['ignore', 'pipe', 'ignore'] }
    )
    this.child = child
    child.stdout!.setEncoding('utf8')
    child.stdout!.on('data', (chunk: string) => {
      buffer += chunk
      let nl: number
      while ((nl = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, nl)
        buffer = buffer.slice(nl + 1)
        this.onProcLine(line)
      }
    })
    child.on('error', () => (this.child = null))
    child.on('exit', () => {
      this.child = null
      // PowerShell died unexpectedly: retry a few times, then carry on with machine stats only.
      if (this.timer && this.restarts++ < 3)
        setTimeout(() => this.timer && this.startSampler(), 2000)
    })
  }

  private onProcLine(line: string): void {
    const rows = parseProcLine(line)
    if (rows.length === 0) return
    const now = Date.now()
    if (this.prevProc) {
      this.sessions = sessionUsage(
        this.prevProc,
        rows,
        this.deps.sessionPids(),
        (now - this.prevProcAt) / 1000,
        cpus().length
      )
    }
    this.prevProc = cpuTable(rows)
    this.prevProcAt = now
  }

  private tick(): void {
    const cores = cpus().length
    const cur = sumCpuTimes(cpus())
    const system = {
      cpu: cpuPercent(this.lastCpu, cur),
      memUsed: totalmem() - freemem(),
      memTotal: totalmem()
    }
    this.lastCpu = cur

    let appCpu = 0
    let appMem = 0
    for (const m of app.getAppMetrics()) {
      appCpu += m.cpu.percentCPUUsage // 100 = one full core
      appMem += m.memory.workingSetSize * 1024 // KB -> bytes
    }
    this.deps.emit({
      time: Date.now(),
      cores,
      system,
      app: { cpu: Math.min(100, appCpu / cores), mem: appMem },
      sessions: this.sessions
    })
  }
}
