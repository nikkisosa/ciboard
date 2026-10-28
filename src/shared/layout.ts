export interface Rect {
  x: number
  y: number
  w: number
  h: number
}

export const GRID_COLS = 24

const overlaps = (a: Rect, b: Rect): boolean =>
  a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h

/** First free slot (row-major scan) of size w x h that overlaps no existing rect. */
export function findSlot(existing: readonly Rect[], w: number, h: number, cols = GRID_COLS): Rect {
  w = Math.min(w, cols)
  for (let y = 0; ; y++) {
    for (let x = 0; x + w <= cols; x++) {
      const cand = { x, y, w, h }
      if (!existing.some((r) => overlaps(cand, r))) return cand
    }
  }
}
