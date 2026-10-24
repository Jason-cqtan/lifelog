import { useCallback, useMemo, useState, type MouseEvent } from 'react'
import type { Activity } from '../types'
import { load, save, useI18n } from '../i18n'
import { fmtDuration, fmtNum, fmtPace } from '../lib/format'
import { Tooltip, toViewport } from './heat'

interface Totals {
  count: number
  meters: number
  secs: number
  elev: number
  hr: number | null
  cadence: number | null
  longest: number
}

function totals(list: Activity[]): Totals {
  let meters = 0
  let secs = 0
  let elev = 0
  let hrSecs = 0
  let hrSum = 0
  let longest = 0
  let cadSecs = 0
  let cadSum = 0
  for (const a of list) {
    meters += a.distance_m
    secs += a.moving_time_s
    elev += a.elevation_gain_m ?? 0
    longest = Math.max(longest, a.distance_m)
    if (a.avg_hr) {
      hrSecs += a.moving_time_s
      hrSum += a.avg_hr * a.moving_time_s
    }
    if (a.avg_cadence) {
      cadSecs += a.moving_time_s
      cadSum += a.avg_cadence * a.moving_time_s
    }
  }
  return {
    count: list.length,
    meters,
    secs,
    elev,
    hr: hrSecs ? Math.round(hrSum / hrSecs) : null,
    // time-weighted, over activities that recorded it
    cadence: cadSecs ? Math.round(cadSum / cadSecs) : null,
    longest,
  }
}

const single = (list: Activity[]) => {
  const types = new Set(list.map((a) => a.type))
  return types.size === 1 ? [...types][0] : null
}

/** Pace for foot sports, speed for rides; nothing when sports are mixed. */
function speed(list: Activity[], tt: Totals): string {
  const type = single(list)
  if (!tt.meters || !tt.secs || !type) return '—'
  return type === 'ride' ? `${(tt.meters / 1000 / (tt.secs / 3600)).toFixed(1)} km/h` : fmtPace(tt.secs / (tt.meters / 1000))
}

/** Best average pace (or speed) of a single activity of at least 1 km. */
function fastest(list: Activity[]): string {
  const type = single(list)
  const ok = list.filter((a) => a.distance_m >= 1000 && a.moving_time_s > 0)
  if (!type || ok.length === 0) return '—'
  const secPerKm = Math.min(...ok.map((a) => a.moving_time_s / (a.distance_m / 1000)))
  return type === 'ride' ? `${(3600 / secPerKm).toFixed(1)} km/h` : fmtPace(secPerKm)
}

const COLOR: Record<string, string> = { ride: 'var(--c-ride)', hike: 'var(--c-hike)' }

/**
 * Totals for what the list currently shows, plus a by-month (one year) or
 * by-year (all years) chart or table whose bars / rows filter the list.
 */
export function ActivitySummary({
  list,
  base,
  year,
  period,
  onPick,
}: {
  /** the list after all its filters (the stats) */
  list: Activity[]
  /** the list before the date filter (the chart and table) */
  base: Activity[]
  year: number | 'all'
  period: string | null
  onPick: (prefix: string | null) => void
}) {
  const { t, lang } = useI18n()
  const [view, setViewState] = useState<'chart' | 'table'>(() => (load('summaryView') === 'table' ? 'table' : 'chart'))
  const setView = (v: 'chart' | 'table') => {
    setViewState(v)
    save('summaryView', v)
  }
  const all = useMemo(() => totals(list), [list])

  // every month of the year (or every year from the first to the last), oldest first
  const buckets = useMemo(() => {
    const keyOf = (a: Activity) => (year === 'all' ? a.date.slice(0, 4) : a.date.slice(0, 7))
    const groups = new Map<string, Activity[]>()
    for (const a of base) groups.set(keyOf(a), [...(groups.get(keyOf(a)) ?? []), a])
    let keys: string[]
    if (year === 'all') {
      const ys = [...groups.keys()].map(Number).sort((a, b) => a - b)
      keys = ys.length ? Array.from({ length: ys[ys.length - 1] - ys[0] + 1 }, (_, i) => String(ys[0] + i)) : []
    } else {
      keys = Array.from({ length: 12 }, (_, i) => `${year}-${String(i + 1).padStart(2, '0')}`)
    }
    return keys.map((k) => ({ k, acts: groups.get(k) ?? [], tt: totals(groups.get(k) ?? []) }))
  }, [base, year])

  const label = (k: string) => (year === 'all' ? k : lang === 'zh' ? `${Number(k.slice(5))}月` : t.months[Number(k.slice(5)) - 1])
  const color = COLOR[single(base) ?? ''] ?? 'var(--c-run)'
  const pick = (k: string) => onPick(period === k ? null : k)

  return (
    <section className="panel summary">
      <header className="sum-head">
        <h3>{period ? (period.length === 10 ? period : label(period)) : year === 'all' ? t.allHistory : String(year)}</h3>
        <div className="sum-head-right">
          <span className="sum-total" style={{ color }}>
            {fmtNum(all.meters / 1000, 2)} <small>km</small>
          </span>
          <div className="seg seg-sm" role="group">
            {(['chart', 'table'] as const).map((v) => (
              <button key={v} className={view === v ? 'on' : ''} aria-pressed={view === v} onClick={() => setView(v)}>
                {v === 'chart' ? t.viewChart : t.viewTable}
              </button>
            ))}
          </div>
        </div>
      </header>
      <dl className="sum-grid">
        <Stat label={t.count} value={fmtNum(all.count, 0)} />
        <Stat label={t.totalTime} value={fmtDuration(all.secs, t)} />
        <Stat label={t.cols.pace} value={speed(list, all)} />
        <Stat label={t.avgHr} value={all.hr ? `♥ ${all.hr}` : '—'} />
        <Stat label={t.longestDist} value={all.longest ? `${fmtNum(all.longest / 1000, 2)} km` : '—'} />
        <Stat label={t.fastestPace} value={fastest(list)} />
        <Stat label={t.avgDist} value={all.count ? `${fmtNum(all.meters / 1000 / all.count, 2)} km` : '—'} />
        <Stat label={t.totalElev} value={all.elev ? `${fmtNum(all.elev, 0)} m` : '—'} />
        <Stat
          label={t.avgCadence}
          value={all.cadence && single(list) ? `${all.cadence} ${single(list) === 'ride' ? 'rpm' : 'spm'}` : '—'}
        />
      </dl>

      {view === 'chart' ? (
        <BarChart buckets={buckets} color={color} period={period} label={label} unit={year === 'all' ? t.unitYearKm : t.unitMonthKm} shortLabel={(k) => (year === 'all' ? k : k.slice(5))} onPick={pick} />
      ) : (
        <table className="rank sum-table">
          <thead>
            <tr>
              <th>{year === 'all' ? t.yearCol : t.monthCol}</th>
              <th className="num">{t.count}</th>
              <th className="num">{t.cols.distance}</th>
              <th className="num">{t.totalTime}</th>
              <th className="num">{t.avgHr}</th>
            </tr>
          </thead>
          <tbody>
            {[...buckets].reverse().filter((b) => b.tt.count > 0).map(({ k, acts, tt }) => (
              <tr key={k} className={period === k ? 'on' : undefined} onClick={() => pick(k)} title={t.sumRowHint(label(k), speed(acts, tt))}>
                <td>{label(k)}</td>
                <td className="num">{tt.count}</td>
                <td className="num">{fmtNum(tt.meters / 1000)} km</td>
                <td className="num">{fmtDuration(tt.secs, t)}</td>
                <td className="num">{tt.hr ?? '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  )
}

const W = 640
const H = 210
const PAD_L = 40
const PAD_R = 8
const PAD_T = 10
const PAD_B = 24

/** 0 plus 4 evenly spaced "nice" ticks covering max. */
function ticks(max: number): number[] {
  if (max <= 0) return [0]
  const raw = max / 4
  const mag = 10 ** Math.floor(Math.log10(raw))
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= raw)!
  return [0, 1, 2, 3, 4].map((i) => +(i * step).toFixed(6))
}

/** Bar with a rounded top and a flat base on the axis. */
function bar(x: number, y: number, w: number, h: number): string {
  const r = Math.min(4, w / 2, h)
  return `M${x},${y + h}V${y + r}Q${x},${y} ${x + r},${y}H${x + w - r}Q${x + w},${y} ${x + w},${y + r}V${y + h}Z`
}

function BarChart({
  buckets,
  color,
  period,
  label,
  shortLabel,
  unit,
  onPick,
}: {
  buckets: { k: string; acts: Activity[]; tt: Totals }[]
  color: string
  period: string | null
  label: (k: string) => string
  shortLabel: (k: string) => string
  unit: string
  onPick: (k: string) => void
}) {
  const { t } = useI18n()
  const [tip, setTip] = useState<{ i: number; x: number; y: number } | null>(null)
  const clearTip = useCallback(() => setTip(null), [])
  const km = buckets.map((b) => b.tt.meters / 1000)
  const ys = ticks(Math.max(0, ...km))
  const top = ys[ys.length - 1] || 1
  const plotW = W - PAD_L - PAD_R
  const plotH = H - PAD_T - PAD_B
  const slot = plotW / Math.max(1, buckets.length)
  const bw = Math.min(40, slot * 0.56)
  const yOf = (v: number) => PAD_T + plotH * (1 - v / top)
  // a picked day or month highlights the bar that contains it
  const selected = period && buckets.length ? period.slice(0, buckets[0].k.length) : null

  const indexAt = (e: MouseEvent<SVGSVGElement>) => {
    const r = e.currentTarget.getBoundingClientRect()
    const x = ((e.clientX - r.left) / r.width) * W - PAD_L
    const i = Math.floor(x / slot)
    return i >= 0 && i < buckets.length ? i : -1
  }

  return (
    <div className="sum-chart">
      <svg
        viewBox={`0 0 ${W} ${H}`}
        role="img"
        aria-label={unit}
        onMouseMove={(e) => {
          const i = indexAt(e)
          if (i < 0) return setTip(null)
          setTip({ i, ...toViewport(e.currentTarget, W, PAD_L + slot * i + slot / 2, yOf(km[i])) })
        }}
        onMouseLeave={clearTip}
        onClick={(e) => {
          const i = indexAt(e)
          if (i >= 0 && buckets[i].tt.count > 0) onPick(buckets[i].k)
        }}
        style={{ cursor: tip && buckets[tip.i].tt.count > 0 ? 'pointer' : undefined }}
      >
        {ys.map((v) => (
          <g key={v}>
            <line x1={PAD_L} x2={W - PAD_R} y1={yOf(v)} y2={yOf(v)} className={v === 0 ? 'chart-base' : 'chart-grid'} />
            <text x={PAD_L - 8} y={yOf(v) + 4} textAnchor="end" className="axis-label">
              {fmtNum(v, 1)}
            </text>
          </g>
        ))}
        {buckets.map((b, i) => {
          const x = PAD_L + slot * i + (slot - bw) / 2
          const h = plotH * (km[i] / top)
          const dim = selected !== null && b.k !== selected
          return (
            <g key={b.k}>
              {h > 0 && <path d={bar(x, yOf(km[i]), bw, Math.max(h, 1.5))} fill={color} opacity={dim ? 0.35 : tip?.i === i ? 0.85 : 1} />}
              <text x={PAD_L + slot * i + slot / 2} y={H - 6} textAnchor="middle" className="axis-label">
                {shortLabel(b.k)}
              </text>
            </g>
          )
        })}
      </svg>
      <div className="chart-unit">{unit}</div>
      {tip && (
        <Tooltip x={tip.x} y={tip.y} onScroll={clearTip}>
          <strong>{fmtNum(km[tip.i], 1)} km</strong>
          <span>
            {label(buckets[tip.i].k)} · {t.barTip(buckets[tip.i].tt.count, fmtDuration(buckets[tip.i].tt.secs, t))}
          </span>
        </Tooltip>
      )}
    </div>
  )
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt>{label}</dt>
      <dd>{value}</dd>
    </div>
  )
}
