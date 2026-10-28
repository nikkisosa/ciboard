interface Props {
  orientation: 'vertical' | 'horizontal'
  /** Called with the pointer delta (px) since the drag started. */
  onDrag: (delta: number) => void
  onStart?: () => void
}

/** Thin drag handle between two regions. */
export function Splitter({ orientation, onDrag, onStart }: Props): React.JSX.Element {
  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>): void => {
    e.preventDefault()
    const target = e.currentTarget
    target.setPointerCapture(e.pointerId)
    const start = orientation === 'vertical' ? e.clientX : e.clientY
    onStart?.()
    const move = (ev: PointerEvent): void =>
      onDrag((orientation === 'vertical' ? ev.clientX : ev.clientY) - start)
    const up = (): void => {
      target.removeEventListener('pointermove', move)
      target.removeEventListener('pointerup', up)
    }
    target.addEventListener('pointermove', move)
    target.addEventListener('pointerup', up)
  }
  return <div className={`splitter ${orientation}`} onPointerDown={onPointerDown} />
}
