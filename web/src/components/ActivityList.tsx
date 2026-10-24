import { useMemo, useState } from 'react'
import { SPORT_LABEL, type Activity, type SportType } from '../types'
import { fmtDuration, fmtNum, fmtSpeed } from '../lib/format'
import { decodePolyline } from '../lib/polyline'

const PAGE = 24

export function ActivityList({ activities }: { activities: Activity[] }) {
  const [filter, setFilter] = useState<SportType | 'all'>('all')
  const [shown, setShown] = useState(PAGE)

  const types = useMemo(() => {
    const counts = new Map<SportType, number>()
    for (const a of activities) counts.set(a.type, (counts.get(a.type) ?? 0) + 1)
    return [...counts.entries()].sort((a, b) => b[1] - a[1])
  }, [activities])

  const list = filter === 'all' ? activities : activities.filter((a) => a.type === filter)

  return (
    <section className="activities">
      <div className="activities-head">
        <h2>运动记录</h2>
        <div className="chips" role="tablist">
          <button className={filter === 'all' ? 'on' : ''} onClick={() => setFilter('all')}>
            全部 {activities.length}
          </button>
          {types.map(([t, n]) => (
            <button key={t} className={filter === t ? 'on' : ''} onClick={() => setFilter(t)}>
              {SPORT_LABEL[t]} {n}
            </button>
          ))}
        </div>
      </div>
      {list.length === 0 && <p className="empty">这一年还没有运动记录。</p>}
      <ul className="cards">
        {list.slice(0, shown).map((a) => (
          <li key={a.id} className="card">
            <Route polyline={a.polyline} type={a.type} />
            <div className="card-body">
              <div className="card-title">
                <span className={`tag tag-${a.type}`}>{SPORT_LABEL[a.type]}</span>
                <span className="name">{a.name || SPORT_LABEL[a.type]}</span>
              </div>
              <div className="card-meta">
                {a.start_local} · {a.source}
              </div>
              <div className="card-nums">
                {a.distance_m > 0 && (
                  <span>
                    <b>{fmtNum(a.distance_m / 1000, 2)}</b> km
                  </span>
                )}
                <span>{fmtDuration(a.moving_time_s)}</span>
                {fmtSpeed(a) && <span>{fmtSpeed(a)}</span>}
                {!!a.elevation_gain_m && <span>↑{Math.round(a.elevation_gain_m)} m</span>}
                {!!a.avg_hr && <span>♥ {Math.round(a.avg_hr)}</span>}
              </div>
            </div>
          </li>
        ))}
      </ul>
      {shown < list.length && (
        <button className="more" onClick={() => setShown(shown + PAGE)}>
          加载更多(还有 {list.length - shown} 条)
        </button>
      )}
    </section>
  )
}

/** Route thumbnail drawn straight from the polyline — no map tiles needed. */
function Route({ polyline, type }: { polyline?: string; type: SportType }) {
  const d = useMemo(() => {
    if (!polyline) return null
    const pts = decodePolyline(polyline)
    if (pts.length < 2) return null
    const lats = pts.map((p) => p[0])
    const lngs = pts.map((p) => p[1])
    const minLat = Math.min(...lats)
    const maxLat = Math.max(...lats)
    const minLng = Math.min(...lngs)
    const maxLng = Math.max(...lngs)
    // rough equirectangular correction so routes aren't stretched east-west
    const kx = Math.cos(((minLat + maxLat) / 2) * (Math.PI / 180))
    const w = (maxLng - minLng) * kx || 1e-6
    const h = maxLat - minLat || 1e-6
    const s = 84 / Math.max(w, h)
    const ox = (100 - w * s) / 2
    const oy = (100 - h * s) / 2
    return pts
      .map(([la, ln], i) => `${i ? 'L' : 'M'}${(ox + (ln - minLng) * kx * s).toFixed(1)},${(oy + (maxLat - la) * s).toFixed(1)}`)
      .join('')
  }, [polyline])

  return (
    <svg className={`route route-${type}`} viewBox="0 0 100 100" aria-hidden>
      {d ? <path d={d} /> : <text x="50" y="56">{SPORT_LABEL[type]}</text>}
    </svg>
  )
}
