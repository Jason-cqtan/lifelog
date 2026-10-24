// Shared pieces of the one-hue heatmap scale used by the yearly and all-time views.
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
