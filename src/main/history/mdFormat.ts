import type { HistoryEntry } from '../../shared/types'

/** Language tag for the command block, per shell label. */
export function fenceLang(shell: string): string {
  switch (shell) {
    case 'pwsh':
    case 'powershell':
      return 'powershell'
    case 'bash':
    case 'wsl':
      return 'bash'
    case 'cmd':
      return 'bat'
    default:
      return 'text'
  }
}

/** `1.2s`, `45s`, `1m 05s`. */
export function formatDuration(ms: number): string {
  const s = ms / 1000
  if (s < 10) return `${s.toFixed(1)}s`
  if (s < 60) return `${Math.round(s)}s`
  const m = Math.floor(s / 60)
  return `${m}m ${String(Math.round(s - m * 60)).padStart(2, '0')}s`
}

/** Decode the `OSC 633;E` payload: `\\` -> `\`, `\xNN` -> char. */
export function decodeCommand(encoded: string): string {
  return encoded.replace(/\\(\\|x[0-9a-fA-F]{2})/g, (_m, g: string) =>
    g === '\\' ? '\\' : String.fromCharCode(parseInt(g.slice(1), 16))
  )
}

/** A backtick fence longer than any backtick run inside `text`. */
function fenceFor(text: string): string {
  const longest = Math.max(0, ...(text.match(/`+/g) ?? []).map((r) => r.length))
  return '`'.repeat(Math.max(3, longest + 1))
}

export function block(lang: string, text: string): string {
  const fence = fenceFor(text)
  return `${fence}${lang}\n${text}\n${fence}\n`
}

export interface MdHeader {
  shell: string
  title: string
  started: string
  profile: string
  elevated: boolean
  /** Name of the previous file when a session crosses midnight. */
  continuedFrom?: string
}

export function formatHeader(h: MdHeader): string {
  const lines = [
    `# ${h.shell} — ${h.title}`,
    `- Started: ${h.started}`,
    `- Profile: ${h.profile}`,
    `- Elevated: ${h.elevated ? 'yes' : 'no'}`
  ]
  if (h.continuedFrom) lines.push(`- Continued from: ${h.continuedFrom}`)
  return lines.join('\n') + '\n'
}

export interface EntryText {
  time: string
  cwd: string
  exit: string
  duration: string
  command: string
  lang: string
  output: string
}

export function formatEntry(e: EntryText): string {
  let md = `\n## ${e.time} · ${e.cwd} · exit ${e.exit} · ${e.duration}\n`
  md += block(e.lang, e.command)
  if (e.output) md += block('text', e.output)
  return md
}

/** Keep at most `limit` lines of output; a note points to the raw transcript for the rest. */
export function truncateOutput(lines: string[], limit: number, rawName: string): string {
  if (lines.length <= limit) return lines.join('\n')
  const dropped = lines.length - limit
  return [
    ...lines.slice(0, limit),
    `[… ${dropped.toLocaleString('en-US')} more lines truncated — full output in ${rawName}]`
  ].join('\n')
}

const HEADING = /^## (\d\d:\d\d:\d\d) · (.*) · exit (\S+) · (\d+(?:\.\d)?s|\d+m \d\ds)$/
const FENCE_OPEN = /^(`{3,})(\S*)$/

/**
 * Parse a session .md back into entries. `rawFile` and `date` are not stored in the file body:
 * the caller derives them from the path.
 */
export function parseMd(text: string, rawFile: string, date: string): HistoryEntry[] {
  const lines = text.split(/\r?\n/)
  const session = /^# (.*)$/.exec(lines[0] ?? '')?.[1] ?? ''
  const entries: HistoryEntry[] = []
  let i = 0
  while (i < lines.length) {
    const h = HEADING.exec(lines[i])
    i++
    if (!h) continue
    const blocks: { lang: string; text: string }[] = []
    while (i < lines.length && !HEADING.test(lines[i])) {
      const open = FENCE_OPEN.exec(lines[i])
      i++
      if (!open) continue
      const body: string[] = []
      while (i < lines.length && lines[i] !== open[1]) body.push(lines[i++])
      i++ // closing fence
      blocks.push({ lang: open[2], text: body.join('\n') })
    }
    entries.push({
      id: `${rawFile}#${entries.length}`,
      file: rawFile,
      index: entries.length,
      date,
      time: h[1],
      cwd: h[2],
      exit: h[3],
      duration: h[4],
      command: blocks[0]?.text ?? '',
      lang: blocks[0]?.lang ?? 'text',
      output: blocks[1]?.text ?? '',
      session
    })
  }
  return entries
}
