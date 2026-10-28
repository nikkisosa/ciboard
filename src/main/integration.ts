import { join } from 'node:path'
import { app } from 'electron'
import type { Profile } from '../shared/types'

export interface Integration {
  args: string[]
  env: Record<string, string>
  /** True when markers will be emitted (so a structured .md can be produced). */
  active: boolean
}

/** Directory holding pwsh.ps1 / bashrc.sh (next to the app in dev, in resources when packaged). */
export const integrationDir = (): string =>
  app.isPackaged
    ? join(process.resourcesPath, 'shell-integration')
    : join(app.getAppPath(), 'shell-integration')

/** `D:\a\b` -> `/mnt/d/a/b` (default WSL automount root). */
export function toWslPath(winPath: string): string {
  const m = /^([A-Za-z]):[\\/](.*)$/.exec(winPath)
  return m ? `/mnt/${m[1].toLowerCase()}/${m[2].replace(/\\/g, '/')}` : winPath.replace(/\\/g, '/')
}

/** PowerShell single-quoted string literal. */
const psQuote = (s: string): string => `'${s.replace(/'/g, "''")}'`

/** cmd PROMPT carrying the markers; $E is ESC and $E\ the string terminator. */
export function cmdPrompt(base: string): string {
  return `$E]133;D$E\\$E]633;P;Cwd=$P$E\\$E]133;A$E\\${base}$E]133;B$E\\`
}

/**
 * Per-shell injection that never touches the user's own profile files:
 *   pwsh / PS 5.1  -NoExit -Command ". '<dir>/pwsh.ps1'"   (runs after the user's profile)
 *   Git Bash / WSL  bash --rcfile <dir>/bashrc.sh -i        (the script sources ~/.bashrc itself)
 *   cmd             /k prompt <string with the markers>
 * Anything else (custom profiles, unknown shells) is left alone and only gets a raw transcript.
 */
export function buildIntegration(profile: Profile, enabled: boolean): Integration {
  const none: Integration = { args: profile.args, env: { CIBOARD: '1' }, active: false }
  if (!enabled) return none
  const dir = integrationDir()
  switch (profile.kind) {
    case 'pwsh':
    case 'powershell':
      return {
        args: ['-NoLogo', '-NoExit', '-Command', `. ${psQuote(join(dir, 'pwsh.ps1'))}`],
        env: { CIBOARD: '1' },
        active: true
      }
    case 'gitbash':
      return {
        args: ['--rcfile', join(dir, 'bashrc.sh'), '-i'],
        env: { CIBOARD: '1' },
        active: true
      }
    case 'wsl':
      // --exec starts bash directly (no shell word-splitting), so paths with spaces are safe.
      return {
        args: [
          ...profile.args,
          '--exec',
          'bash',
          '--rcfile',
          toWslPath(join(dir, 'bashrc.sh')),
          '-i'
        ],
        env: { CIBOARD: '1' },
        active: true
      }
    case 'cmd':
      // Arguments rather than an environment variable: an elevation helper in front of the shell
      // may or may not forward the environment, but it always forwards the command line.
      return {
        args: [
          ...profile.args,
          '/k',
          'prompt',
          cmdPrompt(profile.env?.PROMPT ?? process.env.PROMPT ?? '$P$G')
        ],
        env: { CIBOARD: '1' },
        active: true
      }
    default:
      return none
  }
}
