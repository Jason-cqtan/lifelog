import { useMemo, useState } from 'react'
import { SPORT_LABEL, type Activity, type SportType } from '../types'
import { load, save, useI18n } from '../i18n'
import { fmtNum } from '../lib/format'
import { groupRoutes, routePath, type RouteGroup } from '../lib/route'

// Runs at least this long get their own color, like running_page.
const LONG_RUN_KM = 20

function color(g: RouteGroup): string {
  if (g.rep.type === 'run') return g.maxDistance >= LONG_RUN_KM * 1000 ? 'var(--c-run-long)' : 'var(--c-run)'
  if (g.rep.type === 'ride') return 'var(--c-ride)'
  if (g.rep.type === 'hike') return 'var(--c-hike)'
  return 'var(--text-secondary)'
}

/**
 * Every distinct route of the period as a small shape; repeats of the same
 * route are one tile with a count. Clicking a tile shows it on the map.
 */
export function RouteWall({
  activities,
  label,
  onSelect,
}: {
  /** activities with a route, newest first */
  activities: Activity[]
  /** the period shown, for the PNG title */
  label: string
  onSelect: (id: string) => void
}) {
  const { t, lang } = useI18n()
  const [type, setType] = useState<SportType | 'all'>('all')
  const [sort, setSortState] = useState<'time' | 'distance'>(() => (load('wallSort') === 'distance' ? 'distance' : 'time'))
  const setSort = (s: 'time' | 'distance') => {
    setSortState(s)
    save('wallSort', s)
  }

  const types = useMemo(() => [...new Set(activities.map((a) => a.type))], [activities])
  const groups = useMemo(() => {
    const g = groupRoutes(type === 'all' ? activities : activities.filter((a) => a.type === type))
    return sort === 'distance' ? [...g].sort((a, b) => b.maxDistance - a.maxDistance) : g
  }, [activities, type, sort])
  const legend = useMemo(() => {
    const out: { color: string; label: string }[] = []
    const present = new Set(groups.map(color))
    if (present.has('var(--c-run)')) out.push({ color: 'var(--c-run)', label: SPORT_LABEL[lang].run })
    if (present.has('var(--c-run-long)')) out.push({ color: 'var(--c-run-long)', label: `${SPORT_LABEL[lang].run} ≥${LONG_RUN_KM}km` })
    if (present.has('var(--c-ride)')) out.push({ color: 'var(--c-ride)', label: SPORT_LABEL[lang].ride })
    if (present.has('var(--c-hike)')) out.push({ color: 'var(--c-hike)', label: SPORT_LABEL[lang].hike })
    return out
  }, [groups, lang])

  if (activities.length === 0) return null

  return (
    <section className="panel wall">
      <header className="wall-head">
        <h3>{t.routeWall}</h3>
        <div className="wall-tools">
          <div className="chips">
            <button className={type === 'all' ? 'on' : ''} onClick={() => setType('all')}>
              {t.all}
            </button>
            {types.map((k) => (
              <button key={k} className={type === k ? 'on' : ''} onClick={() => setType(k)}>
                {SPORT_LABEL[lang][k]}
              </button>
            ))}
          </div>
          <button className="dl-btn" onClick={() => downloadWall(groups, `${t.routeWall} · ${label}`, lang)} title={t.downloadWall} aria-label={t.downloadWall}>
            <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
              <path d="M12 4v11M7 10l5 5 5-5M5 20h14" />
            </svg>
          </button>
        </div>
      </header>

      <div className="wall-grid">
        {groups.map((g) => {
          const d = routePath(g.rep.polyline!)
          const km = fmtNum(g.maxDistance / 1000, 1)
          return (
            <button
              key={g.rep.id}
              className="wall-tile"
              onClick={() => onSelect(g.rep.id)}
              title={t.wallTip(g.rep.name || SPORT_LABEL[lang][g.rep.type], g.members.length, g.rep.date, km)}
            >
              <svg viewBox="0 0 100 100" aria-hidden>
                {d && <path d={d} style={{ stroke: color(g) }} />}
              </svg>
              {g.members.length > 1 && <span className="wall-count">×{g.members.length}</span>}
            </button>
          )
        })}
      </div>

      <footer className="wall-foot">
        <span className="wall-legend">
          {legend.map((l) => (
            <span key={l.label}>
              <i style={{ background: l.color }} />
              {l.label}
            </span>
          ))}
        </span>
        <span className="wall-meta">
          {t.routesCount(groups.length)}
          <span className="sep">·</span>
          {(['time', 'distance'] as const).map((s) => (
            <button key={s} className={sort === s ? 'on' : ''} onClick={() => setSort(s)}>
              {s === 'time' ? t.sortTime : t.sortDistance}
            </button>
          ))}
        </span>
      </footer>
    </section>
  )
}

/** Renders the wall as a PNG on the current theme's surface. */
async function downloadWall(groups: RouteGroup[], title: string, lang: string) {
  const css = getComputedStyle(document.documentElement)
  const v = (name: string) => css.getPropertyValue(name).trim()
  const resolve = (c: string) => (c.startsWith('var(') ? v(c.slice(4, -1)) : c)
  const cols = Math.min(10, Math.max(1, groups.length))
  const tile = 110
  const head = 56
  const pad = 24
  const rows = Math.ceil(groups.length / cols)
  const w = pad * 2 + cols * tile
  const h = head + pad + rows * tile
  const tiles = groups
    .map((g, i) => {
      const d = routePath(g.rep.polyline!, tile, 14)
      if (!d) return ''
      const x = pad + (i % cols) * tile
      const y = head + Math.floor(i / cols) * tile
      const n = g.members.length > 1 ? `<text x="${tile - 10}" y="${tile - 8}" text-anchor="end" font-size="11" font-weight="600" fill="${v('--text-secondary')}">×${g.members.length}</text>` : ''
      return `<g transform="translate(${x},${y})"><path d="${d}" fill="none" stroke="${resolve(color(g))}" stroke-width="1.6" stroke-linejoin="round" stroke-linecap="round"/>${n}</g>`
    })
    .join('')
  const font = 'system-ui, -apple-system, PingFang SC, sans-serif'
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" font-family="${font}">
<rect width="100%" height="100%" fill="${v('--surface')}"/>
<text x="${pad}" y="${pad + 14}" font-size="17" font-weight="600" fill="${v('--text-primary')}">${title.replace(/&/g, '&amp;').replace(/</g, '&lt;')}</text>
<text x="${pad}" y="${pad + 34}" font-size="12" fill="${v('--text-muted')}">${lang === 'zh' ? `${groups.length} 条路线` : `${groups.length} routes`}</text>
${tiles}</svg>`
  const url = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml' }))
  const img = new Image()
  img.src = url
  await img.decode()
  URL.revokeObjectURL(url)
  const canvas = document.createElement('canvas')
  canvas.width = w * 2
  canvas.height = h * 2
  const ctx = canvas.getContext('2d')!
  ctx.scale(2, 2)
  ctx.drawImage(img, 0, 0)
  const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, 'image/png'))
  if (!blob) return
  const a = document.createElement('a')
  a.href = URL.createObjectURL(blob)
  a.download = 'lifelog-route-wall.png'
  a.click()
  setTimeout(() => URL.revokeObjectURL(a.href), 1000)
}
