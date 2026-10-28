import { execFile } from 'node:child_process'
import { existsSync } from 'node:fs'
import { delimiter, join } from 'node:path'

/**
 * Elevation helpers.
 *
 * CIBoard never elevates on its own and never touches credentials. The UAC consent prompt is
 * shown by Windows (via `sudo` / `gsudo` / the `runas` verb) and is not bypassed.
 */

export type SudoState =
  | { kind: 'missing' }
  | { kind: 'disabled' }
  | { kind: 'newWindow' }
  | { kind: 'disableInput' }
  | { kind: 'inline' }

export type ElevationPlan =
  { ok: true; helper: 'sudo' | 'gsudo'; file: string } | { ok: false; message: string }

export interface ElevationDeps {
  systemRoot: string
  exists(path: string): boolean
  /** Output of `reg query HKLM\...\Sudo /v Enabled`, or '' when the key does not exist. */
  readSudoRegistry(): Promise<string>
  /** Directories of the PATH variable. */
  pathDirs: string[]
  env: NodeJS.ProcessEnv
}

/** Parse `Enabled REG_DWORD 0x3` (0 off, 1 new window, 2 input disabled, 3 inline). */
export function parseSudoRegistry(output: string): SudoState {
  const m = /Enabled\s+REG_DWORD\s+0x([0-9a-f]+)/i.exec(output)
  if (!m) return { kind: 'disabled' }
  switch (parseInt(m[1], 16)) {
    case 1:
      return { kind: 'newWindow' }
    case 2:
      return { kind: 'disableInput' }
    case 3:
      return { kind: 'inline' }
    default:
      return { kind: 'disabled' }
  }
}

export async function sudoState(deps: ElevationDeps): Promise<SudoState> {
  if (!deps.exists(join(deps.systemRoot, 'System32', 'sudo.exe'))) return { kind: 'missing' }
  return parseSudoRegistry(await deps.readSudoRegistry())
}

function findGsudo(deps: ElevationDeps): string | null {
  const candidates = [
    ...deps.pathDirs.map((d) => join(d, 'gsudo.exe')),
    // winget puts a shim here; a PATH change from a fresh install is not seen by running apps.
    join(deps.env.LOCALAPPDATA ?? '', 'Microsoft', 'WinGet', 'Links', 'gsudo.exe'),
    join(deps.env.ProgramFiles ?? '', 'gsudo', 'Current', 'gsudo.exe')
  ]
  return candidates.find((c) => c && deps.exists(c)) ?? null
}

export const HELP_TEXT = [
  'Administrator terminals need an elevation helper that runs inside the terminal:',
  '',
  '  1. Windows sudo (Windows 11 24H2 or later), set to inline mode:',
  '       Settings > System > For developers > Enable sudo > Configure as "Inline"',
  '       (or, in an administrator terminal: sudo config --enable normal)',
  '  2. gsudo:   winget install gerardog.gsudo',
  '',
  'Windows will show a UAC prompt when you open the terminal; CIBoard never bypasses it.',
  'To elevate the whole app instead, use File > Restart as Administrator.'
].join('\n')

const sudoNotUsable: Record<Exclude<SudoState['kind'], 'inline'>, string> = {
  missing: 'Windows sudo is not available on this version of Windows.',
  disabled: 'Windows sudo is installed but turned off.',
  newWindow: 'Windows sudo is on but set to "new window"; CIBoard needs "inline" mode.',
  disableInput: 'Windows sudo is on but set to "input disabled"; CIBoard needs "inline" mode.'
}

/** Pick the elevation helper: Windows sudo (inline) first, then gsudo, else explain. */
export async function planElevation(deps: ElevationDeps): Promise<ElevationPlan> {
  const sudo = await sudoState(deps)
  if (sudo.kind === 'inline')
    return { ok: true, helper: 'sudo', file: join(deps.systemRoot, 'System32', 'sudo.exe') }
  const gsudo = findGsudo(deps)
  if (gsudo) return { ok: true, helper: 'gsudo', file: gsudo }
  return {
    ok: false,
    message: `${sudoNotUsable[sudo.kind]}\ngsudo was not found on PATH.\n\n${HELP_TEXT}`
  }
}

/** Run `file args` through the helper (`sudo file args` / `gsudo file args`). */
export function wrapWithHelper(
  plan: Extract<ElevationPlan, { ok: true }>,
  file: string,
  args: string[]
): { file: string; args: string[] } {
  return { file: plan.file, args: [file, ...args] }
}

export function realDeps(): ElevationDeps {
  return {
    systemRoot: process.env.SystemRoot || 'C:\\Windows',
    exists: existsSync,
    readSudoRegistry: () =>
      new Promise((resolve) => {
        execFile(
          'reg.exe',
          ['query', 'HKLM\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Sudo', '/v', 'Enabled'],
          { windowsHide: true, timeout: 5000 },
          (err, stdout) => resolve(err ? '' : stdout)
        )
      }),
    pathDirs: (process.env.PATH ?? '').split(delimiter).filter(Boolean),
    env: process.env
  }
}

let elevated: Promise<boolean> | null = null

/** True when this process runs with an elevated token (`fltmc` only works for administrators). */
export function isAppElevated(): Promise<boolean> {
  return (elevated ??= new Promise((resolve) => {
    execFile('fltmc.exe', [], { windowsHide: true, timeout: 5000 }, (err) => resolve(!err))
  }))
}

/**
 * Start another instance of the app through the `runas` verb (ShellExecute), which shows the UAC
 * prompt. Resolves true once Windows launched it, false if the user declined.
 */
export function relaunchElevated(cwd: string, execPath: string, args: string[]): Promise<boolean> {
  const q = (s: string): string => `'${s.replace(/'/g, "''")}'`
  const argList = args.length ? ` -ArgumentList ${args.map(q).join(',')}` : ''
  const script = `Start-Process -FilePath ${q(execPath)}${argList} -WorkingDirectory ${q(cwd)} -Verb RunAs`
  return new Promise((resolve) => {
    execFile(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-Command', script],
      { windowsHide: true },
      (err) => resolve(!err)
    )
  })
}
