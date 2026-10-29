import { existsSync, statSync } from 'node:fs'
import { readdir, readFile } from 'node:fs/promises'
import { basename, extname, join, relative, resolve, isAbsolute } from 'node:path'
import type { WorkflowDecision, WorkflowFile } from '../../shared/types'
import { parseWorkflow } from './parse'

export const knowledgeDir = (root: string): string => join(root, 'docs', 'knowledge')

/** True when `file` sits inside the project's docs/knowledge folder. */
export function insideKnowledge(root: string, file: string): boolean {
  const rel = relative(knowledgeDir(resolve(root)), resolve(file))
  return !!rel && !rel.startsWith('..') && !isAbsolute(rel)
}

/** Workflow files of a project (`docs/knowledge/*.md` that contain steps); empty when none. */
export async function listWorkflows(root: string): Promise<WorkflowFile[]> {
  if (!existsSync(root) || !statSync(root).isDirectory()) throw new Error('Folder not found.')
  const dir = knowledgeDir(root)
  if (!existsSync(dir)) return []
  const out: WorkflowFile[] = []
  for (const name of (await readdir(dir)).sort()) {
    if (extname(name).toLowerCase() !== '.md') continue
    const file = join(dir, name)
    const steps = parseWorkflow(await readFile(file, 'utf8'))
    if (steps.length) out.push({ file, name: basename(name, extname(name)), steps })
  }
  return out
}

export async function readWorkflow(root: string, file: string): Promise<WorkflowFile> {
  if (!insideKnowledge(root, file)) throw new Error('Not a workflow file of this project.')
  return {
    file,
    name: basename(file, extname(file)),
    steps: parseWorkflow(await readFile(file, 'utf8'))
  }
}

/** Where a workflow's go / no-go decisions are kept: `<name>.decisions.md` beside it. */
export const decisionLogPath = (file: string): string =>
  file.replace(/\.md$/i, '') + '.decisions.md'

export function decisionLine(d: WorkflowDecision): string {
  const reason = d.reason.replace(/\s*\n\s*/g, ' ') || '(no reason given)'
  return `- ${d.at} · step ${d.index} "${d.title}" · **${d.go ? 'GO' : 'NO-GO'}** · ${reason}\n`
}
