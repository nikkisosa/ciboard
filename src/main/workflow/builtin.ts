import { existsSync, statSync } from 'node:fs'
import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { BuiltinWorkflow } from '../../shared/types'
import { knowledgeDir } from './files'
import { parseWorkflow } from './parse'

/** The workflows that ship with CIBoard are the files in this repository's docs/knowledge. */
const bundled = import.meta.glob('../../../docs/knowledge/*.md', {
  query: '?raw',
  import: 'default',
  eager: true
}) as Record<string, string>

const KB_README = `# Project knowledge base

Workflows for CIBoard live here. Each \`##\` heading in a file is one step; the text under it is
sent to the agent as a prompt, one step after another. Optional lines right under a heading:

- \`agent: claude\` picks the agent (claude is the default)
- \`skill: name\` asks the agent to use an installed skill
- \`gate: yes\` pauses for a Go / No-go decision, with a reason, before the next step

Files here without any steps (like this one) are ignored, so notes can sit beside the workflows.
Decisions are appended to \`<workflow>.decisions.md\`.
`

const nameOf = (path: string): string => (path.split('/').pop() ?? path).replace(/\.md$/i, '')

const templates = (): { name: string; title: string; steps: number; content: string }[] =>
  Object.entries(bundled)
    .map(([path, content]) => ({
      name: nameOf(path),
      title: /^#\s+(.+)$/m.exec(content)?.[1].trim() ?? nameOf(path),
      steps: parseWorkflow(content).length,
      content
    }))
    .filter((t) => t.steps > 0 && !t.name.endsWith('.decisions'))
    .sort((a, b) => a.name.localeCompare(b.name))

/** The built-in workflows, each marked when the project already has a file of that name. */
export function listBuiltin(root: string): BuiltinWorkflow[] {
  const dir = knowledgeDir(root)
  return templates().map((t) => ({
    name: t.name,
    title: t.title,
    steps: t.steps,
    installed: existsSync(join(dir, `${t.name}.md`))
  }))
}

/**
 * Copy built-in workflows into the project's docs/knowledge (created if missing, with a short
 * README). Existing files are never overwritten. Resolves the paths that were written.
 */
export async function installBuiltin(root: string, names: string[]): Promise<string[]> {
  if (!existsSync(root) || !statSync(root).isDirectory()) throw new Error('Folder not found.')
  const dir = knowledgeDir(root)
  await mkdir(dir, { recursive: true })
  const readme = join(dir, 'README.md')
  if (!existsSync(readme)) await writeFile(readme, KB_README, 'utf8')
  const written: string[] = []
  for (const t of templates()) {
    if (!names.includes(t.name)) continue
    const target = join(dir, `${t.name}.md`)
    if (existsSync(target)) continue
    await writeFile(target, t.content, 'utf8')
    written.push(target)
  }
  return written
}
