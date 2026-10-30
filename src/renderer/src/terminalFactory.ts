import { Terminal, type ITerminalOptions } from '@xterm/xterm'
import { Unicode11Addon } from '@xterm/addon-unicode11'
import { WebLinksAddon } from '@xterm/addon-web-links'
import '@xterm/xterm/css/xterm.css'
import { getAppearance, subscribeSettings } from './settingsStore'

/** Shortcuts the app handles itself; xterm must not swallow them. */
export const isAppShortcut = (e: KeyboardEvent): boolean =>
  (e.ctrlKey && e.key === 'Tab') ||
  (e.ctrlKey && e.key === ',') ||
  (e.ctrlKey && ['=', '+', '-', '_', '0'].includes(e.key)) ||
  (e.ctrlKey && e.shiftKey && ['T', 'L', 'B'].includes(e.key.toUpperCase()))

/** Text from the system clipboard goes through the shell as a paste (bracketed when the app asks). */
export async function pasteInto(term: Terminal): Promise<void> {
  const text = await window.ciboard.clipboard.readText()
  if (text) term.paste(text)
}

export function copySelection(term: Terminal): boolean {
  if (!term.hasSelection()) return false
  window.ciboard.clipboard.writeText(term.getSelection())
  return true
}

/**
 * Ctrl+C copies while text is selected (otherwise it stays the interrupt key), Ctrl+Shift+C always
 * copies, Ctrl+V / Ctrl+Shift+V / Shift+Insert paste. Returns true when the key was handled.
 */
export function handleClipboardKey(term: Terminal, e: KeyboardEvent): boolean {
  if (e.type !== 'keydown') return false
  const key = e.key.toLowerCase()
  if (e.altKey && key === 'enter' && !e.ctrlKey && !e.shiftKey) {
    e.preventDefault() // Alt+Enter is a newline (ESC CR) for CLIs; never a window/menu action
    term.input('\x1b\r')
    return true
  }
  if (e.altKey) return false
  if (e.ctrlKey && key === 'c' && (e.shiftKey || term.hasSelection())) {
    e.preventDefault()
    copySelection(term)
    return true
  }
  if ((e.ctrlKey && key === 'v') || (e.shiftKey && !e.ctrlKey && key === 'insert')) {
    e.preventDefault() // otherwise the browser also fires a native paste event: double paste
    void pasteInto(term)
    return true
  }
  return false
}

/** Right click: copy the selection (and clear it), or paste when nothing is selected. */
export function attachContextPaste(term: Terminal, el: HTMLElement): () => void {
  const h = (e: MouseEvent): void => {
    e.preventDefault()
    if (copySelection(term)) term.clearSelection()
    else void pasteInto(term)
  }
  el.addEventListener('contextmenu', h)
  return () => el.removeEventListener('contextmenu', h)
}

export function createTerminal(opts: ITerminalOptions = {}): Terminal {
  const a = getAppearance()
  const term = new Terminal({
    fontFamily: a.fontFamily,
    fontSize: a.fontSize,
    theme: a.theme,
    allowProposedApi: true,
    scrollback: 3000,
    ...opts
  })
  term.loadAddon(new Unicode11Addon())
  term.unicode.activeVersion = '11'
  term.loadAddon(new WebLinksAddon())
  term.attachCustomKeyEventHandler((e) => !handleClipboardKey(term, e) && !isAppShortcut(e))
  return term
}

/**
 * Keep a terminal in step with the font and colour settings. `onFontChange` runs after the
 * font changed so the caller can re-fit / re-measure. Returns the unsubscribe function.
 */
export function followAppearance(term: Terminal, onFontChange: () => void): () => void {
  return subscribeSettings(() => {
    const a = getAppearance()
    const fontChanged =
      term.options.fontFamily !== a.fontFamily || term.options.fontSize !== a.fontSize
    term.options.theme = a.theme
    if (fontChanged) {
      term.options.fontFamily = a.fontFamily
      term.options.fontSize = a.fontSize
      onFontChange()
    }
  })
}
