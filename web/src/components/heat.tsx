// Shared pieces of the one-hue heatmap scale used by the yearly and all-time views.
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type MouseEvent, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react'
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
 * Tooltip anchored above a point given in viewport coordinates. It is
 * position: fixed so the heatmap's horizontal scroll container cannot clip it,
 * and it closes on any scroll, since the anchor would then be stale, and on a
 * press outside its parent, the only way to dismiss one opened by a tap.
 * With `below` (the anchor's bottom edge) it opens under the anchor when there
 * is room, since an anchor in the pinned personal-bests bar would otherwise put
 * it behind the sticky nav; `wrap` is for sentences rather than short values.
 */
export function Tooltip({
  x,
  y,
  below,
  wrap,
  onClose,
  children,
}: {
  x: number
  y: number
  below?: number
  wrap?: boolean
  onClose: () => void
  children: ReactNode
}) {
  const ref = useRef<HTMLSpanElement>(null)
  useEffect(() => {
    const onPress = (e: Event) => {
      if (!ref.current?.parentElement?.contains(e.target as Node)) onClose()
    }
    window.addEventListener('scroll', onClose, { capture: true, passive: true })
    document.addEventListener('pointerdown', onPress)
    return () => {
      window.removeEventListener('scroll', onClose, { capture: true })
      document.removeEventListener('pointerdown', onPress)
    }
  }, [onClose])
  useLayoutEffect(() => {
    const el = ref.current!
    const { width, height } = el.getBoundingClientRect()
    // keep the centered bubble on screen near the left/right edges
    const edge = width / 2 + 8
    el.style.left = `${Math.max(edge, Math.min(x, window.innerWidth - edge))}px`
    const under = below !== undefined && below + height + 14 < window.innerHeight
    el.style.top = `${under ? below : y}px`
    el.classList.toggle('tooltip-below', under)
  })
  return (
    <span ref={ref} className={wrap ? 'tooltip tooltip-wrap' : 'tooltip'} role="tooltip">
      {children}
    </span>
  )
}

/**
 * Hover handlers for a real mouse only. A tap also fires pointer and compat
 * mouse events, which would open a tooltip just before the click and so make
 * every tap look like a click on a tooltip that was already showing.
 */
export function mouseHover<E extends Element>(show: (e: ReactPointerEvent<E>) => void, hide: () => void) {
  return {
    onPointerMove: (e: ReactPointerEvent<E>) => {
      if (e.pointerType === 'mouse') show(e)
    },
    onPointerLeave: (e: ReactPointerEvent<E>) => {
      if (e.pointerType === 'mouse') hide()
    },
  }
}

/** Inline content that explains itself in a tooltip, on hover or on click/tap. */
export function InfoTip({ text, children }: { text: string; children: ReactNode }) {
  const [at, setAt] = useState<{ x: number; y: number; below: number } | null>(null)
  const close = useCallback(() => setAt(null), [])
  const open = (e: MouseEvent<HTMLElement>) => {
    const r = e.currentTarget.getBoundingClientRect()
    setAt({ x: r.left + r.width / 2, y: r.top, below: r.bottom })
  }
  return (
    <span className="tip-anchor">
      <button type="button" className="tip-btn" aria-description={text} {...mouseHover(open, close)} onClick={open} onBlur={close}>
        {children}
      </button>
      {at && (
        <Tooltip {...at} wrap onClose={close}>
          {text}
        </Tooltip>
      )}
    </span>
  )
}

/** Converts a point in an SVG's viewBox units to viewport coordinates. */
export function toViewport(svg: SVGSVGElement, viewWidth: number, x: number, y: number) {
  const r = svg.getBoundingClientRect()
  const k = r.width / viewWidth
  return { x: r.left + x * k, y: r.top + y * k }
}

/**
 * Saves a heatmap as a PNG: a title, a stats line and the grid, on the current
 * theme's surface. CSS variables don't resolve inside a standalone SVG, so every
 * mark's computed color is copied onto the clone first.
 */
export async function downloadHeatmapPng(svg: SVGSVGElement, title: string, subtitle: string, filename: string) {
  const css = getComputedStyle(svg.closest('.panel') ?? document.body)
  const surface = css.backgroundColor
  const ink = getComputedStyle(document.body).color
  const muted = getComputedStyle(svg.querySelector('.axis-label') ?? svg).fill || ink

  const clone = svg.cloneNode(true) as SVGSVGElement
  const src = svg.querySelectorAll('rect, text')
  clone.querySelectorAll('rect, text').forEach((el, i) => {
    const cs = getComputedStyle(src[i])
    el.setAttribute('fill', cs.fill)
    el.removeAttribute('class')
    if (el.tagName === 'rect') el.setAttribute('stroke', 'none')
    else el.setAttribute('style', `font: ${cs.fontSize} system-ui, -apple-system, sans-serif`)
  })
  const w = Number(svg.getAttribute('width'))
  const h = Number(svg.getAttribute('height'))
  clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg')
  const url = URL.createObjectURL(new Blob([new XMLSerializer().serializeToString(clone)], { type: 'image/svg+xml' }))
  const img = new Image()
  img.src = url
  await img.decode()
  URL.revokeObjectURL(url)

  const pad = 24
  const head = 56
  const scale = 2
  const canvas = document.createElement('canvas')
  canvas.width = (w + pad * 2) * scale
  canvas.height = (h + pad * 2 + head) * scale
  const ctx = canvas.getContext('2d')!
  ctx.scale(scale, scale)
  ctx.fillStyle = surface
  ctx.fillRect(0, 0, w + pad * 2, h + pad * 2 + head)
  ctx.fillStyle = ink
  ctx.font = '600 17px system-ui, -apple-system, "PingFang SC", sans-serif'
  ctx.fillText(title, pad, pad + 14)
  ctx.fillStyle = muted
  ctx.font = '13px system-ui, -apple-system, "PingFang SC", sans-serif'
  ctx.fillText(subtitle, pad, pad + 36)
  ctx.drawImage(img, pad, pad + head, w, h)

  const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, 'image/png'))
  if (!blob) return
  const a = document.createElement('a')
  a.href = URL.createObjectURL(blob)
  a.download = filename
  a.click()
  setTimeout(() => URL.revokeObjectURL(a.href), 1000)
}

export function DownloadButton({ onClick }: { onClick: () => void }) {
  const { t } = useI18n()
  return (
    <button className="dl-btn" onClick={onClick} title={t.downloadPng} aria-label={t.downloadPng}>
      <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
        <path d="M12 4v11M7 10l5 5 5-5M5 20h14" />
      </svg>
    </button>
  )
}
