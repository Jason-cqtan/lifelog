import type { WatchStats } from '../types'
import { useI18n } from '../i18n'

const TOP = 8

/** Most-watched shows and movies in the shown period (Netflix export, Trakt). */
export function WatchTitles({ stats }: { stats: WatchStats }) {
  const { t } = useI18n()
  const top = stats.top.slice(0, TOP)
  const max = top[0]?.minutes || 1
  return (
    <div className="duo-courses">
      <h4>{t.watchTitles(stats.titles)}</h4>
      <table className="rank">
        <thead>
          <tr>
            <th className="course-col">{t.watchTitle}</th>
            <th className="num">{t.watchSessions}</th>
            <th className="num">{t.estTime}</th>
          </tr>
        </thead>
        <tbody>
          {top.map((w) => (
            <tr key={w.title}>
              <td className="rank-name">
                <span>
                  {w.title}
                  <em className="badge">{w.kind === 'episode' ? t.watchShow : t.watchMovie}</em>
                </span>
                <i className="rank-bar watch-bar" style={{ width: `${(w.minutes / max) * 100}%` }} aria-hidden />
              </td>
              <td className="num">{w.sessions}</td>
              <td className="num">{w.minutes > 0 ? t.duration(Math.floor(w.minutes / 60), Math.round(w.minutes % 60)) : '—'}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="music-note">{t.watchNote}</p>
    </div>
  )
}
