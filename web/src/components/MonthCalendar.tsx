import { useEffect, useMemo, useState } from 'react'
import { CATEGORIES, SPORT_LABEL, type Activity } from '../types'
import { useI18n } from '../i18n'
import { fmtNum } from '../lib/format'

const COLOR: Record<string, string> = Object.fromEntries(CATEGORIES.filter((c) => c.sport).map((c) => [c.sport!, c.color]))
const pad = (n: number) => String(n).padStart(2, '0')

/**
 * One month of the selected year. Days with activities show their distance in
 * the color of that day's main sport; clicking one filters the list to it.
 */
export function MonthCalendar({
  year,
  activities,
  selected,
  onPick,
}: {
  year: number
  /** activities after the list's sport / distance filters, newest first */
  activities: Activity[]
  /** 'YYYY-MM-DD' when the list is filtered to a day */
  selected: string | null
  onPick: (date: string | null) => void
}) {
  const { t, lang } = useI18n()
  const now = new Date()
  const latestMonth = useMemo(() => {
    const a = activities.find((x) => x.date.startsWith(String(year)))
    return a ? Number(a.date.slice(5, 7)) - 1 : year === now.getFullYear() ? now.getMonth() : 11
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activities, year])
  const [month, setMonth] = useState(latestMonth)
  // a new year starts on its latest month with activity
  useEffect(() => setMonth(latestMonth), [year]) // eslint-disable-line react-hooks/exhaustive-deps
  // follow a day or month picked elsewhere (e.g. the summary table)
  useEffect(() => {
    if (selected && selected.length >= 7 && selected.startsWith(String(year))) setMonth(Number(selected.slice(5, 7)) - 1)
  }, [selected, year])

  const prefix = `${year}-${pad(month + 1)}`
  const days = useMemo(() => {
    const byDay = new Map<string, Activity[]>()
    for (const a of activities) {
      if (!a.date.startsWith(prefix)) continue
      byDay.set(a.date, [...(byDay.get(a.date) ?? []), a])
    }
    return byDay
  }, [activities, prefix])
  const monthActs = [...days.values()].flat()
  const monthKm = monthActs.reduce((s, a) => s + a.distance_m, 0) / 1000

  const first = new Date(year, month, 1)
  const lead = (first.getDay() + 6) % 7 // Monday-first
  const count = new Date(year, month + 1, 0).getDate()
  const cells: (number | null)[] = [...Array(lead).fill(null), ...Array.from({ length: count }, (_, i) => i + 1)]
  const isThisYear = year === now.getFullYear()
  const title = lang === 'zh' ? `${year}年${month + 1}月` : first.toLocaleDateString('en-US', { year: 'numeric', month: 'long' })

  return (
    <section className="panel cal">
      <header className="cal-head">
        <h3>{title}</h3>
        <div className="cal-nav">
          <button onClick={() => setMonth(month - 1)} disabled={month === 0} aria-label={t.prevMonth}>
            ←
          </button>
          <button onClick={() => setMonth(month + 1)} disabled={month === 11} aria-label={t.nextMonth}>
            →
          </button>
        </div>
      </header>
      <div className="cal-sub">
        <span>{t.calSummary(monthActs.length, fmtNum(monthKm))}</span>
        <span className="cal-jump">
          {isThisYear && (
            <button onClick={() => setMonth(now.getMonth())} disabled={month === now.getMonth()}>
              {t.thisMonth}
            </button>
          )}
          <button onClick={() => setMonth(latestMonth)} disabled={month === latestMonth}>
            {t.latestActivity}
          </button>
        </span>
      </div>
      <div className="cal-grid" role="grid">
        {t.weekdaysShort.map((d) => (
          <div key={d} className="cal-dow">
            {d}
          </div>
        ))}
        {cells.map((d, i) => {
          if (d === null) return <div key={`x${i}`} />
          const date = `${prefix}-${pad(d)}`
          const acts = days.get(date)
          if (!acts) return <div key={date} className="cal-day">{d}</div>
          const km = acts.reduce((s, a) => s + a.distance_m, 0) / 1000
          // the day's main sport (most distance) picks the color
          const main = [...acts].sort((a, b) => b.distance_m - a.distance_m)[0].type
          const color = COLOR[main] ?? 'var(--text-secondary)'
          return (
            <button
              key={date}
              className={selected === date ? 'cal-day has on' : 'cal-day has'}
              style={{ ['--day' as string]: color }}
              onClick={() => onPick(selected === date ? null : date)}
              title={acts.map((a) => `${SPORT_LABEL[lang][a.type]} ${fmtNum(a.distance_m / 1000, 2)} km`).join('\n')}
            >
              <span>{d}</span>
              <small>{km > 0 ? `${km.toFixed(1)}k` : '·'}</small>
            </button>
          )
        })}
      </div>
    </section>
  )
}
