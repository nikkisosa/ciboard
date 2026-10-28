import { execFile } from 'node:child_process'
import { existsSync } from 'node:fs'
import { delimiter, join } from 'node:path'
import type { Profile } from '../shared/types'
import { getSettings } from './settings'

const env = (k: string): string => process.env[k] ?? ''

function onPath(exe: string): string | null {
  for (const dir of env('PATH').split(delimiter)) {
    if (!dir) continue
    const p = join(dir, exe)
    if (existsSync(p)) return p
  }
  return null
}

function firstExisting(paths: string[]): string | null {
  return paths.find((p) => p && existsSync(p)) ?? null
}

/** `wsl -l -q` prints UTF-16LE; decode and drop blanks. */
export function parseWslList(buf: Buffer): string[] {
  return buf
    .toString('utf16le')
    .replace(/\0/g, '')
    .split(/\r?\n/)
    .map((s) => s.replace(/^\uFEFF/, '').trim())
    .filter((s) => s && !/^docker-desktop(-data)?$/i.test(s))
}

function wslDistros(): Promise<string[]> {
  return new Promise((resolve) => {
    execFile(
      'wsl.exe',
      ['-l', '-q'],
      { encoding: 'buffer', timeout: 5000, windowsHide: true },
      (err, stdout) => resolve(err ? [] : parseWslList(stdout))
    )
  })
}

function gitBashPath(): string | null {
  const direct = firstExisting([
    join(env('ProgramFiles'), 'Git', 'bin', 'bash.exe'),
    join(env('ProgramFiles(x86)'), 'Git', 'bin', 'bash.exe'),
    join(env('LOCALAPPDATA'), 'Programs', 'Git', 'bin', 'bash.exe')
  ])
  if (direct) return direct
  // Derive from git.exe on PATH: <root>\cmd\git.exe -> <root>\bin\bash.exe
  const git = onPath('git.exe')
  if (git) return firstExisting([join(git, '..', '..', 'bin', 'bash.exe')])
  return null
}

export async function detectBuiltinProfiles(): Promise<Profile[]> {
  const base = { cwd: undefined, admin: false, builtin: true }
  const out: Profile[] = []
  const sys = join(env('SystemRoot') || 'C:\\Windows', 'System32')

  out.push({
    ...base,
    id: 'cmd',
    name: 'Command Prompt',
    kind: 'cmd',
    file: join(sys, 'cmd.exe'),
    args: [],
    icon: '>_',
    color: '#9aa0a6'
  })

  const ps5 = join(sys, 'WindowsPowerShell', 'v1.0', 'powershell.exe')
  if (existsSync(ps5))
    out.push({
      ...base,
      id: 'powershell',
      name: 'Windows PowerShell 5.1',
      kind: 'powershell',
      file: ps5,
      args: ['-NoLogo'],
      icon: 'PS',
      color: '#3b82f6'
    })

  const pwsh =
    firstExisting([
      join(env('ProgramFiles'), 'PowerShell', '7', 'pwsh.exe'),
      join(env('LOCALAPPDATA'), 'Microsoft', 'WindowsApps', 'pwsh.exe')
    ]) ?? onPath('pwsh.exe')
  if (pwsh)
    out.push({
      ...base,
      id: 'pwsh',
      name: 'PowerShell 7',
      kind: 'pwsh',
      file: pwsh,
      args: ['-NoLogo'],
      icon: 'P7',
      color: '#22d3ee'
    })

  const bash = gitBashPath()
  if (bash)
    out.push({
      ...base,
      id: 'gitbash',
      name: 'Git Bash',
      kind: 'gitbash',
      file: bash,
      args: ['--login', '-i'],
      icon: 'GB',
      color: '#f97316'
    })

  for (const distro of await wslDistros())
    out.push({
      ...base,
      id: `wsl:${distro}`,
      name: `WSL: ${distro}`,
      kind: 'wsl',
      file: 'wsl.exe',
      args: ['-d', distro],
      icon: '🐧',
      color: '#a3e635'
    })

  return out
}

let detected: Promise<Profile[]> | null = null

/** Built-ins (detected once per run, admin toggles applied) followed by custom profiles. */
export async function listProfiles(): Promise<Profile[]> {
  detected ??= detectBuiltinProfiles()
  const [builtins, settings] = await Promise.all([detected, getSettings()])
  return [
    ...builtins.map((p) => ({ ...p, admin: settings.builtinAdmin[p.id] ?? p.admin })),
    ...settings.customProfiles.map((p) => ({ ...p, kind: 'custom' as const, builtin: false }))
  ]
}

export async function getProfile(id: string): Promise<Profile | undefined> {
  return (await listProfiles()).find((p) => p.id === id)
}
