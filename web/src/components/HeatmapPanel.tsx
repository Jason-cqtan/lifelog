import { Component, Suspense, lazy, useEffect, useRef, useState, type ReactNode } from 'react'
import { useI18n } from '../i18n'
import type { Category, Data, SportType } from '../types'
import { DuolingoCourses } from './DuolingoCourses'
import { Heatmap } from './Heatmap'
import { HeatmapSkeleton } from './Loading'

// the first screen shows Heatmap, so it ships with the main bundle; "all years" is on demand
const Overview = lazy(() => import('./Overview').then((m) => ({ default: m.Overview })))

// A failed chunk request should leave the rest of the page usable.
class PanelBoundary extends Component<{ children: ReactNode; fallback: ReactNode }, { failed: boolean }> {
  state = { failed: false }
  static getDerivedStateFromError() { return { failed: true } }
  render() { return this.state.failed ? this.props.fallback : this.props.children }
}

interface Props {
  category: Category
  year: number | 'all'
  data: Data | null
  onDrill: (type: SportType, period: string) => void
  onOpen: (id: string) => void
}

export function HeatmapPanel({ category, year, data, onDrill, onOpen }: Props) {
  const { t } = useI18n()
  const container = useRef<HTMLDivElement>(null)
  const [nearViewport, setNearViewport] = useState(false)

  useEffect(() => {
    if (!('IntersectionObserver' in window)) {
      setNearViewport(true)
      return
    }
    const observer = new IntersectionObserver(([entry]) => {
      if (!entry.isIntersecting) return
      setNearViewport(true)
      observer.disconnect()
    }, { rootMargin: '200px 0px' })
    if (container.current) observer.observe(container.current)
    return () => observer.disconnect()
  }, [])

  const skeleton = <HeatmapSkeleton category={category} />
  let content = skeleton
  // Do not calculate stats, mount SVGs, or request chart code until needed.
  if (nearViewport && data) {
    const props = {
      category,
      daily: data.daily,
      activities: category.sport ? data.activities.filter((a) => a.type === category.sport && (year === 'all' || a.date.startsWith(String(year)))) : undefined,
      onDrill,
      onOpen,
      extra: category.key === 'duolingo' && data.duolingo ? <DuolingoCourses data={data.duolingo} period={String(year)} /> : undefined,
    }
    content = (
      <PanelBoundary fallback={
        <section className="panel load-error" role="alert">
          <p>{t.chartLoadError}</p>
          <button className="more" onClick={() => location.reload()}>{t.reload}</button>
        </section>
      }>
        <Suspense fallback={skeleton}>
          {year === 'all' ? <Overview {...props} /> : <Heatmap {...props} year={year} />}
        </Suspense>
      </PanelBoundary>
    )
  }

  return <div className="heatmap-panel" ref={container}>{content}</div>
}
