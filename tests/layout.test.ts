import { describe, expect, it } from 'vitest'
import { findSlot } from '../src/shared/layout'

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
