import { existsSync } from 'node:fs'
import { open, readdir } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'
import type { InstalledSkill } from '../../shared/types'

const claudeDir = (): string => process.env.CLAUDE_CONFIG_DIR || join(homedir(), '.claude')
const MAX_DEPTH = 6

/** `name` and `description` from the YAML front matter of a SKILL.md (first lines only). */
export function parseSkillHeader(text: string): { name: string; description: string } | null {
  const m = /^---\r?\n([\s\S]*?)\r?\n---/.exec(text.replace(/^\uFEFF/, ''))
  if (!m) return null
  const field = (key: string): string => {
    const f = new RegExp(`^${key}:[ \t]*(.*)$`, 'm').exec(m[1])
    return (f?.[1] ?? '').trim().replace(/^["']|["']$/g, '')
  }
  const name = field('name')
  return name ? { name, description: field('description') } : null
}

async function readHead(file: string): Promise<string> {
  const fh = await open(file, 'r')
  try {
    const buf = Buffer.alloc(4096)
    const { bytesRead } = await fh.read(buf, 0, buf.length, 0)
    return buf.toString('utf8', 0, bytesRead)
  } finally {
    await fh.close()
  }
}

async function scan(
  dir: string,
  source: InstalledSkill['source'],
  out: InstalledSkill[],
  depth = 0
): Promise<void> {
  if (depth > MAX_DEPTH) return
  const entries = await readdir(dir, { withFileTypes: true }).catch(() => [])
  const skillFile = join(dir, 'SKILL.md')
  if (entries.some((e) => e.isFile() && e.name === 'SKILL.md')) {
    const head = parseSkillHeader(await readHead(skillFile).catch(() => ''))
    if (head) out.push({ ...head, source, dir })
    return // a skill folder holds its own files, not further skills
  }
  for (const e of entries)
    if (e.isDirectory() && e.name !== 'node_modules' && !e.name.startsWith('.'))
      await scan(join(dir, e.name), source, out, depth + 1)
}

/**
 * Skills available to Claude Code on this machine: the user's skills folder (which also holds the
 * skills synced from the claude.ai account), the project's `.claude/skills`, and installed
 * plugins. Skills that exist only on the server and were never synced cannot be seen from here.
 */
export async function listInstalledSkills(root?: string): Promise<InstalledSkill[]> {
  const out: InstalledSkill[] = []
  if (root && existsSync(root)) await scan(join(root, '.claude', 'skills'), 'project', out)
  await scan(join(claudeDir(), 'skills'), 'user', out)
  await scan(join(claudeDir(), 'plugins'), 'plugin', out)
  const seen = new Set<string>()
  return out
    .filter((s) => !seen.has(s.name) && seen.add(s.name))
    .sort((a, b) => a.name.localeCompare(b.name))
}
