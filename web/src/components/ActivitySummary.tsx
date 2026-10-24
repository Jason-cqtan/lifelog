import { useMemo } from 'react'
import type { Activity } from '../types'
import { useI18n } from '../i18n'
import { fmtDuration, fmtNum, fmtPace } from '../lib/format'

interface Totals {
  count: number
  meters: number
  secs: number
  elev: number
  hr: number | null
  longest: number
}

function totals(list: Activity[]): Totals {
  let meters = 0
  let secs = 0
  let elev = 0
  let hrSecs = 0
  let hrSum = 0
  let longest = 0
  for (const a of list) {
    meters += a.distance_m
    secs += a.moving_time_s
    elev += a.elevation_gain_m ?? 0
    longest = Math.max(longest, a.distance_m)
    if (a.avg_hr) {
      hrSecs += a.moving_time_s
      hrSum += a.avg_hr * a.moving_time_s
    }
  }
  return { count: list.length, meters, secs, elev, hr: hrSecs ? Math.round(hrSum / hrSecs) : null, longest }
}

/** Pace for foot sports, speed for rides; nothing when sports are mixed. */
function speed(list: Activity[], tt: Totals): string {
  const types = new Set(list.map((a) => a.type))
  if (!tt.meters || !tt.secs || types.size !== 1) return '—'
  return types.has('ride') ? `${(tt.meters / 1000 / (tt.secs / 3600)).toFixed(1)} km/h` : fmtPace(tt.secs / (tt.meters / 1000))
}

/**
 * Totals for what the list currently shows, plus a by-month (one year) or
 * by-year (all years) table whose rows filter the list to that period.
 */
export function ActivitySummary({
  list,
  year,
  period,
  onPick,
}: {
  /** the list after all its filters */
  list: Activity[]
  year: number | 'all'
  period: string | null
  onPick: (prefix: string | null) => void
}) {
  const { t, lang } = useI18n()
  const all = useMemo(() => totals(list), [list])
  const rows = useMemo(() => {
    const keyOf = (a: Activity) => (year === 'all' ? a.date.slice(0, 4) : a.date.slice(0, 7))
    const groups = new Map<string, Activity[]>()
    for (const a of list) groups.set(keyOf(a), [...(groups.get(keyOf(a)) ?? []), a])
    return [...groups.entries()].sort((a, b) => b[0].localeCompare(a[0])).map(([k, acts]) => ({ k, acts, tt: totals(acts) }))
  }, [list, year])
  const label = (k: string) => (year === 'all' ? k : lang === 'zh' ? `${Number(k.slice(5))}月` : t.months[Number(k.slice(5)) - 1])

  return (
    <section className="panel summary">
      <h3>{t.summary}</h3>
      <dl className="sum-grid">
        <Stat label={t.count} value={fmtNum(all.count, 0)} />
        <Stat label={t.cols.distance} value={`${fmtNum(all.meters / 1000)} km`} />
        <Stat label={t.totalTime} value={fmtDuration(all.secs, t)} />
        <Stat label={t.cols.pace} value={speed(list, all)} />
        <Stat label={t.avgHr} value={all.hr ? `♥ ${all.hr}` : '—'} />
        <Stat label={t.totalElev} value={all.elev ? `${fmtNum(all.elev, 0)} m` : '—'} />
        <Stat label={t.longestDist} value={all.longest ? `${fmtNum(all.longest / 1000, 2)} km` : '—'} />
      </dl>
      {rows.length > 1 && (
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
            {rows.map(({ k, acts, tt }) => (
              <tr
                key={k}
                className={period === k ? 'on' : undefined}
                onClick={() => onPick(period === k ? null : k)}
                title={t.sumRowHint(label(k), speed(acts, tt))}
              >
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

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt>{label}</dt>
      <dd>{value}</dd>
    </div>
  )
}
