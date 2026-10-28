import { describe, expect, it } from 'vitest'
import { ScreenLog } from '../src/main/history/ansi'
import { CommandTracker, parseOsc7, type FinishedCommand } from '../src/main/history/commandTracker'

/** Wire a ScreenLog and a CommandTracker the way SessionLog does. */
function rig(): { write(d: string): void; done: FinishedCommand[]; tracker: CommandTracker } {
  const done: FinishedCommand[] = []
  const screen = new ScreenLog(
    {
      onLine: (l) => tracker.line(l),
      onOsc: (p) => tracker.osc(p),
      onEnter: (t) => tracker.inferred(t)
    },
    10
  )
  const tracker: CommandTracker = new CommandTracker({
    flush: () => screen.flush(),
    markAnchor: () => screen.markAnchor(),
    infer: true,
    onCwd: () => {},
    onStart: () => {},
    onFinished: (d) => done.push(d)
  })
  return { write: (d) => screen.write(d), done, tracker }
}

const OSC = (p: string): string => `\x1b]${p}\x07`

describe('CommandTracker', () => {
  it('records command, cwd, exit code and output from explicit markers (pwsh/bash)', () => {
    const r = rig()
    r.write(OSC('133;D') + OSC('633;P;Cwd=C:\\dev') + OSC('133;A') + 'PS> ' + OSC('133;B'))
    r.write('git status\r\n' + OSC('633;E;git status') + OSC('133;C'))
    r.write('On branch main\r\nnothing to commit\r\n')
    r.write(OSC('133;D;0') + OSC('633;P;Cwd=C:\\dev') + OSC('133;A') + 'PS> ' + OSC('133;B'))
    expect(r.done).toHaveLength(1)
    expect(r.done[0]).toMatchObject({
      command: 'git status',
      cwd: 'C:\\dev',
      exit: '0',
      output: ['On branch main', 'nothing to commit']
    })
  })

  it('does not record empty command lines', () => {
    const r = rig()
    r.write(OSC('133;A') + 'PS> ' + OSC('133;B') + '\r\n')
    r.write(OSC('133;D') + OSC('133;A') + 'PS> ' + OSC('133;B'))
    expect(r.done).toHaveLength(0)
  })

  it('keeps non-zero exit codes', () => {
    const r = rig()
    r.write(OSC('133;A') + '$ ' + OSC('133;B') + 'false\r\n' + OSC('633;E;false') + OSC('133;C'))
    r.write(OSC('133;D;1'))
    expect(r.done[0]).toMatchObject({ command: 'false', exit: '1', output: [] })
  })

  it('infers the command from the screen for cmd (no C marker, no exit code)', () => {
    const r = rig()
    r.write(OSC('133;D') + OSC('633;P;Cwd=C:\\Users\\me') + OSC('133;A') + 'C:\\Users\\me>')
    r.write(OSC('133;B') + 'echo hi\r\nhi\r\n')
    r.write(OSC('133;D') + OSC('133;A') + 'C:\\Users\\me>' + OSC('133;B'))
    expect(r.done).toHaveLength(1)
    expect(r.done[0]).toMatchObject({
      command: 'echo hi',
      cwd: 'C:\\Users\\me',
      exit: '?',
      output: ['hi']
    })
  })

  it('still infers the command when the pty was resized after the prompt was drawn', () => {
    const done: FinishedCommand[] = []
    const screen: ScreenLog = new ScreenLog(
      {
        onLine: (l) => tracker.line(l),
        onOsc: (p) => tracker.osc(p),
        onEnter: (t) => tracker.inferred(t)
      },
      10
    )
    const tracker: CommandTracker = new CommandTracker({
      flush: () => screen.flush(),
      markAnchor: () => screen.markAnchor(),
      infer: true,
      onCwd: () => {},
      onStart: () => {},
      onFinished: (d) => done.push(d)
    })
    screen.write(OSC('133;A') + 'C:>' + OSC('133;B'))
    screen.resize(80, 5)
    // ConPTY repaints the prompt on another row, then the user types and presses Enter
    screen.write('\x1b[2J\x1b[3;1HC:>' + 'ver\r\n')
    screen.write(OSC('133;D'))
    expect(done[0]).toMatchObject({ command: 'ver', exit: '?' })
  })

  it('finishes an in-flight command as interrupted when the session ends', () => {
    const r = rig()
    r.write(
      OSC('133;A') + '$ ' + OSC('133;B') + 'sleep 9\r\n' + OSC('633;E;sleep 9') + OSC('133;C')
    )
    r.write('partial\r\n')
    r.tracker.interrupt()
    expect(r.done[0]).toMatchObject({ command: 'sleep 9', exit: '?', output: ['partial'] })
  })
})

describe('parseOsc7', () => {
  it('converts file URIs to native paths', () => {
    expect(parseOsc7('file://host/C:/Users/me%20x')).toBe('C:\\Users\\me x')
    expect(parseOsc7('file:///home/me')).toBe('/home/me')
    expect(parseOsc7('nope')).toBeNull()
  })
})
