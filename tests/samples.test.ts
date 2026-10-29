import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { AGENTS } from '../src/shared/agents'
import { parseWorkflow } from '../src/main/workflow/parse'

const dir = join(__dirname, '..', 'docs', 'knowledge')

describe('sample workflows', () => {
  const files = readdirSync(dir).filter((f) => f.endsWith('.md'))

  it('ships samples', () => expect(files.length).toBeGreaterThan(0))

  it.each(files)('%s parses into steps for known agents', (f) => {
    const steps = parseWorkflow(readFileSync(join(dir, f), 'utf8'))
    expect(steps.length).toBeGreaterThanOrEqual(3)
    for (const s of steps) {
      expect(Object.keys(AGENTS)).toContain(s.agent)
      expect(s.prompt).not.toMatch(/^agent:/i)
    }
  })
})
