import { useSyncExternalStore } from 'react'
import type { ResourceSample } from '@shared/types'

/** Samples kept for the sparklines (about 3 minutes at the default 2 s interval). */
const HISTORY = 90

export interface MonitorState {
  latest: ResourceSample | null
  cpu: number[]
  mem: number[]
}

let state: MonitorState = { latest: null, cpu: [], mem: [] }
const listeners = new Set<() => void>()
let started = false

function push(history: number[], value: number): number[] {
  const next = history.length >= HISTORY ? history.slice(1) : history.slice()
  next.push(value)
  return next
}

/** Subscribe to samples from the main process (safe to call more than once). */
export function initMonitor(): void {
  if (started) return
  started = true
  window.ciboard.monitor.onSample((s) => {
    state = {
      latest: s,
      cpu: push(state.cpu, s.system.cpu),
      mem: push(state.mem, (s.system.memUsed / s.system.memTotal) * 100)
    }
    listeners.forEach((l) => l())
  })
}

/** Forget everything (the monitor was switched off, so old numbers must not linger). */
export function resetMonitor(): void {
  state = { latest: null, cpu: [], mem: [] }
  listeners.forEach((l) => l())
}

const subscribe = (l: () => void): (() => void) => {
  listeners.add(l)
  return () => listeners.delete(l)
}

export const useMonitor = (): MonitorState => useSyncExternalStore(subscribe, () => state)

export function fmtBytes(bytes: number): string {
  const gb = bytes / 1024 ** 3
  if (gb >= 1) return `${gb.toFixed(gb >= 10 ? 0 : 1)} GB`
  return `${Math.round(bytes / 1024 ** 2)} MB`
}

export const fmtPct = (n: number): string => `${n < 10 ? n.toFixed(1) : Math.round(n)}%`

/** Colour class for a load percentage. */
export const level = (pct: number): 'ok' | 'warn' | 'hot' =>
  pct >= 85 ? 'hot' : pct >= 60 ? 'warn' : 'ok'
