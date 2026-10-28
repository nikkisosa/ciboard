import { useSyncExternalStore } from 'react'
import type { ITheme } from '@xterm/xterm'
import { DEFAULT_FONT_FAMILY, DEFAULT_FONT_SIZE } from '@shared/defaults'
import type { Settings } from '@shared/types'
import { resolveScheme } from './themes'

export interface Appearance {
  fontFamily: string
  fontSize: number
  theme: ITheme
  /** Terminal background, also used behind the terminal canvas. */
  background: string
}

const media = window.matchMedia('(prefers-color-scheme: dark)')
const listeners = new Set<() => void>()
let settings: Settings | null = null
let appearance: Appearance = compute()

function compute(): Appearance {
  const scheme = resolveScheme(settings?.terminalScheme ?? 'auto', media.matches)
  return {
    fontFamily: settings?.fontFamily || DEFAULT_FONT_FAMILY,
    fontSize: settings?.fontSize || DEFAULT_FONT_SIZE,
    theme: scheme.theme,
    background: scheme.theme.background ?? '#1e1e1e'
  }
}

function changed(): void {
  appearance = compute()
  listeners.forEach((l) => l())
}

// Windows (or the Light/Dark/System setting) flipped: terminals set to "auto" follow.
media.addEventListener('change', changed)

export const getAppearance = (): Appearance => appearance
export const getSettings = (): Settings | null => settings

export function subscribeSettings(l: () => void): () => void {
  listeners.add(l)
  return () => listeners.delete(l)
}

let started: Promise<void> | null = null

/** Load the settings once and keep them in sync with changes made anywhere (menu, dialog). */
export function initSettings(): Promise<void> {
  return (started ??= (async () => {
    settings = await window.ciboard.settings.get()
    changed()
    window.ciboard.settings.onChanged((s) => {
      settings = s
      changed()
    })
  })())
}

export async function updateSettings(patch: Partial<Settings>): Promise<void> {
  // Apply locally first: repeated shortcuts (font zoom) must build on each other and the UI
  // should not wait for the round trip to main.
  if (settings) {
    settings = { ...settings, ...patch }
    changed()
  }
  settings = await window.ciboard.settings.set(patch)
  changed()
}

export const useAppearance = (): Appearance =>
  useSyncExternalStore(subscribeSettings, getAppearance)

export const useSettings = (): Settings | null =>
  useSyncExternalStore(subscribeSettings, getSettings)
