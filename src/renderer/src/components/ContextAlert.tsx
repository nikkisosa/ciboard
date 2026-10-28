import { dismissContextAlert, useContextUsage } from '../contextMonitor'
import { useSettings } from '../settingsStore'

/** Context used by the Claude session in a terminal, when its screen shows a figure. */
export function ContextChip({ sessionId }: { sessionId: string | null }): React.JSX.Element | null {
  const { percent } = useContextUsage()
  const limit = useSettings()?.contextAlertPercent ?? 40
  const used = sessionId ? percent[sessionId] : undefined
  if (used === undefined) return null
  const cls = used >= limit ? 'hot' : used >= limit * 0.75 ? 'warn' : 'ok'
  return (
    <span
      className={`ctx-chip ${cls}`}
      title={`Claude context used in this terminal (alert at ${limit}%)`}
    >
      ctx {used}%
    </span>
  )
}

/** The critical alert over a terminal whose Claude session passed the context limit. */
export function ContextBanner({
  sessionId
}: {
  sessionId: string | null
}): React.JSX.Element | null {
  const { alerts } = useContextUsage()
  const limit = useSettings()?.contextAlertPercent ?? 40
  const used = sessionId ? alerts[sessionId] : undefined
  if (!sessionId || used === undefined) return null
  return (
    <div className="ctx-alert tile-nodrag" role="alert">
      <span className="ctx-alert-text">
        <b>CRITICAL</b> · context {used}% used (limit {limit}%) — run /compact or start a new
        session
      </span>
      <button onClick={() => dismissContextAlert(sessionId)}>Dismiss</button>
    </div>
  )
}

/** Whether this session is currently in the critical state. */
export function useContextCritical(sessionId: string | null): boolean {
  const { alerts } = useContextUsage()
  return sessionId !== null && sessionId in alerts
}
