import { useSyncExternalStore } from 'react'
import type { ContextUsage } from '@shared/types'
import { getSettings, subscribeSettings } from './settingsStore'
import { sessionBus } from './sessionBus'
import { workspace } from './workspace'

export interface ContextState {
  /** Context used (0 - 100) per terminal session that runs Claude Code. */
  percent: Record<string, number>
  /** Sessions over the limit whose alert was not dismissed. */
  alerts: Record<string, number>
}

let state: ContextState = { percent: {}, alerts: {} }
let usage: Record<string, ContextUsage> = {}
const listeners = new Set<() => void>()
/** Sessions over the limit right now, so the alert fires once per crossing. */
const over = new Set<string>()
const dismissed = new Set<string>()
let started = false

const emit = (): void => listeners.forEach((l) => l())

function threshold(): number | null {
  const s = getSettings()
  return s && s.contextAlerts ? s.contextAlertPercent : null
}

/** Work out alerts from the latest usage figures and the current limit. */
function evaluate(): void {
  const limit = threshold()
  const percent: Record<string, number> = {}
  const alerts: Record<string, number> = {}
  for (const [id, u] of Object.entries(usage)) {
    percent[id] = u.percent
    if (limit !== null && u.percent >= limit) {
      if (!over.has(id)) {
        over.add(id)
        notify(id, u.percent)
      }
      if (!dismissed.has(id)) alerts[id] = u.percent
    } else {
      // Back under the limit (/compact, /clear, a higher limit): the next crossing alerts again.
      over.delete(id)
      dismissed.delete(id)
    }
  }
  for (const id of [...over]) if (!(id in usage)) over.delete(id)
  for (const id of [...dismissed]) if (!(id in usage)) dismissed.delete(id)
  if (!same(percent, state.percent) || !same(alerts, state.alerts)) {
    state = { percent, alerts }
    emit()
  }
}

const same = (a: Record<string, number>, b: Record<string, number>): boolean => {
  const ka = Object.keys(a)
  return ka.length === Object.keys(b).length && ka.every((k) => a[k] === b[k])
}

/** A system notification, only when the person is not already looking at that terminal. */
function notify(id: string, used: number): void {
  const t = workspace.tileForSession(id)
  if (!t || (t.visible && document.hasFocus())) return
  try {
    new Notification(`Context at ${used}% - ${t.title}`, {
      body: `${t.tabName}: this Claude session is past ${threshold()}% of its context. Compact or start fresh.`
    })
  } catch {
    // Notifications may be blocked; the in-app alert is the primary signal.
  }
}

/** Follow the context usage reported by the main process (safe to call more than once). */
export function initContextMonitor(): void {
  if (started) return
  started = true
  window.ciboard.context.onUsage((u) => {
    usage = u
    evaluate()
  })
  sessionBus().onDispose((id) => {
    if (!(id in usage)) return
    const { [id]: _gone, ...rest } = usage
    void _gone
    usage = rest
    evaluate()
  })
  // The limit (or the switch) changed in Settings: judge every known session again.
  let last = threshold()
  subscribeSettings(() => {
    const now = threshold()
    if (now === last) return
    last = now
    evaluate()
  })
}

/** Hide the alert of one session until it goes back under the limit and crosses it again. */
export function dismissContextAlert(id: string): void {
  dismissed.add(id)
  evaluate()
}

const subscribe = (l: () => void): (() => void) => {
  listeners.add(l)
  return () => listeners.delete(l)
}

export const useContextUsage = (): ContextState => useSyncExternalStore(subscribe, () => state)
