import { useEffect, useMemo, useState } from 'react'
import type { Activity, SportType } from '../types'
import { useI18n, type Dict } from '../i18n'
import { fmtDuration, fmtNum, fmtPace } from '../lib/format'

type Group = 'run' | 'ride'

// Standard running distances; values come from best_efforts, the fastest stretch
// of exactly that distance inside a run (computed from its time/distance series).
const RUN_DISTANCES = [
  { key: 'k1', meters: '1000' },
  { key: 'k5', meters: '5000' },
  { key: 'k10', meters: '10000' },
  { key: 'half', meters: '21097.5' },
  { key: 'full', meters: '42195' },
] as const

// A ride's average speed only counts from this distance, so a short spin can't win.
const MIN_RIDE_FOR_SPEED = 10000

interface Best {
  key: string
  label: string
  value: string
  meta: string
  activity: Activity | null
}

function clock(sec: number): string {
  const s = Math.round(sec)
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const ss = String(s % 60).padStart(2, '0')
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${ss}` : `${m}:${ss}`
}

const km = (a: Activity) => `${fmtNum(a.distance_m / 1000, 2)} km`
const kmh = (a: Activity) => (a.distance_m / 1000 / (a.moving_time_s / 3600)).toFixed(1)

function maxBy(list: Activity[], f: (a: Activity) => number): Activity | null {
  let best: Activity | null = null
  for (const a of list) if (!best || f(a) > f(best)) best = a
  return best
}

export function bests(activities: Activity[], group: Group, t: Dict): Best[] {
  const list = activities.filter((a) => a.type === group && a.moving_time_s > 0)
  const empty = (key: string, label: string): Best => ({ key, label, value: '—', meta: t.pbNone, activity: null })
  const top = (key: string, label: string, a: Activity | null, value: (a: Activity) => string, meta: (a: Activity) => string): Best =>
    a ? { key, label, value: value(a), meta: `${meta(a)} · ${a.date}`, activity: a } : empty(key, label)

  if (group === 'run') {
    const efforts = RUN_DISTANCES.map(({ key, meters }): Best => {
      let best: { a: Activity; sec: number } | null = null
      for (const a of list) {
        const sec = a.best_efforts?.[meters]
        if (sec && (!best || sec < best.sec)) best = { a, sec }
      }
      if (!best) return empty(key, t[key])
      const pace = fmtPace(best.sec / (Number(meters) / 1000))
      return { key, label: t[key], value: clock(best.sec), meta: `${pace} · ${best.a.date}`, activity: best.a }
    })
    return [
      ...efforts,
      top('runDist', t.longestDist, maxBy(list, (a) => a.distance_m), km, (a) => fmtDuration(a.moving_time_s, t)),
      top('runTime', t.longestTime, maxBy(list, (a) => a.moving_time_s), (a) => clock(a.moving_time_s), km),
    ]
  }
  const speedy = list.filter((a) => a.distance_m >= MIN_RIDE_FOR_SPEED)
  return [
    top('rideSpeed', t.fastestSpeed, maxBy(speedy, (a) => a.distance_m / a.moving_time_s), (a) => `${kmh(a)} km/h`, km),
    top('rideDist', t.longestDist, maxBy(list, (a) => a.distance_m), km, (a) => fmtDuration(a.moving_time_s, t)),
    top('rideTime', t.longestTime, maxBy(list, (a) => a.moving_time_s), (a) => clock(a.moving_time_s), km),
  ]
}

export function PersonalBests({
  activities,
  prefer,
  onSelect,
}: {
  activities: Activity[]
  /** sport to show, e.g. the one a heatmap drill-down picked */
  prefer?: SportType
  onSelect: (id: string) => void
}) {
  const { t, lang } = useI18n()
  const groups = useMemo(() => (['run', 'ride'] as const).filter((g) => activities.some((a) => a.type === g)), [activities])
  const [group, setGroup] = useState<Group>('run')
  useEffect(() => {
    if (prefer === 'run' || prefer === 'ride') setGroup(prefer)
  }, [prefer])
  const shown: Group | undefined = groups.includes(group) ? group : groups[0]
  const list = useMemo(() => (shown ? bests(activities, shown, t) : []), [activities, shown, t])
  if (!shown) return null

  return (
    <section className="pbs" aria-label={t.pb}>
      <div className="pb-head">
        <h2 title={shown === 'run' ? t.pbNote : t.pbRideNote}>
          {t.pb} <span className="hint">ⓘ</span>
        </h2>
        {groups.length > 1 && (
          <div className="seg seg-sm" role="group">
            {groups.map((g) => (
              <button key={g} className={g === shown ? 'on' : ''} aria-pressed={g === shown} onClick={() => setGroup(g)}>
                {g === 'run' ? (lang === 'zh' ? '跑步' : 'Running') : lang === 'zh' ? '骑行' : 'Cycling'}
              </button>
            ))}
          </div>
        )}
      </div>
      <div className="pb-tiles">
        {list.map((b) =>
          b.activity ? (
            <button key={b.key} className={`pb pb-${shown}`} onClick={() => onSelect(b.activity!.id)} title={t.pbJump}>
              <span className="pb-label">{b.label}</span>
              <span className="pb-time">{b.value}</span>
              <span className="pb-meta">{b.meta}</span>
            </button>
          ) : (
            <div key={b.key} className="pb empty-pb">
              <span className="pb-label">{b.label}</span>
              <span className="pb-time">—</span>
              <span className="pb-meta">{b.meta}</span>
            </div>
          ),
        )}
      </div>
    </section>
  )
}
