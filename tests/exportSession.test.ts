import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { buildSessionExport } from '../src/main/history/exportSession'
import { formatEntry, formatHeader } from '../src/main/history/mdFormat'

const root = mkdtempSync(join(tmpdir(), 'ciboard-exp-'))
afterAll(() => rmSync(root, { recursive: true, force: true }))

function write(day: string, stem: string, md: string | null, raw = 'raw text'): string {
  const dir = join(root, day)
  mkdirSync(dir, { recursive: true })
  if (md !== null) writeFileSync(join(dir, `${stem}.md`), md)
  writeFileSync(join(dir, `${stem}.raw.txt`), raw)
  return join(dir, `${stem}.raw.txt`)
}

const entry = (time: string, command: string, output: string): string =>
  formatEntry({
    time,
    cwd: 'C:\\dev',
    exit: '0',
    duration: '0.1s',
    command,
    lang: 'powershell',
    output
  })

describe('buildSessionExport', () => {
  it('joins a session that continued past midnight into one document, in order', async () => {
    const head = (started: string, from?: string): string =>
      formatHeader({
        shell: 'pwsh',
        title: 'api',
        started,
        profile: 'PowerShell 7',
        elevated: false,
        continuedFrom: from
      })
    const day1 = write(
      '2026-10-28',
      '235900_pwsh_api',
      head('2026-10-28 23:59:00') + entry('23:59:30', 'echo one', 'one')
    )
    const day2 = write(
      '2026-10-29',
      '000005_pwsh_api',
      head('2026-10-29 00:00:05', '235900_pwsh_api.md') + entry('00:00:10', 'echo two', 'two')
    )
    // an unrelated session on the same day must not leak in
    write(
      '2026-10-29',
      '090000_pwsh_other',
      head('2026-10-29 09:00:00') + entry('09:00:01', 'secret-other', 'x')
    )

    for (const start of [day1, day2]) {
      const out = await buildSessionExport(start, root)
      expect(out.name).toBe('2026-10-28_235900_pwsh_api_export.md')
      expect(out.markdown).toContain('# pwsh — api — session export')
      expect(out.markdown.indexOf('echo one')).toBeLessThan(out.markdown.indexOf('echo two'))
      expect(out.markdown).toContain('## 2026-10-28')
      expect(out.markdown).toContain('## 2026-10-29')
      expect(out.markdown).toContain('2 commands in 2 files.')
      expect(out.markdown).not.toContain('secret-other')
    }
  })

  it('falls back to the raw transcript for shells without structured history', async () => {
    const raw = write('2026-10-28', '101010_custom_misc', null, '[10:10:10.000] hello\n')
    const out = await buildSessionExport(raw, root)
    expect(out.markdown).toContain('no structured history')
    expect(out.markdown).toContain('hello')
  })
})
