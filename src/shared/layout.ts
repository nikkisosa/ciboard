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

/**
 * Browser-style flow: tiles keep their order and are laid left to right, wrapping to a new row
 * when the next one does not fit. A row is as tall as its tallest tile. Because positions are
 * derived from order and size alone, closing, resizing or reordering a tile re-packs the rest.
 */
export function flowLayout(
  items: readonly { id: string; w: number; h: number }[],
  cols = GRID_COLS
): Record<string, Rect> {
  const out: Record<string, Rect> = {}
  let x = 0
  let y = 0
  let rowH = 0
  for (const it of items) {
    const w = Math.min(it.w, cols)
    if (x > 0 && x + w > cols) {
      x = 0
      y += rowH
      rowH = 0
    }
    out[it.id] = { x, y, w, h: it.h }
    x += w
    rowH = Math.max(rowH, it.h)
  }
  return out
}
