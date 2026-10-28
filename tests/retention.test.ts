import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { applyRetention } from '../src/main/history/retention'

const root = mkdtempSync(join(tmpdir(), 'ciboard-ret-'))
afterAll(() => rmSync(root, { recursive: true, force: true }))

function days(...names: string[]): string {
  const dir = mkdtempSync(join(root, 'h-'))
  for (const n of names) {
    mkdirSync(join(dir, n))
    writeFileSync(join(dir, n, 'x.md'), 'x')
  }
  return dir
}

describe('applyRetention', () => {
  const now = new Date(2026, 9, 28, 12, 0, 0)

  it('deletes day folders older than N days and keeps the rest', async () => {
    const dir = days('2026-10-10', '2026-10-20', '2026-10-21', '2026-10-27', '2026-10-28')
    const removed = await applyRetention(dir, 7, now)
    expect(removed).toEqual(['2026-10-10', '2026-10-20'])
    expect(existsSync(join(dir, '2026-10-21'))).toBe(true)
    expect(existsSync(join(dir, '2026-10-28'))).toBe(true)
    expect(existsSync(join(dir, '2026-10-10'))).toBe(false)
  })

  it('never removes today, even with the smallest setting', async () => {
    const dir = days('2026-10-26', '2026-10-27', '2026-10-28')
    expect(await applyRetention(dir, 1, now)).toEqual(['2026-10-26'])
    expect(existsSync(join(dir, '2026-10-27'))).toBe(true)
    expect(existsSync(join(dir, '2026-10-28'))).toBe(true)
  })

  it('ignores unrelated folders and invalid settings', async () => {
    const dir = days('2020-01-01', 'notes')
    expect(await applyRetention(dir, 0, now)).toEqual([])
    expect(await applyRetention(dir, Number.NaN, now)).toEqual([])
    expect(await applyRetention(dir, 30, now)).toEqual(['2020-01-01'])
    expect(existsSync(join(dir, 'notes'))).toBe(true)
  })

  it('copes with a missing history folder', async () => {
    expect(await applyRetention(join(root, 'nope'), 5, now)).toEqual([])
  })
})
