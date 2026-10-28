import { useEffect, useState } from 'react'
import type { Profile } from '@shared/types'
import { workspace } from '../workspace'

interface Props {
  profiles: Profile[]
  onClose: () => void
}

const emptyDraft = (): Profile => ({
  id: `custom:${crypto.randomUUID()}`,
  name: '',
  kind: 'custom',
  file: '',
  args: [],
  cwd: '',
  env: {},
  icon: '$',
  color: '#c084fc',
  admin: false,
  builtin: false
})

const envToText = (env: Record<string, string> | undefined): string =>
  Object.entries(env ?? {})
    .map(([k, v]) => `${k}=${v}`)
    .join('\n')

function textToEnv(text: string): Record<string, string> {
  const env: Record<string, string> = {}
  for (const line of text.split(/\r?\n/)) {
    const i = line.indexOf('=')
    if (i > 0) env[line.slice(0, i).trim()] = line.slice(i + 1)
  }
  return env
}

export function ProfilePicker({ profiles, onClose }: Props): React.JSX.Element {
  const [draft, setDraft] = useState<Profile | null>(null)
  const [argsText, setArgsText] = useState('')
  const [envText, setEnvText] = useState('')

  useEffect(() => {
    const h = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') {
        if (draft) setDraft(null)
        else onClose()
      }
      const n = Number(e.key)
      if (!draft && n >= 1 && n <= 9 && profiles[n - 1]) pick(profiles[n - 1])
    }
    window.addEventListener('keydown', h)
    return () => window.removeEventListener('keydown', h)
  }, [draft, profiles])

  const pick = (p: Profile, admin = false): void => {
    workspace.addTile(p.id, { admin })
    onClose()
  }

  const edit = (p: Profile): void => {
    setDraft(p)
    setArgsText(p.args.join(' '))
    setEnvText(envToText(p.env))
  }

  const save = async (): Promise<void> => {
    if (!draft || !draft.name.trim() || !draft.file.trim()) return
    const saved: Profile = {
      ...draft,
      name: draft.name.trim(),
      file: draft.file.trim(),
      args: argsText.match(/"[^"]*"|\S+/g)?.map((a) => a.replace(/^"|"$/g, '')) ?? [],
      cwd: draft.cwd?.trim() || undefined,
      env: textToEnv(envText)
    }
    const custom = profiles.filter((p) => !p.builtin && p.id !== saved.id)
    await workspace.saveCustomProfiles([...custom, saved])
    setDraft(null)
  }

  const remove = async (p: Profile): Promise<void> => {
    await workspace.saveCustomProfiles(profiles.filter((x) => !x.builtin && x.id !== p.id))
  }

  return (
    <div className="modal-backdrop" onMouseDown={onClose}>
      <div className="modal" onMouseDown={(e) => e.stopPropagation()}>
        {draft ? (
          <>
            <h3>{draft.name ? 'Edit profile' : 'New profile'}</h3>
            <label>
              Name
              <input
                value={draft.name}
                onChange={(e) => setDraft({ ...draft, name: e.target.value })}
              />
            </label>
            <label>
              Executable
              <input
                placeholder="C:\path\to\shell.exe"
                value={draft.file}
                onChange={(e) => setDraft({ ...draft, file: e.target.value })}
              />
            </label>
            <label>
              Arguments
              <input value={argsText} onChange={(e) => setArgsText(e.target.value)} />
            </label>
            <label>
              Working directory
              <input
                value={draft.cwd ?? ''}
                onChange={(e) => setDraft({ ...draft, cwd: e.target.value })}
              />
            </label>
            <label>
              Environment (KEY=VALUE per line)
              <textarea rows={3} value={envText} onChange={(e) => setEnvText(e.target.value)} />
            </label>
            <div className="row">
              <label>
                Icon
                <input
                  maxLength={3}
                  value={draft.icon}
                  onChange={(e) => setDraft({ ...draft, icon: e.target.value })}
                />
              </label>
              <label>
                Color
                <input
                  type="color"
                  value={draft.color}
                  onChange={(e) => setDraft({ ...draft, color: e.target.value })}
                />
              </label>
              <label className="check">
                <input
                  type="checkbox"
                  checked={draft.admin}
                  onChange={(e) => setDraft({ ...draft, admin: e.target.checked })}
                />
                Run as administrator
              </label>
            </div>
            <div className="row end">
              <button onClick={() => setDraft(null)}>Cancel</button>
              <button className="primary" onClick={() => void save()}>
                Save
              </button>
            </div>
          </>
        ) : (
          <>
            <h3>New terminal</h3>
            <ul className="profile-list">
              {profiles.map((p, i) => (
                <li key={p.id}>
                  <button className="profile-item" onClick={() => pick(p)}>
                    <span className="tile-icon" style={{ color: p.color }}>
                      {p.icon}
                    </span>
                    <span className="grow">{p.name}</span>
                    {i < 9 && <kbd>{i + 1}</kbd>}
                  </button>
                  <button
                    className="admin-btn"
                    title="Open as administrator (Windows asks for approval)"
                    onClick={() => pick(p, true)}
                  >
                    🛡 Admin
                  </button>
                  <label className="check-inline" title="Always open this profile as administrator">
                    <input
                      type="checkbox"
                      checked={p.admin}
                      onChange={(e) => void workspace.setProfileAdmin(p, e.target.checked)}
                    />
                    always
                  </label>
                  {!p.builtin && (
                    <>
                      <button className="icon-btn" title="Edit" onClick={() => edit(p)}>
                        ✎
                      </button>
                      <button className="icon-btn" title="Delete" onClick={() => void remove(p)}>
                        🗑
                      </button>
                    </>
                  )}
                </li>
              ))}
            </ul>
            <div className="row end">
              <button onClick={() => edit(emptyDraft())}>New profile…</button>
              <button onClick={onClose}>Close</button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
