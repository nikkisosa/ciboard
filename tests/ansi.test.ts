import { describe, expect, it } from 'vitest'
import { ScreenLog } from '../src/main/history/ansi'

function make(height = 5): { screen: ScreenLog; lines: string[]; osc: string[] } {
  const lines: string[] = []
  const osc: string[] = []
  const screen = new ScreenLog({ onLine: (l) => lines.push(l), onOsc: (p) => osc.push(p) }, height)
  return { screen, lines, osc }
}

describe('ScreenLog', () => {
  it('strips colours and logs rows when they scroll off', () => {
    const { screen, lines } = make(2)
    screen.write('\x1b[31mred\x1b[0m\r\nsecond\r\nthird\r\n')
    expect(lines).toEqual(['red', 'second'])
  })

  it('flushes unfinished rows (prompts) once, and only when they change', () => {
    const { screen, lines } = make()
    screen.write('C:\\dev>')
    screen.flush()
    screen.flush()
    expect(lines).toEqual(['C:\\dev>'])
    screen.write(' git status')
    screen.flush()
    expect(lines).toEqual(['C:\\dev>', 'C:\\dev> git status'])
  })

  it('does not duplicate a ConPTY style repaint of rows already logged', () => {
    const { screen, lines } = make()
    screen.write('banner\r\nC:\\>')
    screen.flush()
    // repaint: home, rewrite the same rows with absolute positioning, erase to end of line
    screen.write('\x1b[H\x1b[Kbanner\x1b[2;1H\x1b[KC:\\>')
    screen.flush()
    expect(lines).toEqual(['banner', 'C:\\>'])
  })

  it('applies cursor movement, carriage return overwrite and erase', () => {
    const { screen, lines } = make()
    screen.write('progress 10%\rprogress 99%\x1b[K\r\n')
    screen.write('abcd\x1b[2D\x1b[KX\r\n')
    screen.flush()
    expect(lines).toEqual(['progress 99%', 'abX'])
  })

  it('reports OSC payloads (BEL and ST terminated) without printing them', () => {
    const { screen, lines, osc } = make()
    screen.write('\x1b]0;title\x07ok\x1b]133;D;0\x1b\\ done\r\n')
    screen.flush()
    expect(osc).toEqual(['0;title', '133;D;0'])
    expect(lines).toEqual(['ok done'])
  })

  it('handles sequences split across writes', () => {
    const { screen, lines } = make()
    screen.write('a\x1b[3')
    screen.write('1mb\x1b]7;file:')
    screen.write('///c\x07c\r\n')
    screen.flush()
    expect(lines).toEqual(['abc'])
  })

  it('ignores a full repaint at shifted rows right after a resize', () => {
    const { screen, lines } = make(4)
    screen.write('one\r\ntwo\r\nC:>')
    screen.flush()
    screen.resize(80, 6)
    // conpty re-draws the same content, now starting at a different row
    screen.write('\x1b[2J\x1b[3;1Hone\x1b[4;1Htwo\x1b[5;1HC:>')
    screen.flush()
    expect(lines).toEqual(['one', 'two', 'C:>'])
    // genuinely new output right after is still logged
    screen.write('\r\nnew output')
    screen.flush()
    expect(lines).toContain('new output')
  })

  it('does not log alternate-screen content', () => {
    const { screen, lines } = make()
    screen.write('before\r\n\x1b[?1049hvim content\r\n\x1b[?1049l')
    screen.flush()
    expect(lines).toEqual(['before'])
  })

  it('writes the screen out before clearing it', () => {
    const { screen, lines } = make()
    screen.write('keep me\r\n\x1b[2J\x1b[Hfresh')
    screen.flush()
    expect(lines).toEqual(['keep me', 'fresh'])
  })

  it('keeps content in place when the screen shrinks below the cursor', () => {
    const { screen, lines } = make(10)
    screen.write('top\r\nprompt>')
    screen.resize(80, 4)
    // a cursor-addressed update for row 2 (1-based) must land on the prompt row, not a blank one
    screen.write('\x1b[2;8Hdir')
    screen.flush()
    expect(lines).toEqual(['top', 'prompt>dir'])
  })

  it('logs a line that auto-wrapped at the terminal width as one logical line', () => {
    const lines: string[] = []
    const screen = new ScreenLog({ onLine: (l) => lines.push(l) }, 6, 10)
    screen.write('abcdefghijklmnopqrstuvwxyz\r\nnext\r\n')
    screen.flush()
    expect(lines).toEqual(['abcdefghijklmnopqrstuvwxyz', 'next'])
  })

  it('addresses a wrapped prompt line the way ConPTY does', () => {
    const lines: string[] = []
    const screen = new ScreenLog({ onLine: (l) => lines.push(l) }, 6, 10)
    screen.resize(10, 6)
    // 14-character prompt wraps over two rows; ConPTY then places typed text with CUP row 2
    screen.write('0123456789ABCD')
    screen.write('\x1b[2;5Hdir')
    screen.flush()
    expect(lines).toEqual(['0123456789ABCDdir'])
  })
})
