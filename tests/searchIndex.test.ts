import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { formatEntry, formatHeader } from '../src/main/history/mdFormat'
import { SearchIndex } from '../src/main/history/searchIndex'

const root = mkdtempSync(join(tmpdir(), 'ciboard-idx-'))
afterAll(() => rmSync(root, { recursive: true, force: true }))

function session(
  day: string,
  stem: string,
  title: string,
  cmds: [string, string, string][]
): string {
  const dir = join(root, day)
  mkdirSync(dir, { recursive: true })
  const md =
    formatHeader({
      shell: 'pwsh',
      title,
      started: `${day} 10:00:00`,
      profile: 'PowerShell 7',
      elevated: false
    }) +
    cmds
      .map(([command, cwd, output]) =>
        formatEntry({
          time: '10:01:00',
          cwd,
          exit: '0',
          duration: '0.5s',
          command,
          lang: 'powershell',
          output
        })
      )
      .join('')
  writeFileSync(join(dir, `${stem}.md`), md)
  return join(dir, `${stem}.raw.txt`)
}

describe('SearchIndex', () => {
  const yesterday = session('2026-10-27', '101010_pwsh_api', 'api', [
    [
      'kubectl rollout status deploy/api',
      'C:\\dev\\api',
      'deployment "api" successfully rolled out'
    ],
    ['git status', 'C:\\dev\\api', 'nothing to commit']
  ])
  const today = session('2026-10-28', '190512_bash_web', 'web', [
    ['npm run build', 'C:\\dev\\web', 'built in 4s'],
    ['git status', 'C:\\dev\\web', 'On branch main']
  ])

  it('finds a command run in another session on another day', async () => {
    const idx = new SearchIndex()
    await idx.build(root)
    const hits = await idx.search('kubectl', null)
    expect(hits.map((h) => h.command)).toEqual(['kubectl rollout status deploy/api'])
    expect(hits[0]).toMatchObject({ date: '2026-10-27', file: yesterday })
  })

  it('searches output text and supports prefixes', async () => {
    const idx = new SearchIndex()
    await idx.build(root)
    expect((await idx.search('rolled', null))[0]?.command).toContain('kubectl')
    expect((await idx.search('depl', null)).length).toBeGreaterThan(0)
  })

  it('can be limited to one session', async () => {
    const idx = new SearchIndex()
    await idx.build(root)
    const all = await idx.search('git status', null)
    const mine = await idx.search('git status', [today])
    expect(all).toHaveLength(2)
    expect(mine).toHaveLength(1)
    expect(mine[0].cwd).toBe('C:\\dev\\web')
  })

  it('indexes entries added after the initial build and forgets removed files', async () => {
    const idx = new SearchIndex()
    await idx.build(root)
    idx.add({
      id: `${today}#9`,
      file: today,
      index: 9,
      date: '2026-10-28',
      time: '19:30:00',
      cwd: 'C:\\dev\\web',
      exit: '1',
      duration: '1.0s',
      command: 'terraform apply',
      lang: 'bash',
      output: '',
      session: 'bash — web'
    })
    expect(await idx.search('terraform', null)).toHaveLength(1)
    idx.removeFiles(new Set([today]))
    expect(await idx.search('terraform', null)).toHaveLength(0)
    expect(await idx.search('npm', null)).toHaveLength(0)
  })
})
