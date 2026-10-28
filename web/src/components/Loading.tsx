import { useI18n } from '../i18n'
import type { Category } from '../types'

export function NavigationSkeleton() {
  return (
    <div aria-hidden="true">
      <div className="tabs skeleton-tabs">
        {[64, 88, 64, 64].map((width, i) => <span key={i} className="skeleton" style={{ width }} />)}
      </div>
      <div className="years skeleton-years">
        {Array.from({ length: 6 }, (_, i) => <span key={i} className="skeleton" />)}
      </div>
    </div>
  )
}

export function HeatmapSkeleton({ category }: { category?: Category }) {
  const { lang, t } = useI18n()
  return (
    <section className={`panel panel-loading${category?.sport ? ' panel-loading-sport' : ''}`} aria-busy="true" aria-label={category?.label[lang]}>
      <header className="panel-head">
        <h3>
          {category ? <><span className="swatch" style={{ background: category.color }} />{category.label[lang]}</> : <span className="skeleton skeleton-title" />}
        </h3>
        <span className="loading-label" role="status">{t.loading}</span>
      </header>
      <div className="skeleton-chart" aria-hidden="true">
        <span className="skeleton" />
        <span className="skeleton" />
        <span className="skeleton" />
      </div>
      <div className="skeleton-footer" aria-hidden="true">
        <span className="skeleton" />
        <span className="skeleton" />
      </div>
      {category?.sport && <div className="skeleton skeleton-latest" aria-hidden="true" />}
    </section>
  )
}
