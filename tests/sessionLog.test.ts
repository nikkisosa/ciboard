import { mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { HistoryEntry } from '../src/shared/types'
import { SessionLog, type SessionMeta } from '../src/main/history/sessionLog'

const root = mkdtempSync(join(tmpdir(), 'ciboard-log-'))
afterAll(() => rmSync(root, { recursive: true, force: true }))

const OSC = (p: string): string => `\x1b]${p}\x07`

/** One complete pwsh-style prompt/command/output cycle. */
const command = (cmd: string, out: string, code = 0): string =>
  OSC('133;A') +
  'PS> ' +
  OSC('133;B') +
  `${cmd}\r\n` +
  OSC(`633;E;${cmd}`) +
  OSC('133;C') +
  `${out}\r\n` +
  OSC(`133;D;${code}`)

function meta(over: Partial<SessionMeta> = {}): SessionMeta {
  return {
    sessionId: 's1',
    title: 'api-server',
    profileName: 'PowerShell 7',
    shell: 'pwsh',
    elevated: false,
    cols: 80,
    rows: 24,
    ...over
  }
}

function open(dir: string, m: SessionMeta): { log: SessionLog; entries: HistoryEntry[] } {
  const entries: HistoryEntry[] = []
  const log = new SessionLog(
    m,
    () => dir,
    () => 2000,
    { append: () => {}, entry: (_id, e) => entries.push(e), running: () => {}, cwd: () => {} }
  )
  return { log, entries }
}

const files = (dir: string, day: string): string[] => readdirSync(join(dir, day)).sort()

describe('SessionLog', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'], now: new Date(2026, 9, 28, 19, 5, 12) })
  })
  afterEach(() => vi.useRealTimers())

  it('records "Elevated: yes" in both file headers for an elevated session', async () => {
    const dir = join(root, 'elevated')
    const { log } = open(dir, meta({ elevated: true }))
    log.output(command('whoami', 'desktop\\admin'))
    await log.close()
    const [md, raw] = files(dir, '2026-10-28')
    expect(md).toBe('190512_pwsh_api-server.md')
    expect(readFileSync(join(dir, '2026-10-28', md), 'utf8')).toContain('- Elevated: yes')
    expect(readFileSync(join(dir, '2026-10-28', raw), 'utf8')).toContain('# Elevated: yes')
  })

  it('writes "Elevated: no" otherwise, and only a raw file for shells without markers', async () => {
    const dir = join(root, 'plain')
    const a = open(dir, meta())
    a.log.output(command('dir', 'a.txt'))
    await a.log.close()
    expect(readFileSync(join(dir, '2026-10-28', '190512_pwsh_api-server.md'), 'utf8')).toContain(
      '- Elevated: no'
    )

    const dir2 = join(root, 'unknown-shell')
    const b = open(dir2, meta({ shell: 'custom', title: 'misc' }))
    b.log.output('some output without markers\r\n')
    await b.log.close()
    expect(files(dir2, '2026-10-28')).toEqual(['190512_custom_misc.raw.txt'])
  })

  it('continues in the next day’s folder after midnight, with a note and fresh entry numbering', async () => {
    const dir = join(root, 'midnight')
    vi.setSystemTime(new Date(2026, 9, 28, 23, 59, 58))
    const { log, entries } = open(dir, meta())
    log.output(command('echo before', 'before'))
    vi.setSystemTime(new Date(2026, 9, 29, 0, 0, 5))
    log.output(command('echo after', 'after'))
    await log.close()

    expect(files(dir, '2026-10-28')).toEqual([
      '235958_pwsh_api-server.md',
      '235958_pwsh_api-server.raw.txt'
    ])
    const next = files(dir, '2026-10-29')
    expect(next).toEqual(['000005_pwsh_api-server.md', '000005_pwsh_api-server.raw.txt'])

    const md = readFileSync(join(dir, '2026-10-29', next[0]), 'utf8')
    expect(md).toContain('- Continued from: 235958_pwsh_api-server.md')
    expect(md).toContain('echo after')
    expect(md).not.toContain('echo before')
    expect(readFileSync(join(dir, '2026-10-29', next[1]), 'utf8')).toContain(
      '# Continued from: 235958_pwsh_api-server.raw.txt'
    )
    expect(entries.map((e) => [e.date, e.index, e.command])).toEqual([
      ['2026-10-28', 0, 'echo before'],
      ['2026-10-29', 0, 'echo after']
    ])
  })

  it('truncates long output in the .md and points to the raw transcript', async () => {
    const dir = join(root, 'truncate')
    const entries: HistoryEntry[] = []
    const log = new SessionLog(
      meta(),
      () => dir,
      () => 10,
      { append: () => {}, entry: (_i, e) => entries.push(e), running: () => {}, cwd: () => {} }
    )
    const lines = Array.from({ length: 30 }, (_, i) => `line ${i}`).join('\r\n')
    log.output(command('big', lines))
    await log.close()
    expect(entries[0].output).toContain(
      '[… 20 more lines truncated — full output in 190512_pwsh_api-server.raw.txt]'
    )
    expect(entries[0].output.split('\n')).toHaveLength(11)
  })

  it('masks secrets in the raw transcript, the .md and the entries', async () => {
    const dir = join(root, 'redact')
    const { log, entries } = open(dir, meta())
    log.output(command('deploy --password hunter2', 'using token=abc123def456 now'))
    await log.close()
    const [md, raw] = files(dir, '2026-10-28')
    for (const f of [md, raw]) {
      const text = readFileSync(join(dir, '2026-10-28', f), 'utf8')
      expect(text).not.toContain('hunter2')
      expect(text).not.toContain('abc123def456')
    }
    expect(entries[0].command).toBe('deploy --password [REDACTED]')
    expect(entries[0].output).toBe('using token=[REDACTED] now')
  })

  it('records nothing while paused, notes both transitions, and never leaks paused text later', async () => {
    const dir = join(root, 'pause')
    const { log, entries } = open(dir, meta())
    log.output(command('echo visible-one', 'visible-one'))
    log.setPaused(true)
    log.output(command('echo hidden-two', 'hidden-two'))
    log.setPaused(false)
    log.output(command('echo visible-three', 'visible-three'))
    await log.close()

    expect(entries.map((e) => e.command)).toEqual(['echo visible-one', 'echo visible-three'])
    const [md, raw] = files(dir, '2026-10-28')
    const mdText = readFileSync(join(dir, '2026-10-28', md), 'utf8')
    const rawText = readFileSync(join(dir, '2026-10-28', raw), 'utf8')
    expect(rawText).not.toContain('hidden-two')
    expect(mdText).not.toContain('hidden-two')
    expect(rawText).toContain('-- logging paused --')
    expect(rawText).toContain('-- logging resumed --')
    expect(mdText).toMatch(/> Logging paused at \d\d:\d\d:\d\d/)
    expect(mdText).toMatch(/> Logging resumed at \d\d:\d\d:\d\d/)
  })

  it('can start paused', async () => {
    const dir = join(root, 'start-paused')
    const entries: HistoryEntry[] = []
    const log = new SessionLog(
      meta(),
      () => dir,
      () => 2000,
      { append: () => {}, entry: (_i, e) => entries.push(e), running: () => {}, cwd: () => {} },
      { paused: true }
    )
    log.output(command('echo nope', 'nope'))
    await log.close()
    expect(entries).toEqual([])
    const raw = files(dir, '2026-10-28').find((f) => f.endsWith('.raw.txt'))!
    const rawText = readFileSync(join(dir, '2026-10-28', raw), 'utf8')
    expect(rawText).toContain('-- logging paused --')
    expect(rawText).not.toContain('nope')
  })

  it('clear() deletes the session’s files and logging continues in fresh ones', async () => {
    const dir = join(root, 'clear')
    const { log, entries } = open(dir, meta())
    log.output(command('echo old-entry', 'old-entry'))
    const deleted = await log.clear()
    expect(deleted).toHaveLength(1)
    log.output(command('echo new-entry', 'new-entry'))
    await log.close()

    const all = files(dir, '2026-10-28')
    const text = all.map((f) => readFileSync(join(dir, '2026-10-28', f), 'utf8')).join('\n')
    expect(text).not.toContain('old-entry')
    expect(text).toContain('new-entry')
    expect(entries.map((e) => [e.command, e.index])).toEqual([
      ['echo old-entry', 0],
      ['echo new-entry', 0]
    ])
  })
})
