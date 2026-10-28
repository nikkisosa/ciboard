import { describe, expect, it } from 'vitest'
import {
  parseSudoRegistry,
  planElevation,
  wrapWithHelper,
  type ElevationDeps
} from '../src/main/elevation'

const SUDO = 'C:\\Windows\\System32\\sudo.exe'

function deps(
  over: Partial<ElevationDeps> & { files?: string[]; reg?: string } = {}
): ElevationDeps {
  const files = new Set(over.files ?? [])
  return {
    systemRoot: 'C:\\Windows',
    exists: (p) => files.has(p),
    readSudoRegistry: async () => over.reg ?? '',
    pathDirs: over.pathDirs ?? ['C:\\tools'],
    env: over.env ?? {
      LOCALAPPDATA: 'C:\\Users\\me\\AppData\\Local',
      ProgramFiles: 'C:\\Program Files'
    }
  }
}

const reg = (v: number): string =>
  `\nHKEY_LOCAL_MACHINE\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Sudo\n    Enabled    REG_DWORD    0x${v.toString(16)}\n`

describe('parseSudoRegistry', () => {
  it('maps the Enabled value to a mode', () => {
    expect(parseSudoRegistry('').kind).toBe('disabled')
    expect([0, 1, 2, 3].map((v) => parseSudoRegistry(reg(v)).kind)).toEqual([
      'disabled',
      'newWindow',
      'disableInput',
      'inline'
    ])
  })
})

describe('planElevation', () => {
  it('prefers Windows sudo when it is enabled in inline mode', async () => {
    const plan = await planElevation(deps({ files: [SUDO, 'C:\\tools\\gsudo.exe'], reg: reg(3) }))
    expect(plan).toEqual({ ok: true, helper: 'sudo', file: SUDO })
  })

  it('falls back to gsudo on PATH when sudo is disabled or not inline', async () => {
    for (const r of ['', reg(1), reg(2)]) {
      const plan = await planElevation(deps({ files: [SUDO, 'C:\\tools\\gsudo.exe'], reg: r }))
      expect(plan).toEqual({ ok: true, helper: 'gsudo', file: 'C:\\tools\\gsudo.exe' })
    }
  })

  it('finds the winget shim even when PATH has not been refreshed', async () => {
    const shim = 'C:\\Users\\me\\AppData\\Local\\Microsoft\\WinGet\\Links\\gsudo.exe'
    const plan = await planElevation(deps({ files: [shim] }))
    expect(plan).toEqual({ ok: true, helper: 'gsudo', file: shim })
  })

  it('explains how to enable sudo or install gsudo when neither is usable', async () => {
    const disabled = await planElevation(deps({ files: [SUDO], reg: '' }))
    expect(disabled.ok).toBe(false)
    if (!disabled.ok) {
      expect(disabled.message).toContain('installed but turned off')
      expect(disabled.message).toContain('winget install gerardog.gsudo')
      expect(disabled.message).toContain('Inline')
    }
    const missing = await planElevation(deps())
    expect(!missing.ok && missing.message).toContain('not available on this version')
    const wrongMode = await planElevation(deps({ files: [SUDO], reg: reg(1) }))
    expect(!wrongMode.ok && wrongMode.message).toContain('"new window"')
  })
})

describe('wrapWithHelper', () => {
  it('runs the shell as the helper’s command', () => {
    const wrapped = wrapWithHelper(
      { ok: true, helper: 'gsudo', file: 'C:\\g\\gsudo.exe' },
      'pwsh.exe',
      ['-NoLogo']
    )
    expect(wrapped).toEqual({ file: 'C:\\g\\gsudo.exe', args: ['pwsh.exe', '-NoLogo'] })
  })
})
