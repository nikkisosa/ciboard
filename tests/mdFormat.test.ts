import { describe, expect, it } from 'vitest'
import {
  decodeCommand,
  fenceLang,
  formatDuration,
  formatEntry,
  formatHeader,
  parseMd,
  truncateOutput
} from '../src/main/history/mdFormat'

describe('mdFormat', () => {
  it('formats durations', () => {
    expect([0, 1234, 9999, 45_400, 65_000, 3_725_000].map(formatDuration)).toEqual([
      '0.0s',
      '1.2s',
      '10.0s',
      '45s',
      '1m 05s',
      '62m 05s'
    ])
  })

  it('decodes the OSC 633;E escaping', () => {
    expect(decodeCommand('echo a\\x3b b \\\\ c\\x0aline2')).toBe('echo a; b \\ c\nline2')
  })

  it('maps shells to fence languages', () => {
    expect([fenceLang('pwsh'), fenceLang('bash'), fenceLang('cmd'), fenceLang('custom')]).toEqual([
      'powershell',
      'bash',
      'bat',
      'text'
    ])
  })

  it('writes the documented entry layout', () => {
    const md = formatEntry({
      time: '19:06:03',
      cwd: 'C:\\dev\\api',
      exit: '0',
      duration: '1.2s',
      command: 'git status',
      lang: 'powershell',
      output: 'On branch main\nnothing to commit, working tree clean'
    })
    expect(md).toBe(
      [
        '',
        '## 19:06:03 · C:\\dev\\api · exit 0 · 1.2s',
        '```powershell',
        'git status',
        '```',
        '```text',
        'On branch main',
        'nothing to commit, working tree clean',
        '```',
        ''
      ].join('\n')
    )
  })

  it('round-trips entries, including output that contains code fences', () => {
    const header = formatHeader({
      shell: 'pwsh',
      title: 'api-server',
      started: '2026-10-28 19:05:12',
      profile: 'PowerShell 7',
      elevated: false
    })
    const tricky = 'before\n```js\nconsole.log(1)\n```\nafter'
    const md =
      header +
      formatEntry({
        time: '19:06:03',
        cwd: 'C:\\dev\\api',
        exit: '0',
        duration: '1.2s',
        command: 'git status',
        lang: 'powershell',
        output: tricky
      }) +
      formatEntry({
        time: '19:07:10',
        cwd: 'C:\\dev\\api',
        exit: '?',
        duration: '1m 05s',
        command: 'dir',
        lang: 'bat',
        output: ''
      })
    const entries = parseMd(md, 'C:\\h\\2026-10-28\\a.raw.txt', '2026-10-28')
    expect(entries).toHaveLength(2)
    expect(entries[0]).toMatchObject({
      id: 'C:\\h\\2026-10-28\\a.raw.txt#0',
      session: 'pwsh — api-server',
      time: '19:06:03',
      cwd: 'C:\\dev\\api',
      exit: '0',
      duration: '1.2s',
      command: 'git status',
      lang: 'powershell',
      output: tricky
    })
    expect(entries[1]).toMatchObject({ exit: '?', duration: '1m 05s', command: 'dir', output: '' })
  })

  it('truncates long output with a pointer to the raw transcript', () => {
    const lines = Array.from({ length: 2500 }, (_, i) => `line ${i}`)
    const out = truncateOutput(lines, 2000, 'x.raw.txt').split('\n')
    expect(out).toHaveLength(2001)
    expect(out[2000]).toBe('[… 500 more lines truncated — full output in x.raw.txt]')
    expect(truncateOutput(['a', 'b'], 2000, 'x.raw.txt')).toBe('a\nb')
  })
})
