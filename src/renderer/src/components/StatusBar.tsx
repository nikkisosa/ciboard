import { fmtBytes, fmtPct, level, useMonitor } from '../monitorStore'

const W = 64
const H = 16

/** Tiny area chart of 0-100 values (oldest left). */
function Spark({ values, cls }: { values: number[]; cls: string }): React.JSX.Element {
  if (values.length < 2) return <svg className="spark" width={W} height={H} />
  const step = W / (values.length - 1)
  const pts = values.map(
    (v, i) => `${(i * step).toFixed(1)},${(H - 1 - (Math.min(100, v) / 100) * (H - 2)).toFixed(1)}`
  )
  return (
    <svg className={`spark ${cls}`} width={W} height={H} aria-hidden>
      <polygon points={`0,${H} ${pts.join(' ')} ${W},${H}`} className="area" />
      <polyline points={pts.join(' ')} className="line" />
    </svg>
  )
}

/** Machine, app and terminal CPU / memory at the bottom of the window. */
export function StatusBar(): React.JSX.Element | null {
  const { latest, cpu, mem } = useMonitor()
  if (!latest) return null
  const { system, app, sessions, cores } = latest
  const memPct = (system.memUsed / system.memTotal) * 100
  const terms = Object.values(sessions)
  const termCpu = terms.reduce((a, s) => a + s.cpu, 0)
  const termMem = terms.reduce((a, s) => a + s.mem, 0)

  return (
    <footer className="statusbar">
      <span
        className={`stat ${level(system.cpu)}`}
        title={`CPU of the whole machine (${cores} logical cores)`}
      >
        CPU <b>{fmtPct(system.cpu)}</b>
        <Spark values={cpu} cls={level(system.cpu)} />
      </span>
      <span
        className={`stat ${level(memPct)}`}
        title={`Memory in use: ${fmtBytes(system.memUsed)} of ${fmtBytes(system.memTotal)}`}
      >
        RAM{' '}
        <b>
          {fmtBytes(system.memUsed)} / {fmtBytes(system.memTotal)}
        </b>{' '}
        ({Math.round(memPct)}%)
        <Spark values={mem} cls={level(memPct)} />
      </span>
      <span className="grow" />
      <span className="stat dim" title="All terminals: the shells and every program they started">
        Terminals <b>{terms.length}</b>
        {terms.length > 0 && (
          <>
            {' · '}
            {fmtPct(termCpu)} · {fmtBytes(termMem)}
          </>
        )}
      </span>
      <span className="stat dim" title="CIBoard itself (main, renderer, GPU and helper processes)">
        CIBoard {fmtPct(app.cpu)} · {fmtBytes(app.mem)}
      </span>
    </footer>
  )
}

/** Small CPU / memory chip for one terminal (shell plus everything it started). */
export function UsageChip({ sessionId }: { sessionId: string | null }): React.JSX.Element | null {
  const { latest } = useMonitor()
  const u = sessionId ? latest?.sessions[sessionId] : undefined
  if (!u) return null
  return (
    <span
      className={`usage ${level(u.cpu * 4)}`}
      title={`This terminal: ${fmtPct(u.cpu)} of the machine's CPU, ${fmtBytes(u.mem)} memory, ${u.procs} process${u.procs === 1 ? '' : 'es'}`}
    >
      {fmtPct(u.cpu)} · {fmtBytes(u.mem)}
    </span>
  )
}
