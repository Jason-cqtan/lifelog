import { useEffect, useMemo, useRef, useState } from 'react'
import { SPORT_LABEL, type Activity, type Drill, type SportType, type Weather } from '../types'
import { fmtCadence, fmtDuration, fmtNum, fmtSpeed } from '../lib/format'
import { decodePolyline } from '../lib/polyline'
import { load, save, useI18n, type Dict, type Lang } from '../i18n'
import { weatherLabel, windLabel } from '../lib/weather'
import { MonthCalendar } from './MonthCalendar'
import { ActivitySummary } from './ActivitySummary'

const PAGE = 24
// quick "at least N km" filters
const MIN_KM = [10, 15, 20, 30, 50]

type View = 'cards' | 'table'
type SortKey = 'date' | 'distance' | 'time' | 'pace' | 'elev' | 'hr' | 'cadence'

// Values a column sorts by; pace sorts as seconds per km, so rides sort by speed too.
const SORT: Record<SortKey, (a: Activity) => number> = {
  date: (a) => Date.parse(a.start_local.replace(' ', 'T')),
  distance: (a) => a.distance_m,
  time: (a) => a.moving_time_s,
  pace: (a) => (a.distance_m > 0 ? a.moving_time_s / a.distance_m : Infinity),
  elev: (a) => a.elevation_gain_m ?? 0,
  hr: (a) => a.avg_hr ?? 0,
  cadence: (a) => a.avg_cadence ?? 0,
}

export function ActivityList({
  activities,
  year,
  focus,
  drill,
  onShowMap,
}: {
  activities: Activity[]
  /** the selected year; the month calendar is hidden for 'all' */
  year: number | 'all'
  focus: { id: string; seq: number } | null
  /** from a heatmap click: show that sport in that day or month */
  drill: Drill | null
  onShowMap: (id: string) => void
}) {
  const { lang, t } = useI18n()
  const sport = SPORT_LABEL[lang]
  const [filter, setFilter] = useState<SportType | 'all'>('all')
  // 'YYYY-MM' or 'YYYY-MM-DD' prefix of activity dates, set by a heatmap drill-down
  const [period, setPeriod] = useState<string | null>(null)
  const [minKm, setMinKm] = useState<number | null>(null)
  const [shown, setShown] = useState(PAGE)
  const [view, setViewState] = useState<View>(() => (load('activityView') === 'table' ? 'table' : 'cards'))
  const setView = (v: View) => {
    setViewState(v)
    save('activityView', v)
  }
  // table sort; the default (date, newest first) matches the card order
  const [sort, setSort] = useState<{ key: SortKey; desc: boolean }>({ key: 'date', desc: true })

  const inPeriod = useMemo(
    () =>
      activities.filter(
        (a) => (!period || a.date.startsWith(period)) && (minKm === null || a.distance_m >= minKm * 1000),
      ),
    [activities, period, minKm],
  )
  const types = useMemo(() => {
    const counts = new Map<SportType, number>()
    for (const a of inPeriod) counts.set(a.type, (counts.get(a.type) ?? 0) + 1)
    return [...counts.entries()].sort((a, b) => b[1] - a[1])
  }, [inPeriod])

  const list = useMemo(() => {
    const filtered = filter === 'all' ? inPeriod : inPeriod.filter((a) => a.type === filter)
    if (view === 'cards' || (sort.key === 'date' && sort.desc)) return filtered
    const f = SORT[sort.key]
    return [...filtered].sort((a, b) => (sort.desc ? f(b) - f(a) : f(a) - f(b)))
  }, [inPeriod, filter, view, sort])

  // Jump to a picked activity: reset filter and sort, widen the page so its row
  // exists, then scroll to it and flash it.
  const [flash, setFlash] = useState<{ id: string; seq: number } | null>(null)
  useEffect(() => {
    if (!focus) return
    const idx = activities.findIndex((a) => a.id === focus.id)
    if (idx < 0) return
    setFilter('all')
    setPeriod(null)
    setMinKm(null)
    setSort({ key: 'date', desc: true })
    setShown((n) => Math.max(n, Math.ceil((idx + 1) / PAGE) * PAGE))
    setFlash(focus)
    const timer = setTimeout(() => setFlash(null), 2400)
    return () => clearTimeout(timer)
  }, [focus, activities])
  // Heatmap drill-down: narrow to that sport and period, then bring the list into
  // view and flash every match.
  const [flashAll, setFlashAll] = useState(false)
  const head = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!drill) return
    setFilter(drill.type)
    setPeriod(drill.period)
    setMinKm(null)
    setSort({ key: 'date', desc: true })
    setShown(PAGE)
    setFlashAll(true)
    requestAnimationFrame(() => head.current?.scrollIntoView({ block: 'start' }))
    const timer = setTimeout(() => setFlashAll(false), 2400)
    return () => clearTimeout(timer)
  }, [drill])

  // Runs after the render that added the item, so the element exists. Long jumps
  // are instant (the flash shows where you landed); short ones scroll smoothly.
  useEffect(() => {
    if (!flash) return
    const el = document.getElementById(`act-${flash.id}`)
    if (!el) return
    const far = Math.abs(el.getBoundingClientRect().top) > window.innerHeight * 2
    el.scrollIntoView({ behavior: far ? 'auto' : 'smooth', block: 'center' })
  }, [flash])

  // the calendar shows the whole month: sport and distance filters, not the date one
  const calActs = useMemo(
    () =>
      activities.filter(
        (a) => (filter === 'all' || a.type === filter) && (minKm === null || a.distance_m >= minKm * 1000),
      ),
    [activities, filter, minKm],
  )
  const pickPeriod = (p: string | null) => {
    setPeriod(p)
    setShown(PAGE)
  }

  const page = list.slice(0, shown)
  const isFlash = (a: Activity) => a.id === flash?.id || (flashAll && !!period)

  return (
    <section className="activities">
      <div className="activities-head" ref={head}>
        <div className="chips" role="tablist">
          {period && (
            <button className="period-chip" onClick={() => setPeriod(null)} title={t.clearPeriod} aria-label={t.clearPeriod}>
              {t.periodChip(period, filter === 'all' ? t.all : sport[filter])} ✕
            </button>
          )}
          <button className={filter === 'all' ? 'on' : ''} onClick={() => setFilter('all')}>
            {t.all} {inPeriod.length}
          </button>
          {types.map(([type, n]) => (
            <button key={type} className={filter === type ? 'on' : ''} onClick={() => setFilter(type)}>
              {sport[type]} {n}
            </button>
          ))}
        </div>
        <div className="chips km-chips" role="group" aria-label={t.minDistance}>
          {MIN_KM.map((k) => {
            const n = activities.filter((a) => (!period || a.date.startsWith(period)) && a.distance_m >= k * 1000).length
            return (
              <button
                key={k}
                className={minKm === k ? 'on' : ''}
                aria-pressed={minKm === k}
                disabled={n === 0 && minKm !== k}
                onClick={() => setMinKm(minKm === k ? null : k)}
                title={t.kmPlusTitle(k, n)}
              >
                {k}KM+
              </button>
            )
          })}
        </div>
      </div>

      {/* summary sits above the details, like running_page */}
      <div className={year === 'all' ? 'act-top single' : 'act-top'}>
        {year !== 'all' && <MonthCalendar year={year} activities={calActs} selected={period} onPick={pickPeriod} />}
        <ActivitySummary list={list} base={calActs} year={year} period={period} onPick={pickPeriod} />
      </div>

      {/* the view switch belongs to the list it changes, not to the summary above */}
      <div className="list-head">
        <h3>
          {t.details} <span>{t.itemsCount(list.length)}</span>
        </h3>
          <div className="seg" role="group">
          {(['cards', 'table'] as const).map((v) => (
            <button key={v} className={view === v ? 'on' : ''} aria-pressed={view === v} onClick={() => setView(v)}>
              {v === 'cards' ? <CardsIcon /> : <TableIcon />}
              {v === 'cards' ? t.viewCards : t.viewTable}
            </button>
          ))}
          </div>
      </div>

      {view === 'cards' ? (
        <ul className="cards">
          {page.map((a) => (
            <li key={a.id} id={`act-${a.id}`} className={isFlash(a) ? 'card flash' : 'card'}>
              {a.polyline ? (
                <button className="route-btn" onClick={() => onShowMap(a.id)} title={t.showOnMap} aria-label={t.showOnMap}>
                  <Route polyline={a.polyline} type={a.type} label={sport[a.type]} />
                </button>
              ) : (
                <Route polyline={a.polyline} type={a.type} label={sport[a.type]} />
              )}
              <div className="card-body">
                <div className="card-title">
                  <span className={`tag tag-${a.type}`}>{sport[a.type]}</span>
                  <span className="name">{a.name || sport[a.type]}</span>
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
                  <span>{fmtDuration(a.moving_time_s, t)}</span>
                  {fmtSpeed(a) && <span>{fmtSpeed(a)}</span>}
                  {!!a.elevation_gain_m && <span>↑{Math.round(a.elevation_gain_m)} m</span>}
                  {!!a.avg_hr && <span>♥ {Math.round(a.avg_hr)}</span>}
                  {fmtCadence(a) && <span title={a.stride_m ? t.strideTip(a.stride_m.toFixed(2)) : undefined}>{fmtCadence(a)}</span>}
                </div>
                {a.weather && <WeatherLine w={a.weather} lang={lang} t={t} />}
              </div>
            </li>
          ))}
        </ul>
      ) : (
        <div className="table-scroll">
          <table className="act-table">
            <thead>
              <tr>
                <SortTh k="date" label={t.cols.date} sort={sort} setSort={setSort} t={t} />
                <th>{t.cols.type}</th>
                <th>{t.cols.name}</th>
                <SortTh k="distance" label={t.cols.distance} sort={sort} setSort={setSort} t={t} num />
                <SortTh k="time" label={t.cols.time} sort={sort} setSort={setSort} t={t} num />
                <SortTh k="pace" label={t.cols.pace} sort={sort} setSort={setSort} t={t} num />
                <SortTh k="elev" label={t.cols.elev} sort={sort} setSort={setSort} t={t} num />
                <SortTh k="hr" label={t.cols.hr} sort={sort} setSort={setSort} t={t} num />
                <SortTh k="cadence" label={t.cols.cadence} sort={sort} setSort={setSort} t={t} num />
                <th>{t.cols.weather}</th>
                <th>{t.cols.source}</th>
                <th aria-label={t.showOnMap} />
              </tr>
            </thead>
            <tbody>
              {page.map((a) => {
                const w = a.weather && weatherLabel(a.weather.desc, lang)
                return (
                  <tr key={a.id} id={`act-${a.id}`} className={isFlash(a) ? 'flash' : undefined}>
                    <td className="nowrap">{a.start_local}</td>
                    <td>
                      <span className={`tag tag-${a.type}`}>{sport[a.type]}</span>
                    </td>
                    <td className="name-cell">{a.name || sport[a.type]}</td>
                    <td className="num">{a.distance_m > 0 ? `${fmtNum(a.distance_m / 1000, 2)} km` : '—'}</td>
                    <td className="num">{fmtDuration(a.moving_time_s, t)}</td>
                    <td className="num">{fmtSpeed(a) ?? '—'}</td>
                    <td className="num">{a.elevation_gain_m ? `${Math.round(a.elevation_gain_m)} m` : '—'}</td>
                    <td className="num">{a.avg_hr ? Math.round(a.avg_hr) : '—'}</td>
                    <td className="num" title={a.stride_m ? t.strideTip(a.stride_m.toFixed(2)) : undefined}>
                      {a.avg_cadence ? Math.round(a.avg_cadence) : '—'}
                    </td>
                    <td className="nowrap">
                      {a.weather && w ? (
                        <span title={w.text || undefined}>
                          {w.icon} {Math.round(a.weather.temp_c)}°C
                        </span>
                      ) : (
                        '—'
                      )}
                    </td>
                    <td className="muted">{a.source}</td>
                    <td>
                      {a.polyline && (
                        <button className="map-link" onClick={() => onShowMap(a.id)} title={t.showOnMap} aria-label={t.showOnMap}>
                          <MapIcon />
                        </button>
                      )}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      {shown < list.length && (
        <button className="more" onClick={() => setShown(shown + PAGE)}>
          {t.loadMore(list.length - shown)}
        </button>
      )}
    </section>
  )
}

function SortTh({
  k,
  label,
  sort,
  setSort,
  t,
  num,
}: {
  k: SortKey
  label: string
  sort: { key: SortKey; desc: boolean }
  setSort: (s: { key: SortKey; desc: boolean }) => void
  t: Dict
  num?: boolean
}) {
  const active = sort.key === k
  return (
    <th className={num ? 'num' : undefined} aria-sort={active ? (sort.desc ? 'descending' : 'ascending') : 'none'}>
      <button
        className={active ? 'sort on' : 'sort'}
        title={t.sortBy(label)}
        // first click sorts the "best/biggest" end: newest, longest… fastest pace is ascending
        onClick={() => setSort({ key: k, desc: active ? !sort.desc : k !== 'pace' })}
      >
        {label}
        <span aria-hidden>{active ? (sort.desc ? ' ↓' : ' ↑') : ''}</span>
      </button>
    </th>
  )
}

export function WeatherLine({ w, lang, t }: { w: Weather; lang: Lang; t: Dict }) {
  const { icon, text } = weatherLabel(w.desc, lang)
  const deg = (c: number) => `${Math.round(c)}°C`
  return (
    <div className="card-weather">
      <span>
        <span aria-hidden>{icon}</span> {text && `${text} `}
        <b>{deg(w.temp_c)}</b>
      </span>
      {Math.round(w.feels_like_c) !== Math.round(w.temp_c) && <span>{t.feelsLike(deg(w.feels_like_c))}</span>}
      <span>{t.humidity(Math.round(w.humidity))}</span>
      <span>{windLabel(w.wind_dir, w.wind_ms, lang)}</span>
    </div>
  )
}

/** Route thumbnail drawn straight from the polyline — no map tiles needed. */
function Route({ polyline, type, label }: { polyline?: string; type: SportType; label: string }) {
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
      {d ? <path d={d} /> : <text x="50" y="56">{label}</text>}
    </svg>
  )
}

const iconProps = {
  viewBox: '0 0 24 24',
  width: 15,
  height: 15,
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 2,
  strokeLinecap: 'round',
  strokeLinejoin: 'round',
  'aria-hidden': true,
} as const

function CardsIcon() {
  return (
    <svg {...iconProps}>
      <rect x="3" y="3" width="7" height="7" rx="1.5" />
      <rect x="14" y="3" width="7" height="7" rx="1.5" />
      <rect x="3" y="14" width="7" height="7" rx="1.5" />
      <rect x="14" y="14" width="7" height="7" rx="1.5" />
    </svg>
  )
}

function TableIcon() {
  return (
    <svg {...iconProps}>
      <rect x="3" y="4" width="18" height="16" rx="2" />
      <path d="M3 10h18M3 15h18M9 4v16" />
    </svg>
  )
}

function MapIcon() {
  return (
    <svg {...iconProps}>
      <path d="M9 4 3 6v14l6-2 6 2 6-2V4l-6 2-6-2zM9 4v14M15 6v14" />
    </svg>
  )
}
