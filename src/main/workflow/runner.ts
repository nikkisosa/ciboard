import { randomUUID } from 'node:crypto'
import { AGENTS } from '../../shared/agents'
import type {
  WorkflowDecision,
  WorkflowRunRequest,
  WorkflowRunState,
  WorkflowStep,
  WorkflowStepStatus
} from '../../shared/types'

export interface RunnerDeps {
  write(sessionId: string, data: string): void
  emit(state: WorkflowRunState): void
  /** Command that starts an agent in a shell (settings may override the default). */
  command?(agent: string): string
  /** Called for every go / no-go so it can be kept on disk. */
  record?(file: string, decision: WorkflowDecision): void
  /** Quiet time (ms) after the last output before a step counts as finished. */
  idleMs?: number
  /** Pause (ms) between pasting a prompt and pressing Enter. */
  submitDelayMs?: number
  /** Longest a step may run (ms) before the run is stopped. */
  stepTimeoutMs?: number
}

/** What is typed for a step: a named skill is requested first, then the step's own text. */
export function stepPrompt(step: WorkflowStep): string {
  return step.skill ? `Use the "${step.skill}" skill for this task.\n\n${step.prompt}` : step.prompt
}

/** Prompt as one bracketed paste, so newlines inside it do not submit early. */
export function pastePayload(prompt: string): string {
  return '\x1b[200~' + prompt.split('\x1b').join('') + '\x1b[201~'
}

interface Active {
  runId: string
  req: WorkflowRunRequest
  steps: WorkflowStep[]
  state: WorkflowRunState
  cancelled: boolean
  /** Ends a pending sleep early (stop / terminal closed). */
  wake: (() => void) | null
  /** Answers the go / no-go the run is waiting on. */
  decide: ((d: Pick<WorkflowDecision, 'go' | 'reason'>) => void) | null
}

/**
 * Sends the steps of a workflow one after another, each to the terminal assigned to the agent the
 * step names. A step is finished when that terminal has produced output and then gone quiet: the
 * agents keep animating while they work, so silence means they wait for the next prompt. A
 * terminal belongs to one run at a time.
 */
export class WorkflowRunner {
  private runs = new Map<string, Active>()
  /** Terminal session -> run using it. */
  private bySession = new Map<string, string>()
  private lastOutput = new Map<string, number>()

  constructor(private deps: RunnerDeps) {}

  /** Terminal output, used to tell busy from idle. */
  feed(sessionId: string): void {
    if (this.bySession.has(sessionId)) this.lastOutput.set(sessionId, Date.now())
  }

  sessionExited(sessionId: string): void {
    const run = this.runs.get(this.bySession.get(sessionId) ?? '')
    if (!run) return
    run.state.message = 'A terminal in this run closed.'
    this.cancel(run, 'failed')
  }

  stop(runId: string): void {
    const run = this.runs.get(runId)
    if (run) this.cancel(run, 'stopped')
  }

  /** Answer the go / no-go a run is waiting on. No-go ends the run. */
  decide(runId: string, go: boolean, reason: string): void {
    const run = this.runs.get(runId)
    if (!run?.decide) return
    const why = reason.trim()
    if (!go && !why) throw new Error('Say why it is a no-go.')
    run.decide({ go, reason: why })
  }

  /** Starts a run and returns its id. Throws when an agent has no terminal or a terminal is busy. */
  start(req: WorkflowRunRequest, steps: WorkflowStep[]): string {
    const from = req.from ?? 1
    const agents = [...new Set(steps.filter((s) => s.index >= from).map((s) => s.agent))]
    const unknown = agents.filter((a) => !AGENTS[a])
    if (unknown.length) throw new Error(`Not supported yet: ${unknown.join(', ')}.`)
    const missing = agents.filter((a) => !req.targets[a])
    if (missing.length) throw new Error(`Pick a terminal for: ${missing.join(', ')}.`)
    const sessions = agents.map((a) => req.targets[a])
    if (new Set(sessions).size !== sessions.length)
      throw new Error('Each agent needs its own terminal.')
    if (sessions.some((x) => this.bySession.has(x)))
      throw new Error('A workflow is already running in one of those terminals.')

    const runId = randomUUID()
    const state: WorkflowRunState = {
      runId,
      file: req.file,
      targets: Object.fromEntries(agents.map((a) => [a, req.targets[a]])),
      state: 'running',
      steps: steps.map((s) => ({
        index: s.index,
        title: s.title,
        agent: s.agent,
        skill: s.skill,
        gate: s.gate,
        status: s.index < from ? 'skipped' : 'pending'
      })),
      decisions: []
    }
    const run: Active = { runId, req, steps, state, cancelled: false, wake: null, decide: null }
    this.runs.set(runId, run)
    for (const id of sessions) {
      this.bySession.set(id, runId)
      this.lastOutput.set(id, Date.now())
    }
    this.emit(run)
    void this.loop(run, from)
    return runId
  }

  private emit(run: Active): void {
    this.deps.emit({ ...run.state, steps: run.state.steps.map((x) => ({ ...x })) })
  }

  private cancel(run: Active, final: 'stopped' | 'failed'): void {
    run.cancelled = true
    run.state.state = final
    run.wake?.()
  }

  private setStatus(run: Active, index: number, status: WorkflowStepStatus): void {
    const s = run.state.steps.find((x) => x.index === index)
    if (s) s.status = status
    this.emit(run)
  }

  private sleep(run: Active, ms: number): Promise<void> {
    return new Promise<void>((resolve) => {
      const t = setTimeout(done, ms)
      function done(): void {
        clearTimeout(t)
        resolve()
      }
      run.wake = done
    }).finally(() => (run.wake = null))
  }

  /** True once output has appeared after `since` and then stayed quiet for the idle time. */
  private async waitIdle(run: Active, id: string, since: number): Promise<boolean> {
    const idle = this.deps.idleMs ?? 8000
    const limit = Date.now() + (this.deps.stepTimeoutMs ?? 30 * 60_000)
    while (!run.cancelled) {
      await this.sleep(run, 500)
      if (run.cancelled) break
      const last = this.lastOutput.get(id) ?? 0
      if (last > since && Date.now() - last >= idle) return true
      if (Date.now() > limit) {
        run.state.message = 'A step took too long, so the run was stopped.'
        return false
      }
    }
    return false
  }

  /** Pause for a go / no-go. True to carry on; false when it was a no-go or the run was stopped. */
  private async gate(run: Active, step: WorkflowStep): Promise<boolean> {
    this.setStatus(run, step.index, 'waiting')
    const answer = await new Promise<Pick<WorkflowDecision, 'go' | 'reason'> | null>((resolve) => {
      run.decide = resolve
      run.wake = () => resolve(null)
    })
    run.decide = null
    run.wake = null
    if (!answer) return false
    const decision: WorkflowDecision = {
      index: step.index,
      title: step.title,
      ...answer,
      at: new Date().toISOString()
    }
    run.state.decisions.push(decision)
    this.deps.record?.(run.req.file, decision)
    this.setStatus(run, step.index, 'done')
    if (!decision.go) {
      run.state.message = `No-go after step ${step.index}: ${decision.reason}`
      run.state.state = 'stopped'
      return false
    }
    return true
  }

  private async loop(run: Active, from: number): Promise<void> {
    const submit = this.deps.submitDelayMs ?? 400
    try {
      if (run.req.launch) {
        for (const [agent, id] of Object.entries(run.state.targets)) {
          const since = Date.now()
          this.deps.write(id, (this.deps.command?.(agent) ?? AGENTS[agent].command) + '\r')
          if (!(await this.waitIdle(run, id, since))) return this.finish(run, false)
        }
      }
      for (const step of run.steps) {
        if (run.cancelled) break
        if (step.index < from) continue
        const id = run.state.targets[step.agent]
        this.setStatus(run, step.index, 'running')
        const since = Date.now()
        this.deps.write(id, pastePayload(stepPrompt(step)))
        await this.sleep(run, submit)
        if (run.cancelled) break
        this.deps.write(id, '\r')
        const ok = await this.waitIdle(run, id, since)
        if (run.cancelled) break
        this.setStatus(run, step.index, ok ? 'done' : 'failed')
        if (!ok) return this.finish(run, false)
        if (step.gate && !(await this.gate(run, step))) return this.finish(run, false)
      }
      this.finish(run, !run.cancelled)
    } catch (e) {
      run.state.message = e instanceof Error ? e.message : String(e)
      this.finish(run, false)
    }
  }

  private finish(run: Active, completed: boolean): void {
    if (completed) run.state.state = 'done'
    else if (run.state.state === 'running') run.state.state = 'failed'
    this.runs.delete(run.runId)
    for (const id of Object.values(run.state.targets)) {
      this.bySession.delete(id)
      this.lastOutput.delete(id)
    }
    this.emit(run)
  }
}
