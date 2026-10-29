import { describe, expect, it } from 'vitest'
import { findSlot, flowLayout } from '../src/shared/layout'

describe('findSlot', () => {
  it('places the first tile at the origin', () => {
    expect(findSlot([], 8, 8)).toEqual({ x: 0, y: 0, w: 8, h: 8 })
  })

  it('fills across the row before starting a new one', () => {
    const a = findSlot([], 8, 8)
    const b = findSlot([a], 8, 8)
    const c = findSlot([a, b], 8, 8)
    const d = findSlot([a, b, c], 8, 8)
    expect([b.x, c.x, d.x, d.y]).toEqual([8, 16, 0, 8])
  })

  it('skips holes that are too small', () => {
    // x 0-4 is free but only 4 wide, so an 8-wide tile lands to the right of the block.
    expect(findSlot([{ x: 4, y: 0, w: 4, h: 8 }], 8, 4)).toEqual({ x: 8, y: 0, w: 8, h: 4 })
    // In a narrow grid there is no room beside it, so it drops below.
    expect(findSlot([{ x: 4, y: 0, w: 4, h: 8 }], 8, 4, 12).y).toBe(8)
  })
})

describe('flowLayout', () => {
  const tile = (id: string, w = 8, h = 9): { id: string; w: number; h: number } => ({ id, w, h })

  it('wraps tiles like inline-block elements', () => {
    const out = flowLayout([tile('a'), tile('b'), tile('c'), tile('d')])
    expect([out.a, out.b, out.c, out.d].map((r) => [r.x, r.y])).toEqual([
      [0, 0],
      [8, 0],
      [16, 0],
      [0, 9]
    ])
  })

  it('closes gaps: removing a tile pulls the rest back in order', () => {
    const out = flowLayout([tile('a'), tile('c'), tile('d')])
    expect([out.c.x, out.c.y, out.d.x, out.d.y]).toEqual([8, 0, 16, 0])
  })

  it('starts the next row below the tallest tile', () => {
    const out = flowLayout([tile('a', 12, 5), tile('b', 12, 12), tile('c', 12, 4)])
    expect(out.c.y).toBe(12)
  })
})
