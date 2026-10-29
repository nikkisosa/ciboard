import type { WorkflowStep } from '../../shared/types'

export const DEFAULT_AGENT = 'claude'

const HEADING = /^(#{1,3})\s+(.*\S)\s*$/
const META = /^(agent|skill|gate)\s*:\s*(\S+)\s*$/i

/** Strip a leading "1." / "Step 2:" so titles read cleanly. */
const cleanTitle = (t: string): string => t.replace(/^(step\s*)?\d+\s*[.:)-]\s*/i, '').trim() || t

/**
 * Split a workflow file into steps. Every `##` / `###` heading starts a step; the body is the
 * prompt sent to the agent. Optional `agent: name` and `skill: name` lines right under the
 * heading pick the agent and a skill it should use. A single `#` heading is the file title, text before the first step and steps with an
 * empty body are ignored, and headings inside code fences belong to the prompt.
 */
export function parseWorkflow(md: string): WorkflowStep[] {
  const steps: WorkflowStep[] = []
  let title: string | null = null
  let agent = DEFAULT_AGENT
  let skill: string | undefined
  let gate = false
  let body: string[] = []
  let inFence = false

  const flush = (): void => {
    const prompt = body.join('\n').trim()
    if (title !== null && prompt) {
      steps.push({
        index: steps.length + 1,
        title: cleanTitle(title),
        agent,
        skill,
        gate: gate || undefined,
        prompt
      })
    }
  }

  for (const line of md.replace(/\r\n?/g, '\n').split('\n')) {
    if (/^\s*(```|~~~)/.test(line)) inFence = !inFence
    const h = inFence ? null : HEADING.exec(line)
    if (h && h[1].length >= 2) {
      flush()
      title = h[2]
      agent = DEFAULT_AGENT
      skill = undefined
      gate = false
      body = []
      continue
    }
    if (title === null) continue
    if (body.every((l) => !l.trim())) {
      const m = META.exec(line.trim())
      if (m) {
        const key = m[1].toLowerCase()
        if (key === 'agent') agent = m[2].toLowerCase()
        else if (key === 'skill') skill = m[2]
        else gate = !/^(no|false|off|0)$/i.test(m[2])
        continue
      }
    }
    body.push(line)
  }
  flush()
  return steps
}
