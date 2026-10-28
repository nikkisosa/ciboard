import { describe, expect, it } from 'vitest'
import { ancestorIn } from '../src/main/claude/contextWatcher'
import { contextPercent, lastContextTokens } from '../src/main/claude/transcript'

const turn = (usage: object, extra: object = {}): string =>
  JSON.stringify({ type: 'assistant', message: { model: 'claude-x', usage }, ...extra })

describe('lastContextTokens', () => {
  it('sums input and cache tokens of the newest response', () => {
    const text = [
      turn({ input_tokens: 5, cache_read_input_tokens: 1000 }),
      turn({ input_tokens: 4, cache_creation_input_tokens: 72, cache_read_input_tokens: 80000 })
    ].join('\n')
    expect(lastContextTokens(text)).toEqual({ tokens: 80076, model: 'claude-x' })
  })

  it('skips sub-agent turns, synthetic messages, cut-off lines and non-usage lines', () => {
    const text = [
      'tail of a cut-off line"}}',
      turn({ input_tokens: 100 }),
      turn({ input_tokens: 90000 }, { isSidechain: true }),
      JSON.stringify({ type: 'user', message: { content: 'hi' } }),
      JSON.stringify({ message: { model: '<synthetic>', usage: { input_tokens: 1 } } })
    ].join('\n')
    expect(lastContextTokens(text)?.tokens).toBe(100)
  })

  it('returns null without any usage', () => {
    expect(lastContextTokens('')).toBeNull()
    expect(lastContextTokens('{"type":"user"}')).toBeNull()
  })
})

describe('contextPercent', () => {
  it('measures against the window', () => {
    expect(contextPercent(80000, 200000)).toEqual({ percent: 40, window: 200000 })
  })

  it('treats a session beyond the window as a 1M-window session', () => {
    expect(contextPercent(250000, 200000)).toEqual({ percent: 25, window: 1000000 })
  })
})

describe('ancestorIn', () => {
  const parents = new Map([
    [30, 20],
    [20, 10],
    [10, 1]
  ])
  it('finds the terminal shell above a process', () => {
    expect(ancestorIn(30, parents, new Map([[10, 'a']]))).toBe(10)
  })
  it('returns -1 for a process outside every terminal', () => {
    expect(ancestorIn(30, parents, new Map([[99, 'a']]))).toBe(-1)
  })
})
