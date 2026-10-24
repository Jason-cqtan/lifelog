import { useMemo } from 'react'
import type { Activity } from '../types'
import { useI18n } from '../i18n'
import { fmtPace } from '../lib/format'

const TARGETS = [
  { key: 'mile', meters: 1609.344 },
  { key: 'k5', meters: 5000 },
  { key: 'k10', meters: 10000 },
  { key: 'half', meters: 21097.5 },
  { key: 'full', meters: 42195 },
] as const

interface Best {
  activity: Activity
  seconds: number
}

/**
 * Fastest run per standard distance. Without split data, a run qualifies when
 * its total distance is 98–110% of the target, and its time is scaled to the
 * exact distance at its average pace.
 */
export function bestEfforts(activities: Activity[]): Record<(typeof TARGETS)[number]['key'], Best | null> {
  const out = Object.fromEntries(TARGETS.map((x) => [x.key, null])) as Record<(typeof TARGETS)[number]['key'], Best | null>
  for (const t of TARGETS) {
    for (const a of activities) {
      if (a.type !== 'run' || !a.moving_time_s) continue
      if (a.distance_m < t.meters * 0.98 || a.distance_m > t.meters * 1.1) continue
      const seconds = (a.moving_time_s * t.meters) / a.distance_m
      if (!out[t.key] || seconds < out[t.key]!.seconds) out[t.key] = { activity: a, seconds }
    }
  }
  return out
}

function clock(sec: number): string {
  const s = Math.round(sec)
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const ss = String(s % 60).padStart(2, '0')
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${ss}` : `${m}:${ss}`
}

function pace(sec: number, meters: number): string {
  return fmtPace(sec / (meters / 1000))
}

export function PersonalBests({ activities, onSelect }: { activities: Activity[]; onSelect: (id: string) => void }) {
  const { t } = useI18n()
  const bests = useMemo(() => bestEfforts(activities), [activities])
  if (!TARGETS.some((x) => bests[x.key])) return null

  return (
    <section className="pbs" aria-label={t.pb}>
      <h2 title={t.pbNote}>
        {t.pb} <span className="hint">ⓘ</span>
      </h2>
      <div className="pb-tiles">
        {TARGETS.map(({ key, meters }) => {
          const b = bests[key]
          return b ? (
            <button key={key} className="pb" onClick={() => onSelect(b.activity.id)} title={t.pbJump}>
              <span className="pb-label">{t[key]}</span>
              <span className="pb-time">{clock(b.seconds)}</span>
              <span className="pb-meta">
                {pace(b.seconds, meters)} · {b.activity.date}
              </span>
            </button>
          ) : (
            <div key={key} className="pb empty-pb">
              <span className="pb-label">{t[key]}</span>
              <span className="pb-time">—</span>
              <span className="pb-meta">{t.pbNone}</span>
            </div>
          )
        })}
      </div>
    </section>
  )
}
