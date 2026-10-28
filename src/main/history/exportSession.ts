import { existsSync } from 'node:fs'
import { readdir, readFile } from 'node:fs/promises'
import { basename, dirname, join } from 'node:path'
import { block, parseMd } from './mdFormat'
import { dateTime } from './time'

const DAY_RE = /^\d{4}-\d{2}-\d{2}$/

export const mdOf = (raw: string): string => raw.replace(/\.raw\.txt$/, '.md')

interface Header {
  title: string
  profile: string
  started: string
  elevated: string
  continuedFrom?: string
}

function parseHeader(text: string): Header {
  const field = (name: string): string =>
    new RegExp(`^- ${name}: (.*)$`, 'm').exec(text)?.[1].trim() ?? ''
  return {
    title: /^# (.*)$/m.exec(text)?.[1] ?? '',
    profile: field('Profile'),
    started: field('Started'),
    elevated: field('Elevated'),
    continuedFrom: field('Continued from') || undefined
  }
}

/** Every .md in the history folder with its day, so continuation links can be followed. */
async function scan(root: string): Promise<{ path: string; day: string; header: Header }[]> {
  const out: { path: string; day: string; header: Header }[] = []
  let days: string[]
  try {
    days = (await readdir(root)).filter((d) => DAY_RE.test(d))
  } catch {
    return out
  }
  for (const day of days) {
    for (const name of (await readdir(join(root, day))).filter((n) => n.endsWith('.md'))) {
      const path = join(root, day, name)
      out.push({ path, day, header: parseHeader((await readFile(path, 'utf8')).slice(0, 600)) })
    }
  }
  return out
}

export interface SessionExport {
  /** Suggested file name. */
  name: string
  markdown: string
}

/**
 * One Markdown document for a whole session: the .md files linked by "Continued from" notes
 * (a session that ran past midnight) in order, or the raw transcript for shells that have no
 * structured history.
 */
export async function buildSessionExport(rawFile: string, root: string): Promise<SessionExport> {
  const md = mdOf(rawFile)
  const stem = basename(rawFile).replace(/\.raw\.txt$/, '')
  const day = basename(dirname(rawFile))

  if (!existsSync(md)) {
    const raw = existsSync(rawFile) ? await readFile(rawFile, 'utf8') : ''
    return {
      name: `${day}_${stem}_export.md`,
      markdown:
        `# Session export — ${stem}\n- Exported: ${dateTime(new Date())}\n` +
        `- Source: ${basename(rawFile)} (no structured history for this shell)\n\n` +
        block('text', raw.trimEnd())
    }
  }

  const all = await scan(root)
  const chain = all.filter((f) => f.path === md)
  if (chain.length === 0) throw new Error('Session file not found')
  // Walk back to the first file of the session, then forward to the last.
  for (let cur = chain[0]; cur.header.continuedFrom;) {
    const prev = all
      .filter((f) => basename(f.path) === cur.header.continuedFrom && f.day < cur.day)
      .sort((a, b) => b.day.localeCompare(a.day))[0]
    if (!prev) break
    chain.unshift(prev)
    cur = prev
  }
  for (let cur = chain[chain.length - 1]; ;) {
    const next = all
      .filter((f) => f.header.continuedFrom === basename(cur.path) && f.day > cur.day)
      .sort((a, b) => a.day.localeCompare(b.day))[0]
    if (!next) break
    chain.push(next)
    cur = next
  }

  const first = chain[0]
  let doc = `# ${first.header.title} — session export\n`
  doc += `- Exported: ${dateTime(new Date())}\n- Started: ${first.header.started}\n`
  doc += `- Profile: ${first.header.profile}\n- Elevated: ${first.header.elevated}\n`
  doc += `- Files: ${chain.map((f) => basename(f.path)).join(', ')}\n`

  let count = 0
  for (const f of chain) {
    const entries = parseMd(
      await readFile(f.path, 'utf8'),
      mdOf(f.path).replace(/\.md$/, '.raw.txt'),
      f.day
    )
    doc += `\n## ${f.day}\n`
    for (const e of entries) {
      count++
      doc += `\n### ${e.time} · ${e.cwd} · exit ${e.exit} · ${e.duration}\n`
      doc += block(e.lang, e.command)
      if (e.output) doc += block('text', e.output)
    }
  }
  doc += `\n---\n${count} command${count === 1 ? '' : 's'} in ${chain.length} file${chain.length === 1 ? '' : 's'}.\n`
  return { name: `${first.day}_${basename(first.path, '.md')}_export.md`, markdown: doc }
}
