import { useEffect, useRef, useState } from 'react'
import type {
  BuiltinWorkflow,
  InstalledSkill,
  WorkflowFile,
  WorkflowRunState,
  WorkflowStepStatus
} from '@shared/types'
import { AGENTS, agentLabel } from '@shared/agents'
import type { WorkspaceState } from '../workspace'

interface Props {
  ws: WorkspaceState
  onClose: () => void
}

const MARK: Record<WorkflowStepStatus, string> = {
  pending: '○',
  running: '▶',
  waiting: '⏸',
  done: '✓',
  failed: '✗',
  skipped: '–'
}

export function WorkflowDialog({ ws, onClose }: Props): React.JSX.Element {
  const tile = ws.tiles.find((t) => t.id === ws.activeTileId) ?? null
  /** Terminals that are running a shell and can receive a step. */
  const terminals = ws.tiles
    .filter((t) => ws.runtime[t.id]?.sessionId && ws.runtime[t.id]?.status === 'running')
    .map((t) => ({ sessionId: ws.runtime[t.id]!.sessionId!, title: t.title, active: t === tile }))
  const [root, setRoot] = useState(tile?.cwd ?? '')
  const [files, setFiles] = useState<WorkflowFile[]>([])
  const [builtin, setBuiltin] = useState<BuiltinWorkflow[]>([])
  const [reload, setReload] = useState(0)
  const [want, setWant] = useState<string | null>(null)
  const [selected, setSelected] = useState<string | null>(null)
  const [launch, setLaunch] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [run, setRun] = useState<WorkflowRunState | null>(null)
  const [why, setWhy] = useState('')
  const [skills, setSkills] = useState<InstalledSkill[]>([])
  const [assign, setAssign] = useState<Record<string, string>>({})

  useEffect(() => {
    const h = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', h)
    return () => window.removeEventListener('keydown', h)
  }, [onClose])

  useEffect(
    () =>
      window.ciboard.workflow.onState((s) => {
        setRun((cur) =>
          cur && cur.runId !== s.runId && cur.state === 'running'
            ? cur
            : Object.values(s.targets).some((id) => Object.values(assignRef.current).includes(id))
              ? s
              : cur
        )
      }),
    []
  )

  useEffect(() => {
    if (!root) return
    let alive = true
    window.ciboard.workflow
      .list(root)
      .then((f) => {
        if (!alive) return
        setFiles(f)
        setError(null)
        setSelected((cur) => {
          const wanted = f.find((x) => want && x.file.toLowerCase().endsWith(want))
          if (wanted) return wanted.file
          return f.some((x) => x.file === cur) ? cur : (f[0]?.file ?? null)
        })
      })
      .catch((e: unknown) => {
        if (!alive) return
        setFiles([])
        setError(e instanceof Error ? e.message : String(e))
      })
    window.ciboard.workflow
      .builtin(root)
      .then((b) => alive && setBuiltin(b))
      .catch(() => alive && setBuiltin([]))
    return () => {
      alive = false
    }
    // `want` only steers which file is selected after an install; it must not reload by itself.
  }, [root, reload])

  const install = (names: string[]): void => {
    setError(null)
    window.ciboard.workflow
      .install(root, names)
      .then(() => {
        setWant(names.length === 1 ? `${names[0]}.md`.toLowerCase() : null)
        setReload((n) => n + 1)
      })
      .catch((e: unknown) => setError(e instanceof Error ? e.message : String(e)))
  }

  useEffect(() => {
    if (!root) return
    let alive = true
    window.ciboard.workflow
      .skills(root)
      .then((s) => alive && setSkills(s))
      .catch(() => alive && setSkills([]))
    return () => {
      alive = false
    }
  }, [root])

  const file = files.find((f) => f.file === selected) ?? null
  const agentsUsed = [...new Set(file?.steps.map((s) => s.agent) ?? [])]

  // Give every agent of the workflow a terminal: one whose title names it, else the active one for
  // the first agent, else any unused one. Choices the person made are kept while they stay valid.
  useEffect(() => {
    setAssign((cur) => {
      const next: Record<string, string> = {}
      const used = new Set<string>()
      for (const a of agentsUsed) {
        const keep = terminals.find((t) => t.sessionId === cur[a] && !used.has(t.sessionId))
        if (keep) {
          next[a] = keep.sessionId
          used.add(keep.sessionId)
        }
      }
      for (const a of agentsUsed) {
        if (next[a]) continue
        const free = terminals.filter((t) => !used.has(t.sessionId))
        const pick =
          free.find((t) => t.title.toLowerCase().includes(a)) ??
          (used.size === 0 ? free.find((t) => t.active) : undefined) ??
          free[0]
        if (pick) {
          next[a] = pick.sessionId
          used.add(pick.sessionId)
        }
      }
      return JSON.stringify(next) === JSON.stringify(cur) ? cur : next
    })
  }, [selected, files, ws.runtime, ws.tiles])
  const assignRef = useRef(assign)
  assignRef.current = assign
  const ready =
    agentsUsed.length > 0 &&
    agentsUsed.every((a) => AGENTS[a] && assign[a]) &&
    new Set(agentsUsed.map((a) => assign[a])).size === agentsUsed.length
  const running = run?.state === 'running'
  const shown = run && run.file === selected ? run : null

  const waiting = run?.steps.find((s) => s.status === 'waiting') ?? null
  const decide = (go: boolean): void => {
    if (!run) return
    window.ciboard.workflow
      .decide(run.runId, go, why)
      .then(() => {
        setWhy('')
        setError(null)
      })
      .catch((e: unknown) => setError(e instanceof Error ? e.message : String(e)))
  }

  const start = (from?: number): void => {
    if (!file || !ready) return
    setError(null)
    setRun(null)
    window.ciboard.workflow
      .run(root, { file: file.file, targets: assign, from, launch })
      .catch((e: unknown) => setError(e instanceof Error ? e.message : String(e)))
  }

  const pick = async (): Promise<void> => {
    const dir = await window.ciboard.dialog.pickFolder(root || undefined)
    if (dir) setRoot(dir)
  }

  return (
    <div className="modal-backdrop" onMouseDown={onClose}>
      <div className="modal settings wf" onMouseDown={(e) => e.stopPropagation()}>
        <h3>Workflows</h3>
        <div className="settings-pane">
          <p className="hint">
            Steps in <code>docs/knowledge/*.md</code> run one after another, each in the terminal
            you assign to the agent it names (<code>agent: claude</code>, <code>codex</code>,{' '}
            <code>copilot</code>, <code>agy</code>). A step ends when its terminal goes quiet.
          </p>
          <label>
            Project folder
            <div className="row">
              <input
                style={{ flex: 1 }}
                value={root}
                onChange={(e) => setRoot(e.target.value)}
                spellCheck={false}
              />
              <button onClick={() => void pick()}>Browse…</button>
            </div>
          </label>
          <label>
            Workflow
            <select
              value={selected ?? ''}
              onChange={(e) => setSelected(e.target.value)}
              disabled={running}
            >
              {files.length === 0 && <option value="">No workflow files yet</option>}
              {files.map((f) => (
                <option key={f.file} value={f.file}>
                  {f.name} ({f.steps.length} steps)
                </option>
              ))}
            </select>
          </label>
          {builtin.length > 0 && (
            <details open={files.length === 0}>
              <summary className="hint">
                {files.length === 0
                  ? 'No workflows in this project yet. Use a built-in one:'
                  : `Built-in workflows (${builtin.length})`}
              </summary>
              <ul className="wf-skill-list wf-builtin">
                {builtin.map((b) => (
                  <li key={b.name}>
                    <span className="wf-title" title={b.title}>
                      {b.title} <span className="wf-agent">({b.steps} steps)</span>
                    </span>
                    <button disabled={b.installed || running} onClick={() => install([b.name])}>
                      {b.installed ? 'Added' : 'Add to project'}
                    </button>
                  </li>
                ))}
              </ul>
              {builtin.some((b) => !b.installed) && (
                <button
                  disabled={running || !root}
                  onClick={() => install(builtin.filter((b) => !b.installed).map((b) => b.name))}
                >
                  Add all to docs/knowledge
                </button>
              )}
            </details>
          )}
          {file && (
            <ol className="wf-steps">
              {file.steps.map((s) => {
                const st = shown?.steps.find((x) => x.index === s.index)?.status ?? 'pending'
                return (
                  <li key={s.index} className={`wf-${st}`} title={s.prompt}>
                    <span className="wf-mark">{MARK[st]}</span>
                    <span className="wf-title">{s.title}</span>
                    {s.skill && (
                      <span
                        className={`wf-skill${skills.some((k) => k.name === s.skill) ? '' : ' missing'}`}
                        title={
                          skills.some((k) => k.name === s.skill)
                            ? (skills.find((k) => k.name === s.skill)?.description ?? '')
                            : 'Not found among the skills installed here. It may still exist on the account.'
                        }
                      >
                        {s.skill}
                        {skills.some((k) => k.name === s.skill) ? '' : ' ?'}
                      </span>
                    )}
                    {s.gate && <span className="wf-agent">gate</span>}
                    <span className="wf-agent">{s.agent}</span>
                    <button disabled={running || !ready} onClick={() => start(s.index)}>
                      From here
                    </button>
                  </li>
                )
              })}
            </ol>
          )}
          <details>
            <summary className="hint">Installed skills ({skills.length})</summary>
            <ul className="wf-skill-list">
              {skills.map((k) => (
                <li key={k.name} title={k.description}>
                  <code>{k.name}</code> <span className="wf-agent">{k.source}</span>
                </li>
              ))}
            </ul>
          </details>
          {agentsUsed.length > 0 && (
            <div className="wf-targets">
              <span className="hint">Terminal for each agent (each needs its own)</span>
              {agentsUsed.map((a) => (
                <label key={a}>
                  {agentLabel(a)}
                  {!AGENTS[a] && <span className="wf-error"> not supported</span>}
                  <select
                    value={assign[a] ?? ''}
                    disabled={running}
                    onChange={(e) => setAssign({ ...assign, [a]: e.target.value })}
                  >
                    <option value="">Choose a terminal…</option>
                    {terminals.map((t) => (
                      <option key={t.sessionId} value={t.sessionId}>
                        {t.title}
                      </option>
                    ))}
                  </select>
                </label>
              ))}
            </div>
          )}
          {terminals.length === 0 && (
            <p className="hint">Open a workspace with a running terminal first.</p>
          )}
          {waiting && shown && (
            <div className="wf-gate">
              <strong>
                Go / No-go after step {waiting.index}: {waiting.title}
              </strong>
              <span className="hint">Check the terminal, then decide whether to continue.</span>
              <textarea
                value={why}
                onChange={(e) => setWhy(e.target.value)}
                placeholder="Why? (required for No-go)"
                rows={2}
              />
              <div className="row">
                <button className="go" onClick={() => decide(true)}>
                  Go
                </button>
                <button className="danger" onClick={() => decide(false)}>
                  No-go
                </button>
              </div>
            </div>
          )}
          {shown?.decisions.length ? (
            <ul className="wf-skill-list">
              {shown.decisions.map((d) => (
                <li key={d.at}>
                  <strong>{d.go ? 'GO' : 'NO-GO'}</strong> step {d.index}: {d.reason || 'no reason'}
                </li>
              ))}
            </ul>
          ) : null}
          {shown?.message && <p className="hint">{shown.message}</p>}
          {shown && !running && <p className="hint">Run {shown.state}.</p>}
          {error && <p className="hint wf-error">{error}</p>}
          <label className="check">
            <input
              type="checkbox"
              checked={launch}
              disabled={running}
              onChange={(e) => setLaunch(e.target.checked)}
            />
            Start each agent in its terminal first (types its command)
          </label>
        </div>
        <div className="row" style={{ justifyContent: 'flex-end' }}>
          {running ? (
            <button
              className="danger"
              onClick={() => run && window.ciboard.workflow.stop(run.runId)}
            >
              Stop
            </button>
          ) : (
            <button disabled={!file || !ready} onClick={() => start()}>
              Run all
            </button>
          )}
          <button onClick={onClose}>Close</button>
        </div>
      </div>
    </div>
  )
}
