# CIBoard

![CIBoard: workspace tabs, terminal tiles and a context alert](docs/banner.gif)

Many terminals in one Windows window. Terminals sit as tiles on a canvas, the active one is
mirrored in a larger focus panel, and everything you run is kept as searchable history. Each tab is
a workspace, and shells keep running while their tab is in the background.

Built with Electron, React, xterm.js and node-pty.

## Features

- **Workspace tabs.** One tab per project. Rename, reorder by dragging, close with middle-click.
  Every shell comes back in its last folder after a restart; tabs you haven't opened yet start the
  first time you click them.
- **Claude context alerts.** If a terminal runs Claude Code, CIBoard reads the session's token
  count and raises a critical alert on that tile once it passes a limit you set (40% by default).
  The tab shows a badge so you notice it from another tab too. See [Context alerts](#context-alerts).
- **History.** Commands, working directory, exit code, duration and output are stored per session
  as Markdown, with full-text search. Passwords never reach the log, and secret patterns are masked.
- **Resource monitor.** CPU and RAM for the machine, plus a chip on every terminal.
- Broadcast typing to several terminals, find in terminal, font zoom, light and dark themes,
  PowerShell / pwsh / cmd / Git Bash / WSL profiles, and optional administrator terminals.

## Run

```bash
npm install
npm run dev
```

`npm run dist` builds an installer and a portable exe into `release/`. `npm run pack` gives an
unpacked build. Before sending changes: `npm run typecheck && npm run lint && npm test`.

## Keys

| Keys | Action |
| --- | --- |
| Ctrl+Shift+T | New terminal |
| Ctrl+Shift+N | New tab |
| Ctrl+PageUp / PageDown | Previous / next tab |
| Ctrl+Tab / Ctrl+Shift+Tab | Next / previous terminal |
| Ctrl+Shift+L | Pause or resume logging for the terminal |
| Ctrl+Shift+B | Add or remove the terminal from broadcast |
| Ctrl+Shift+F | Find in the focus panel |
| Ctrl + `+` / `-` / `0`, or Ctrl + wheel | Font size |
| Ctrl+, | Settings |

## Context alerts

Settings > Alerts sets the limit (1-99%) and the context window size. Claude Code doesn't have to
show anything on screen: CIBoard looks for the `claude` process inside each terminal, finds its
session in `~/.claude`, and measures the tokens of the latest response against the window. The
window defaults to 200,000 tokens; a session that goes past it is measured against 1,000,000.

Each terminal is judged on its own. Dismissing an alert hides it until the session drops back under
the limit (`/compact`, `/clear`) and crosses it again. When the terminal is in another tab, or the
window isn't focused, you also get a system notification.

## Where things are

| What | Where |
| --- | --- |
| Settings and layout | `%APPDATA%\CIBoard\settings.json`, `layout.json` |
| History | `%APPDATA%\CIBoard\history\<date>\` (folder is configurable) |
| Per session | `<time>_<shell>_<title>.md` and `.raw.txt` |

Structured history needs shell integration, which CIBoard injects without editing your profile
files (see `shell-integration/`). Custom profiles only get the raw transcript.

## Privacy and administrator terminals

Only what the terminal displays is logged, never keystrokes. Redaction patterns (Settings >
Privacy) mask secrets before they reach disk, logging can be paused per terminal, and history can
be deleted or expire after a number of days.

CIBoard never elevates on its own and stores no credentials. An administrator terminal runs through
Windows `sudo` (inline mode) or `gsudo`, and Windows shows the UAC prompt. Administrator terminals
restored from a layout wait for a click instead of prompting at launch.

