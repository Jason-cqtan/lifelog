// Shared pieces of the one-hue heatmap scale used by the yearly and all-time views.
import { useEffect, type ReactNode } from 'react'
import { useI18n } from '../i18n'

// color-mix percentage of the category color per intensity level
export const LEVEL_MIX = [0, 28, 52, 76, 100]

/**
 * Returns a value -> level (0-4) function. Quartiles of the non-zero values pick
 * the four levels, so one huge outlier does not wash out everything else.
 */
export function quartileLevels(values: number[]): (v: number) => number {
  const nz = values.filter((v) => v > 0).sort((a, b) => a - b)
  const q = [0.25, 0.5, 0.75].map((p) => nz[Math.floor(p * (nz.length - 1))] ?? 0)
  return (v) => (v <= 0 ? 0 : v <= q[0] ? 1 : v <= q[1] ? 2 : v <= q[2] ? 3 : 4)
}

export function levelFill(color: string, level: number): string {
  return level === 0 ? 'var(--cell-empty)' : `color-mix(in oklab, ${color} ${LEVEL_MIX[level]}%, var(--surface))`
}

export function Scale({ color }: { color: string }) {
  const { t } = useI18n()
  return (
    <div className="scale" aria-hidden>
      {t.less}
      {LEVEL_MIX.map((_, i) => (
        <i key={i} style={{ background: levelFill(color, i) }} />
      ))}
      {t.more}
    </div>
  )
}

/**
 * Hover tooltip anchored above a point given in viewport coordinates. It is
 * position: fixed so the heatmap's horizontal scroll container cannot clip it,
 * and it hides on any scroll since the anchor would then be stale.
 */
export function Tooltip({ x, y, onScroll, children }: { x: number; y: number; onScroll: () => void; children: ReactNode }) {
  useEffect(() => {
    window.addEventListener('scroll', onScroll, { capture: true, passive: true })
    return () => window.removeEventListener('scroll', onScroll, { capture: true })
  }, [onScroll])
  // keep the centered bubble on screen near the left/right edges
  const left = Math.min(Math.max(x, 72), window.innerWidth - 72)
  return (
    <div className="tooltip" style={{ left, top: y }}>
      {children}
    </div>
  )
}

/** Converts a point in an SVG's viewBox units to viewport coordinates. */
export function toViewport(svg: SVGSVGElement, viewWidth: number, x: number, y: number) {
  const r = svg.getBoundingClientRect()
  const k = r.width / viewWidth
  return { x: r.left + x * k, y: r.top + y * k }
}
