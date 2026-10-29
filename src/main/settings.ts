import { join } from 'node:path'
import { DEFAULT_FONT_FAMILY, DEFAULT_FONT_SIZE } from '../shared/defaults'
import type { Settings } from '../shared/types'
import { DEFAULT_REDACTION_PATTERNS } from './history/redact'
import { dataDir, readJson, writeJson } from './store'

const file = (): string => join(dataDir(), 'settings.json')

const defaults = (): Settings => ({
  version: 1,
  customProfiles: [],
  builtinAdmin: {},
  historyDir: null,
  adminMode: 'per-terminal',
  theme: 'system',
  terminalScheme: 'auto',
  fontFamily: DEFAULT_FONT_FAMILY,
  fontSize: DEFAULT_FONT_SIZE,
  redactionPatterns: DEFAULT_REDACTION_PATTERNS,
  historyRetentionDays: null,
  resourceMonitor: true,
  monitorIntervalSec: 2,
  contextAlerts: true,
  contextAlertPercent: 40,
  contextWindow: 200000,
  shellIntegration: true,
  agentCommands: {},
  historyOutputLimit: 2000
})

let cache: Settings | null = null

export async function getSettings(): Promise<Settings> {
  if (!cache) cache = { ...defaults(), ...(await readJson<Partial<Settings>>(file())) }
  return cache
}

export async function setSettings(patch: Partial<Settings>): Promise<Settings> {
  cache = { ...(await getSettings()), ...patch, version: 1 }
  await writeJson(file(), cache)
  return cache
}
