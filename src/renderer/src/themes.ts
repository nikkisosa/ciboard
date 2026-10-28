import type { ITheme } from '@xterm/xterm'

export interface TermScheme {
  name: string
  dark: boolean
  theme: ITheme
}

const ansi = (c: string[]): Partial<ITheme> => ({
  black: c[0],
  red: c[1],
  green: c[2],
  yellow: c[3],
  blue: c[4],
  magenta: c[5],
  cyan: c[6],
  white: c[7],
  brightBlack: c[8],
  brightRed: c[9],
  brightGreen: c[10],
  brightYellow: c[11],
  brightBlue: c[12],
  brightMagenta: c[13],
  brightCyan: c[14],
  brightWhite: c[15]
})

const solarized = [
  '#073642',
  '#dc322f',
  '#859900',
  '#b58900',
  '#268bd2',
  '#d33682',
  '#2aa198',
  '#eee8d5',
  '#002b36',
  '#cb4b16',
  '#586e75',
  '#657b83',
  '#839496',
  '#6c71c4',
  '#93a1a1',
  '#fdf6e3'
]

export const SCHEMES: TermScheme[] = [
  {
    name: 'Default Dark',
    dark: true,
    theme: {
      background: '#1e1e1e',
      foreground: '#cccccc',
      cursor: '#ffffff',
      selectionBackground: '#264f78'
    }
  },
  {
    name: 'Default Light',
    dark: false,
    theme: {
      background: '#ffffff',
      foreground: '#333333',
      cursor: '#333333',
      selectionBackground: '#add6ff',
      ...ansi([
        '#000000',
        '#cd3131',
        '#00bc00',
        '#949800',
        '#0451a5',
        '#bc05bc',
        '#0598bc',
        '#555555',
        '#666666',
        '#cd3131',
        '#14ce14',
        '#b5ba00',
        '#0451a5',
        '#bc05bc',
        '#0598bc',
        '#a5a5a5'
      ])
    }
  },
  {
    name: 'Campbell',
    dark: true,
    theme: {
      background: '#0c0c0c',
      foreground: '#cccccc',
      cursor: '#ffffff',
      ...ansi([
        '#0c0c0c',
        '#c50f1f',
        '#13a10e',
        '#c19c00',
        '#0037da',
        '#881798',
        '#3a96dd',
        '#cccccc',
        '#767676',
        '#e74856',
        '#16c60c',
        '#f9f1a5',
        '#3b78ff',
        '#b4009e',
        '#61d6d6',
        '#f2f2f2'
      ])
    }
  },
  {
    name: 'One Dark',
    dark: true,
    theme: {
      background: '#282c34',
      foreground: '#abb2bf',
      cursor: '#528bff',
      ...ansi([
        '#282c34',
        '#e06c75',
        '#98c379',
        '#e5c07b',
        '#61afef',
        '#c678dd',
        '#56b6c2',
        '#abb2bf',
        '#5c6370',
        '#e06c75',
        '#98c379',
        '#e5c07b',
        '#61afef',
        '#c678dd',
        '#56b6c2',
        '#ffffff'
      ])
    }
  },
  {
    name: 'Dracula',
    dark: true,
    theme: {
      background: '#282a36',
      foreground: '#f8f8f2',
      cursor: '#f8f8f2',
      ...ansi([
        '#21222c',
        '#ff5555',
        '#50fa7b',
        '#f1fa8c',
        '#bd93f9',
        '#ff79c6',
        '#8be9fd',
        '#f8f8f2',
        '#6272a4',
        '#ff6e6e',
        '#69ff94',
        '#ffffa5',
        '#d6acff',
        '#ff92df',
        '#a4ffff',
        '#ffffff'
      ])
    }
  },
  {
    name: 'Solarized Dark',
    dark: true,
    theme: { background: '#002b36', foreground: '#839496', cursor: '#93a1a1', ...ansi(solarized) }
  },
  {
    name: 'Solarized Light',
    dark: false,
    theme: {
      background: '#fdf6e3',
      foreground: '#657b83',
      cursor: '#586e75',
      selectionBackground: '#eee8d5',
      ...ansi(solarized)
    }
  }
]

export const AUTO_SCHEME = 'auto'

/** `auto` follows the app theme; unknown names fall back to the default for that theme. */
export function resolveScheme(name: string, prefersDark: boolean): TermScheme {
  const byName = SCHEMES.find((s) => s.name === name)
  if (byName) return byName
  return SCHEMES.find((s) => s.name === (prefersDark ? 'Default Dark' : 'Default Light'))!
}
