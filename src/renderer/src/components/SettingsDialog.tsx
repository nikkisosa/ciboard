import { useEffect, useState } from 'react'
import { DEFAULT_FONT_FAMILY, DEFAULT_FONT_SIZE } from '@shared/defaults'
import { DEFAULT_REDACTION_PATTERNS, validatePattern } from '@shared/redaction'
import type { AdminMode, AppInfo, Settings, ThemeSetting } from '@shared/types'
import { updateSettings } from '../settingsStore'
import { AUTO_SCHEME, SCHEMES } from '../themes'

type Section = 'appearance' | 'alerts' | 'history' | 'privacy' | 'admin'

const SECTIONS: { id: Section; label: string }[] = [
  { id: 'appearance', label: 'Appearance' },
  { id: 'alerts', label: 'Alerts' },
  { id: 'history', label: 'History' },
  { id: 'privacy', label: 'Privacy' },
  { id: 'admin', label: 'Administrator' }
]

interface Props {
  settings: Settings
  appInfo: AppInfo
  onClose: () => void
}

const toInt = (v: string): number | null => {
  const n = parseInt(v, 10)
  return Number.isFinite(n) ? n : null
}

export function SettingsDialog({ settings, appInfo, onClose }: Props): React.JSX.Element {
  const [section, setSection] = useState<Section>('appearance')
  const [theme, setTheme] = useState<ThemeSetting>(settings.theme)
  const [scheme, setScheme] = useState(settings.terminalScheme)
  const [fontFamily, setFontFamily] = useState(settings.fontFamily)
  const [fontSize, setFontSize] = useState(String(settings.fontSize))
  const [historyDir, setHistoryDir] = useState<string | null>(settings.historyDir)
  const [retention, setRetention] = useState(
    settings.historyRetentionDays == null ? '' : String(settings.historyRetentionDays)
  )
  const [limit, setLimit] = useState(String(settings.historyOutputLimit))
  const [integration, setIntegration] = useState(settings.shellIntegration)
  const [monitorOn, setMonitorOn] = useState(settings.resourceMonitor)
  const [interval, setIntervalSec] = useState(String(settings.monitorIntervalSec))
  const [ctxAlerts, setCtxAlerts] = useState(settings.contextAlerts)
  const [ctxPercent, setCtxPercent] = useState(String(settings.contextAlertPercent))
  const [ctxWindow, setCtxWindow] = useState(String(settings.contextWindow))
  const [patterns, setPatterns] = useState(settings.redactionPatterns.join('\n'))
  const [adminMode, setAdminMode] = useState<AdminMode>(settings.adminMode)
  const [cleared, setCleared] = useState(false)

  useEffect(() => {
    const h = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', h)
    return () => window.removeEventListener('keydown', h)
  }, [onClose])

  const patternList = patterns
    .split('\n')
    .map((p) => p.trim())
    .filter(Boolean)
  const badPatterns = patternList
    .map((p) => ({ p, err: validatePattern(p) }))
    .filter((x) => x.err !== null)

  const size = toInt(fontSize)
  const sizeOk = size !== null && size >= 8 && size <= 40
  const limitN = toInt(limit)
  const limitOk = limitN !== null && limitN >= 10
  const retentionN = retention.trim() === '' ? null : toInt(retention)
  const retentionOk = retention.trim() === '' || (retentionN !== null && retentionN >= 1)
  const intervalN = toInt(interval)
  const intervalOk = intervalN !== null && intervalN >= 1 && intervalN <= 30
  const ctxN = toInt(ctxPercent)
  const ctxOk = ctxN !== null && ctxN >= 1 && ctxN <= 99
  const ctxWindowN = toInt(ctxWindow)
  const ctxWindowOk = ctxWindowN !== null && ctxWindowN >= 10000
  const valid =
    ctxWindowOk &&
    sizeOk &&
    limitOk &&
    retentionOk &&
    intervalOk &&
    ctxOk &&
    badPatterns.length === 0

  const save = async (): Promise<void> => {
    if (!valid) return
    await updateSettings({
      theme,
      terminalScheme: scheme,
      fontFamily: fontFamily.trim() || DEFAULT_FONT_FAMILY,
      fontSize: size!,
      historyDir,
      historyRetentionDays: retentionN,
      historyOutputLimit: limitN!,
      shellIntegration: integration,
      resourceMonitor: monitorOn,
      monitorIntervalSec: intervalN!,
      contextAlerts: ctxAlerts,
      contextAlertPercent: ctxN!,
      contextWindow: ctxWindowN!,
      redactionPatterns: patternList,
      adminMode
    })
    onClose()
  }

  const pickFolder = async (): Promise<void> => {
    const dir = await window.ciboard.dialog.pickFolder(historyDir ?? undefined)
    if (dir) setHistoryDir(dir)
  }

  return (
    <div className="modal-backdrop" onMouseDown={onClose}>
      <div className="modal settings" onMouseDown={(e) => e.stopPropagation()}>
        <h3>Settings</h3>
        <div className="settings-body">
          <nav className="settings-nav">
            {SECTIONS.map((s) => (
              <button
                key={s.id}
                className={section === s.id ? 'on' : ''}
                onClick={() => setSection(s.id)}
              >
                {s.label}
              </button>
            ))}
          </nav>
          <div className="settings-pane">
            {section === 'appearance' && (
              <>
                <label>
                  App theme
                  <select value={theme} onChange={(e) => setTheme(e.target.value as ThemeSetting)}>
                    <option value="system">Follow Windows</option>
                    <option value="light">Light</option>
                    <option value="dark">Dark</option>
                  </select>
                </label>
                <label>
                  Terminal colour scheme
                  <select value={scheme} onChange={(e) => setScheme(e.target.value)}>
                    <option value={AUTO_SCHEME}>Match the app theme</option>
                    {SCHEMES.map((s) => (
                      <option key={s.name} value={s.name}>
                        {s.name}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  Font family
                  <input value={fontFamily} onChange={(e) => setFontFamily(e.target.value)} />
                  <span className="hint">
                    CSS font list. Use a Nerd Font to show prompt symbols (oh-my-posh).{' '}
                    <a
                      href="#"
                      onClick={(e) => {
                        e.preventDefault()
                        setFontFamily(DEFAULT_FONT_FAMILY)
                        setFontSize(String(DEFAULT_FONT_SIZE))
                      }}
                    >
                      Reset font
                    </a>
                  </span>
                </label>
                <label>
                  Font size (8–40)
                  <input
                    type="number"
                    min={8}
                    max={40}
                    value={fontSize}
                    onChange={(e) => setFontSize(e.target.value)}
                    className={sizeOk ? '' : 'invalid'}
                  />
                </label>
                <label className="check">
                  <input
                    type="checkbox"
                    checked={monitorOn}
                    onChange={(e) => setMonitorOn(e.target.checked)}
                  />
                  Show CPU / memory monitor (status bar and a chip on every terminal)
                </label>
                <label>
                  Sample every (seconds, 1–30)
                  <input
                    type="number"
                    min={1}
                    max={30}
                    value={interval}
                    disabled={!monitorOn}
                    onChange={(e) => setIntervalSec(e.target.value)}
                    className={intervalOk ? '' : 'invalid'}
                  />
                  <span className="hint">
                    Per-terminal numbers come from a small hidden PowerShell process that lists
                    running processes; it stops when the monitor is switched off.
                  </span>
                </label>
              </>
            )}

            {section === 'alerts' && (
              <>
                <label className="check">
                  <input
                    type="checkbox"
                    checked={ctxAlerts}
                    onChange={(e) => setCtxAlerts(e.target.checked)}
                  />
                  Critical alert when a Claude session has used too much of its context
                </label>
                <label>
                  Alert at context used (%, 1–99)
                  <input
                    type="number"
                    min={1}
                    max={99}
                    value={ctxPercent}
                    disabled={!ctxAlerts}
                    onChange={(e) => setCtxPercent(e.target.value)}
                    className={ctxOk ? '' : 'invalid'}
                  />
                  <span className="hint">
                    Each terminal is checked on its own. CIBoard finds the Claude Code session
                    running in a terminal and reads its token count from the session transcript, so
                    no status line is needed. Dropping back under the limit (/compact, /clear)
                    re-arms the alert.
                  </span>
                </label>
                <label>
                  Context window (tokens)
                  <input
                    type="number"
                    min={10000}
                    step={10000}
                    value={ctxWindow}
                    disabled={!ctxAlerts}
                    onChange={(e) => setCtxWindow(e.target.value)}
                    className={ctxWindowOk ? '' : 'invalid'}
                  />
                  <span className="hint">
                    200000 for the standard window, 1000000 for 1M-context models. A session that
                    goes past this number is measured against 1M automatically.
                  </span>
                </label>
              </>
            )}

            {section === 'history' && (
              <>
                <label>
                  History folder
                  <div className="row">
                    <input
                      readOnly
                      className="grow"
                      value={historyDir ?? ''}
                      placeholder={`${appInfo.defaultHistoryDir} (default)`}
                    />
                    <button onClick={() => void pickFolder()}>Change…</button>
                    <button disabled={historyDir === null} onClick={() => setHistoryDir(null)}>
                      Default
                    </button>
                    <button onClick={() => void window.ciboard.history.openFolder()}>Open</button>
                  </div>
                  <span className="hint">
                    New terminals write to the new folder; existing history is not moved and running
                    terminals keep their current files.
                  </span>
                </label>
                <label>
                  Keep history for (days) — empty keeps everything
                  <input
                    type="number"
                    min={1}
                    value={retention}
                    onChange={(e) => setRetention(e.target.value)}
                    className={retentionOk ? '' : 'invalid'}
                    placeholder="forever"
                  />
                  <span className="hint">
                    Day folders older than this are deleted at startup and hourly. Today is never
                    deleted.
                  </span>
                </label>
                <label>
                  Output lines kept per command in the .md file
                  <input
                    type="number"
                    min={10}
                    value={limit}
                    onChange={(e) => setLimit(e.target.value)}
                    className={limitOk ? '' : 'invalid'}
                  />
                  <span className="hint">The raw transcript always keeps everything.</span>
                </label>
                <label className="check">
                  <input
                    type="checkbox"
                    checked={integration}
                    onChange={(e) => setIntegration(e.target.checked)}
                  />
                  Shell integration (structured command history) for new terminals
                </label>
              </>
            )}

            {section === 'privacy' && (
              <>
                <label>
                  Redaction patterns — one regular expression per line, case-insensitive
                  <textarea
                    rows={9}
                    spellCheck={false}
                    value={patterns}
                    onChange={(e) => setPatterns(e.target.value)}
                    className="mono"
                  />
                  <span className="hint">
                    Matches are replaced with [REDACTED] before anything is written to disk. If a
                    pattern has a capture group, only that group is masked.{' '}
                    <a
                      href="#"
                      onClick={(e) => {
                        e.preventDefault()
                        setPatterns(DEFAULT_REDACTION_PATTERNS.join('\n'))
                      }}
                    >
                      Reset to defaults
                    </a>
                  </span>
                  {badPatterns.map((b) => (
                    <span key={b.p} className="err-line">
                      Invalid: {b.p} — {b.err}
                    </span>
                  ))}
                </label>
                <div className="danger-zone">
                  <strong>Delete history</strong>
                  <span className="hint">
                    Removes every session file in the history folder. Pause a single terminal’s
                    logging with Ctrl+Shift+L; delete one session from the History panel.
                  </span>
                  <button
                    className="danger"
                    onClick={() =>
                      void window.ciboard.history.clearAll().then((ok) => ok && setCleared(true))
                    }
                  >
                    Clear all history…
                  </button>
                  {cleared && <span className="hint">All history was deleted.</span>}
                </div>
              </>
            )}

            {section === 'admin' && (
              <>
                <p className="hint">
                  CIBoard never elevates by itself. Windows shows its own approval (UAC) prompt, and
                  no credentials are stored or logged.
                  {appInfo.elevated && ' CIBoard is running as administrator now.'}
                </p>
                <label className="check">
                  <input
                    type="radio"
                    checked={adminMode === 'per-terminal'}
                    onChange={() => setAdminMode('per-terminal')}
                  />
                  Per terminal — open individual terminals as administrator (Windows sudo in inline
                  mode, or gsudo)
                </label>
                <label className="check">
                  <input
                    type="radio"
                    checked={adminMode === 'whole-app'}
                    onChange={() => setAdminMode('whole-app')}
                  />
                  Whole app — restart CIBoard as administrator; every terminal is then elevated
                </label>
                <div className="row">
                  <button
                    disabled={appInfo.elevated}
                    onClick={() => void window.ciboard.app.restartAsAdmin()}
                  >
                    Restart as Administrator…
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
        <div className="row end">
          <button onClick={onClose}>Cancel</button>
          <button className="primary" disabled={!valid} onClick={() => void save()}>
            Save
          </button>
        </div>
      </div>
    </div>
  )
}
