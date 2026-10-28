import type { SessionUsage } from '../../shared/types'

/** One row of the process table: `pid,ppid,cpu100ns,workingSetBytes`. */
export interface ProcRow {
  pid: number
  ppid: number
  /** Cumulative kernel + user CPU time in 100 ns units. */
  cpu: number
  /** Working set in bytes. */
  mem: number
}

/** `1234,500,98765000,41234567;1235,1234,...` -> rows; malformed entries are skipped. */
export function parseProcLine(line: string): ProcRow[] {
  const rows: ProcRow[] = []
  for (const item of line.trim().split(';')) {
    const [pid, ppid, cpu, mem] = item.split(',').map(Number)
    if ([pid, ppid, cpu, mem].every(Number.isFinite) && pid > 0) rows.push({ pid, ppid, cpu, mem })
  }
  return rows
}

/** `root` and every process below it (children, grandchildren, ...). Cycle-safe. */
export function descendants(rows: readonly ProcRow[], root: number): Set<number> {
  const kids = new Map<number, number[]>()
  for (const r of rows) {
    const list = kids.get(r.ppid)
    if (list) list.push(r.pid)
    else kids.set(r.ppid, [r.pid])
  }
  const tree = new Set<number>()
  const queue = [root]
  while (queue.length) {
    const pid = queue.pop()!
    if (tree.has(pid)) continue
    tree.add(pid)
    queue.push(...(kids.get(pid) ?? []))
  }
  return tree
}

/**
 * CPU and memory per terminal session.
 *
 * CPU is the growth of each process's cumulative CPU time since the previous sample, summed over
 * the session's process tree and expressed as % of the whole machine. A process seen for the first
 * time contributes nothing (its history before we looked is not "recent load"), and an exited
 * process simply drops out, so the total can never go negative.
 */
export function sessionUsage(
  prev: ReadonlyMap<number, number>,
  rows: readonly ProcRow[],
  sessionPids: ReadonlyMap<string, number>,
  elapsedSec: number,
  cores: number
): Record<string, SessionUsage> {
  const byPid = new Map(rows.map((r) => [r.pid, r]))
  const out: Record<string, SessionUsage> = {}
  const capacity = Math.max(0.001, elapsedSec) * 1e7 * Math.max(1, cores) // 100ns ticks available
  for (const [id, root] of sessionPids) {
    if (!byPid.has(root)) continue
    let ticks = 0
    let mem = 0
    const tree = descendants(rows, root)
    for (const pid of tree) {
      const r = byPid.get(pid)
      if (!r) continue
      mem += r.mem
      const before = prev.get(pid)
      if (before !== undefined && r.cpu >= before) ticks += r.cpu - before
    }
    out[id] = { cpu: Math.min(100, (ticks / capacity) * 100), mem, procs: tree.size }
  }
  return out
}

/** Cumulative CPU per pid, kept for the next `sessionUsage` call. */
export const cpuTable = (rows: readonly ProcRow[]): Map<number, number> =>
  new Map(rows.map((r) => [r.pid, r.cpu]))

export interface CpuTimes {
  idle: number
  total: number
}

/** Sum the per-core `os.cpus()` times. */
export function sumCpuTimes(
  cpus: readonly { times: { user: number; nice: number; sys: number; idle: number; irq: number } }[]
): CpuTimes {
  let idle = 0
  let total = 0
  for (const c of cpus) {
    const t = c.times
    idle += t.idle
    total += t.user + t.nice + t.sys + t.idle + t.irq
  }
  return { idle, total }
}

/** Busy % of the whole machine between two snapshots. */
export function cpuPercent(prev: CpuTimes, cur: CpuTimes): number {
  const total = cur.total - prev.total
  if (total <= 0) return 0
  return Math.max(0, Math.min(100, (1 - (cur.idle - prev.idle) / total) * 100))
}
