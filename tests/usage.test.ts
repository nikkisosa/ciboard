import { describe, expect, it } from 'vitest'
import {
  cpuPercent,
  cpuTable,
  descendants,
  parseProcLine,
  sessionUsage,
  sumCpuTimes,
  type ProcRow
} from '../src/main/monitor/usage'

const row = (pid: number, ppid: number, cpu = 0, mem = 1000): ProcRow => ({ pid, ppid, cpu, mem })

describe('parseProcLine', () => {
  it('parses semicolon separated rows and skips junk', () => {
    expect(parseProcLine('10,4,5000,2048;11,10,0,1;bad;12,x,1,1;0,0,0,0\n')).toEqual([
      { pid: 10, ppid: 4, cpu: 5000, mem: 2048 },
      { pid: 11, ppid: 10, cpu: 0, mem: 1 }
    ])
    expect(parseProcLine('')).toEqual([])
  })
})

describe('descendants', () => {
  it('collects children at any depth, not siblings', () => {
    const rows = [row(1, 0), row(2, 1), row(3, 2), row(4, 2), row(5, 99), row(6, 5)]
    expect([...descendants(rows, 2)].sort()).toEqual([2, 3, 4])
  })

  it('survives a parent cycle (pid reuse)', () => {
    expect(descendants([row(1, 2), row(2, 1)], 1).size).toBe(2)
  })
})

describe('sessionUsage', () => {
  // 2 cores, 2 s elapsed -> 4 core-seconds = 4e7 ticks available
  const sessions = new Map([
    ['a', 100],
    ['b', 200]
  ])

  it('sums CPU growth and memory over each session’s process tree, as % of the machine', () => {
    const before = [row(100, 1, 0), row(101, 100, 0), row(200, 1, 0)]
    const after = [
      row(100, 1, 1e7, 10),
      row(101, 100, 1e7, 20),
      row(200, 1, 0, 5),
      row(300, 1, 9e9, 7)
    ]
    const usage = sessionUsage(cpuTable(before), after, sessions, 2, 2)
    expect(usage.a).toEqual({ cpu: 50, mem: 30, procs: 2 }) // 2e7 of 4e7 ticks
    expect(usage.b).toEqual({ cpu: 0, mem: 5, procs: 1 })
  })

  it('ignores processes it has not seen before and processes that exited', () => {
    const before = [row(100, 1, 5e7), row(150, 100, 5e7)]
    // 150 exited; 160 is new and already has lots of cumulative CPU time
    const after = [row(100, 1, 5e7 + 1e7), row(160, 100, 8e9)]
    const usage = sessionUsage(cpuTable(before), after, sessions, 2, 2)
    expect(usage.a.cpu).toBe(25)
    expect(usage.a.procs).toBe(2)
  })

  it('omits sessions whose shell is gone and never reports above 100', () => {
    const usage = sessionUsage(
      new Map([[100, 0]]),
      [row(100, 1, 9e12)],
      new Map([
        ['a', 100],
        ['dead', 999]
      ]),
      1,
      1
    )
    expect(Object.keys(usage)).toEqual(['a'])
    expect(usage.a.cpu).toBe(100)
  })
})

describe('cpuPercent', () => {
  const cpus = (idle: number, busy: number) => [
    { times: { user: busy, nice: 0, sys: 0, idle, irq: 0 } },
    { times: { user: busy, nice: 0, sys: 0, idle, irq: 0 } }
  ]

  it('is the busy share between two snapshots', () => {
    const a = sumCpuTimes(cpus(1000, 1000))
    const b = sumCpuTimes(cpus(1900, 1100)) // per core: +900 idle, +100 busy -> 10 % busy
    expect(cpuPercent(a, b)).toBeCloseTo(10, 5)
  })

  it('is 0 when time did not advance', () => {
    const a = sumCpuTimes(cpus(5, 5))
    expect(cpuPercent(a, a)).toBe(0)
  })
})
