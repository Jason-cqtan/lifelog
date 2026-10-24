import { useMemo } from 'react'
import { SPORT_LABEL, type Activity, type Category } from '../types'
import { useI18n } from '../i18n'
import { fmtDuration, fmtNum, fmtSpeed } from '../lib/format'
import { Scale } from './heat'

/**
 * Bottom of a heatmap panel: the color legend on the left and, for sport
 * categories, count / total time / average heart rate on the right, then the
 * most recent activity as a link into the activity list.
 */
export function HeatFooter({
  category,
  activities,
  onOpen,
}: {
  category: Category
  /** this panel's sport and period only, newest first */
  activities: Activity[]
  onOpen?: (id: string) => void
}) {
  const { lang, t } = useI18n()
  const sum = useMemo(() => {
    let secs = 0
    let hrSecs = 0
    let hrWeighted = 0
    for (const a of activities) {
      secs += a.moving_time_s
      if (a.avg_hr) {
        hrSecs += a.moving_time_s
        hrWeighted += a.avg_hr * a.moving_time_s
      }
    }
    // time-weighted, so a long run counts more than a short one
    return { count: activities.length, secs, hr: hrSecs > 0 ? Math.round(hrWeighted / hrSecs) : null }
  }, [activities])

  const latest = activities[0]
  return (
    <>
      <div className="heat-foot">
        <Scale color={category.color} />
        {category.sport && activities.length > 0 && (
          <dl className="mini-stats">
            <div>
              <dt>{t.count}</dt>
              <dd>{sum.count}</dd>
            </div>
            <div>
              <dt>{t.totalTime}</dt>
              <dd>{fmtDuration(sum.secs, t)}</dd>
            </div>
            {sum.hr && (
              <div>
                <dt>{t.avgHr}</dt>
                <dd>♥ {sum.hr}</dd>
              </div>
            )}
          </dl>
        )}
      </div>
      {category.sport && latest && (
        <button className="latest" onClick={() => onOpen?.(latest.id)} title={t.pbJump}>
          <span className="latest-label">{t.latest}</span>
          <span className="latest-date">{latest.start_local}</span>
          <span className="latest-name">{latest.name || SPORT_LABEL[lang][latest.type]}</span>
          {latest.distance_m > 0 && <b>{fmtNum(latest.distance_m / 1000, 2)} km</b>}
          <span>{fmtDuration(latest.moving_time_s, t)}</span>
          {fmtSpeed(latest) && <span>{fmtSpeed(latest)}</span>}
          {!!latest.avg_hr && <span>♥ {Math.round(latest.avg_hr)}</span>}
          <span className="latest-go" aria-hidden>
            →
          </span>
        </button>
      )}
    </>
  )
}
