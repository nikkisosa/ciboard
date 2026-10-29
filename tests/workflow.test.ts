import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { parseWorkflow } from '../src/main/workflow/parse'
import { pastePayload, stepPrompt, WorkflowRunner } from '../src/main/workflow/runner'
import { parseSkillHeader } from '../src/main/workflow/skills'
import type { WorkflowRunState } from '../src/shared/types'

describe('parseWorkflow', () => {
  it('reads steps, agents and ignores the preamble', () => {
    const md = [
      '# Title',
      'intro text',
      '## 1. Design',
      'agent: Claude',
      'Draft the schema.',
      '',
      '## Step 2: Build',
      'agent: codex',
      'Implement it.',
      'More detail.'
    ].join('\n')
    expect(parseWorkflow(md)).toEqual([
      { index: 1, title: 'Design', agent: 'claude', prompt: 'Draft the schema.' },
      { index: 2, title: 'Build', agent: 'codex', prompt: 'Implement it.\nMore detail.' }
    ])
  })

  it('defaults to claude, skips empty steps and keeps headings inside fences', () => {
    const md = '## Empty\n\n## Real\nDo it:\n```md\n## not a step\n```\n'
    const steps = parseWorkflow(md)
    expect(steps).toHaveLength(1)
    expect(steps[0].agent).toBe('claude')
    expect(steps[0].prompt).toContain('## not a step')
  })

  it('handles CRLF', () => {
    expect(parseWorkflow('## A\r\nagent: claude\r\nhello\r\n')[0].prompt).toBe('hello')
  })
})

describe('WorkflowRunner', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  const steps = [
    { index: 1, title: 'A', agent: 'claude', prompt: 'one' },
    { index: 2, title: 'B', agent: 'claude', prompt: 'two' }
  ]

  function setup(): { runner: WorkflowRunner; writes: string[]; states: WorkflowRunState[] } {
    const writes: string[] = []
    const states: WorkflowRunState[] = []
    const runner = new WorkflowRunner({
      write: (_id, d) => writes.push(d),
      emit: (s) => states.push(s),
      idleMs: 2000
    })
    return { runner, writes, states }
  }

  it('sends each step after the previous one goes quiet', async () => {
    const { runner, writes, states } = setup()
    runner.start({ file: 'f', targets: { claude: 's' } }, steps)
    await vi.advanceTimersByTimeAsync(500)
    expect(writes).toEqual([pastePayload('one'), '\r'])
    // busy, then quiet
    runner.feed('s')
    await vi.advanceTimersByTimeAsync(1500)
    expect(writes).toHaveLength(2)
    await vi.advanceTimersByTimeAsync(1500)
    expect(writes).toContain(pastePayload('two'))
    runner.feed('s')
    await vi.advanceTimersByTimeAsync(3000)
    expect(states.at(-1)?.state).toBe('done')
    expect(states.at(-1)?.steps.map((s) => s.status)).toEqual(['done', 'done'])
  })

  it('stops on request and refuses unknown agents or missing terminals', async () => {
    const a = setup()
    a.runner.start({ file: 'f', targets: { claude: 's' } }, steps)
    await vi.advanceTimersByTimeAsync(600)
    a.runner.stop(a.states[0].runId)
    await vi.advanceTimersByTimeAsync(1000)
    expect(a.states.at(-1)?.state).toBe('stopped')

    const b = setup()
    expect(() =>
      b.runner.start({ file: 'f', targets: { foo: 's' } }, [{ ...steps[0], agent: 'foo' }])
    ).toThrow(/foo/)
    expect(() => b.runner.start({ file: 'f', targets: {} }, steps)).toThrow(/Pick a terminal/)
  })
})

describe('skills', () => {
  it('parses a skill line and builds the prompt from it', () => {
    const [step] = parseWorkflow('## Scan\nskill: owasp-security-scan\nagent: claude\nCheck it.')
    expect(step.skill).toBe('owasp-security-scan')
    expect(stepPrompt(step)).toBe('Use the "owasp-security-scan" skill for this task.\n\nCheck it.')
    expect(stepPrompt({ ...step, skill: undefined })).toBe('Check it.')
  })

  it('reads the front matter of a SKILL.md', () => {
    expect(parseSkillHeader('---\nname: docx\ndescription: "Word files"\n---\n# Body')).toEqual({
      name: 'docx',
      description: 'Word files'
    })
    expect(parseSkillHeader('# no front matter')).toBeNull()
  })
})

describe('go / no-go gate', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  const steps = [
    { index: 1, title: 'A', agent: 'claude', prompt: 'one', gate: true },
    { index: 2, title: 'B', agent: 'claude', prompt: 'two' }
  ]

  function setup(): {
    runner: WorkflowRunner
    writes: string[]
    states: WorkflowRunState[]
  } {
    const writes: string[] = []
    const states: WorkflowRunState[] = []
    const runner = new WorkflowRunner({
      write: (_id, d) => writes.push(d),
      emit: (s) => states.push(s),
      idleMs: 1000
    })
    return { runner, writes, states }
  }

  async function reachGate(t: ReturnType<typeof setup>): Promise<void> {
    t.runner.start({ file: 'f', targets: { claude: 's' } }, steps)
    await vi.advanceTimersByTimeAsync(500)
    t.runner.feed('s')
    await vi.advanceTimersByTimeAsync(2000)
  }

  it('parses gate lines', () => {
    expect(parseWorkflow('## A\ngate: yes\nx')[0].gate).toBe(true)
    expect(parseWorkflow('## A\ngate: no\nx')[0].gate).toBeFalsy()
  })

  it('waits for a go before sending the next step', async () => {
    const t = setup()
    await reachGate(t)
    expect(t.states.at(-1)?.steps[0].status).toBe('waiting')
    expect(t.writes).not.toContain(pastePayload('two'))
    t.runner.decide(t.states[0].runId, true, 'looks fine')
    await vi.advanceTimersByTimeAsync(500)
    expect(t.writes).toContain(pastePayload('two'))
    expect(t.states.at(-1)?.decisions[0]).toMatchObject({ go: true, reason: 'looks fine' })
  })

  it('stops on a no-go, which needs a reason', async () => {
    const t = setup()
    await reachGate(t)
    expect(() => t.runner.decide(t.states[0].runId, false, '  ')).toThrow(/why/)
    t.runner.decide(t.states[0].runId, false, 'findings too risky')
    await vi.advanceTimersByTimeAsync(500)
    const last = t.states.at(-1)
    expect(last?.state).toBe('stopped')
    expect(last?.message).toContain('findings too risky')
    expect(t.writes).not.toContain(pastePayload('two'))
  })

  it('stopping while waiting ends the run', async () => {
    const t = setup()
    await reachGate(t)
    t.runner.stop(t.states[0].runId)
    await vi.advanceTimersByTimeAsync(100)
    expect(t.states.at(-1)?.state).toBe('stopped')
  })
})

describe('built-in workflows', () => {
  it('lists the bundled workflows and installs them without overwriting', async () => {
    const { mkdtempSync, existsSync, readFileSync, writeFileSync, rmSync } = await import('node:fs')
    const { tmpdir } = await import('node:os')
    const { join } = await import('node:path')
    const { installBuiltin, listBuiltin } = await import('../src/main/workflow/builtin')
    const root = mkdtempSync(join(tmpdir(), 'ciboard-'))
    try {
      const all = listBuiltin(root)
      expect(all.length).toBeGreaterThan(0)
      expect(all.every((b) => !b.installed && b.steps > 0)).toBe(true)

      const first = all[0].name
      const target = join(root, 'docs', 'knowledge', `${first}.md`)
      await installBuiltin(root, [first])
      expect(existsSync(target)).toBe(true)
      expect(existsSync(join(root, 'docs', 'knowledge', 'README.md'))).toBe(true)
      expect(listBuiltin(root).find((b) => b.name === first)?.installed).toBe(true)

      writeFileSync(target, 'mine')
      expect(await installBuiltin(root, [first])).toEqual([])
      expect(readFileSync(target, 'utf8')).toBe('mine')
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })
})

describe('routing to several agents', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  it('types each step into the terminal of its own agent', async () => {
    const writes: [string, string][] = []
    const states: WorkflowRunState[] = []
    const runner = new WorkflowRunner({
      write: (id, d) => writes.push([id, d]),
      emit: (s) => states.push(s),
      idleMs: 1000
    })
    const steps = [
      { index: 1, title: 'A', agent: 'claude', prompt: 'plan it' },
      { index: 2, title: 'B', agent: 'codex', prompt: 'build it' },
      { index: 3, title: 'C', agent: 'copilot', prompt: 'review it' }
    ]
    runner.start({ file: 'f', targets: { claude: 'c1', codex: 'c2', copilot: 'c3' } }, steps)
    for (const id of ['c1', 'c2', 'c3']) {
      await vi.advanceTimersByTimeAsync(600)
      runner.feed(id)
      await vi.advanceTimersByTimeAsync(2000)
    }
    expect(writes.filter(([, d]) => d.includes('\x1b[200~')).map(([id]) => id)).toEqual([
      'c1',
      'c2',
      'c3'
    ])
    expect(states.at(-1)?.state).toBe('done')
  })

  it('refuses one terminal for two agents and launches each agent with its command', async () => {
    const writes: [string, string][] = []
    const runner = new WorkflowRunner({
      write: (id, d) => writes.push([id, d]),
      emit: () => {},
      command: (a) => (a === 'agy' ? 'agy-beta' : a),
      idleMs: 1000
    })
    const steps = [
      { index: 1, title: 'A', agent: 'codex', prompt: 'x' },
      { index: 2, title: 'B', agent: 'agy', prompt: 'y' }
    ]
    expect(() => runner.start({ file: 'f', targets: { codex: 's', agy: 's' } }, steps)).toThrow(
      /own terminal/
    )
    runner.start({ file: 'f', launch: true, targets: { codex: 'a', agy: 'b' } }, steps)
    await vi.advanceTimersByTimeAsync(10)
    expect(writes[0]).toEqual(['a', 'codex\r'])
    runner.feed('a')
    await vi.advanceTimersByTimeAsync(2000)
    expect(writes).toContainEqual(['b', 'agy-beta\r'])
  })
})
