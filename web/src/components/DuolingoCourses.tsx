import type { DuolingoData } from '../types'
import { useI18n } from '../i18n'
import { fmtNum } from '../lib/format'

const LANG_ZH: Record<string, string> = {
  en: '英语',
  fr: '法语',
  es: '西班牙语',
  ja: '日语',
  ko: '韩语',
  de: '德语',
  it: '意大利语',
  'zh-HK': '粤语',
}

/** Per-course cumulative XP, plus XP gained and estimated time in the shown period. */
export function DuolingoCourses({ data, period }: { data: DuolingoData; period: string }) {
  const { t, lang } = useI18n()
  const gained = data.periods?.[period] ?? {}
  const courses = [...data.courses].sort((a, b) => b.xp - a.xp)
  const max = courses[0]?.xp || 1
  // a non-language current course (e.g. CHESS_CH) lives inside "OTHER"
  const currentId = courses.some((c) => c.id === data.current_course) ? data.current_course : 'OTHER'
  const name = (id: string, title: string, language: string) =>
    id === 'OTHER' ? t.otherCourses : lang === 'zh' ? (LANG_ZH[language] ?? title) : title
  const since = new Date(data.tracked_since).toLocaleDateString(lang === 'zh' ? 'zh-CN' : 'en-US')

  return (
    <div className="duo-courses">
      <h4>{t.courses}</h4>
      <table className="rank">
        <thead>
          <tr>
            <th className="course-col">{t.course}</th>
            <th className="num">{t.totalXp}</th>
            <th className="num">{t.gainedXp}</th>
            <th className="num">{t.estTime}</th>
          </tr>
        </thead>
        <tbody>
          {courses.map((c) => {
            const g = gained[c.id]
            return (
              <tr key={c.id}>
                <td className="rank-name">
                  <span>
                    {name(c.id, c.title, c.language)}
                    {c.id === currentId && <em className="badge">{t.current}</em>}
                  </span>
                  <i className="rank-bar duo-bar" style={{ width: `${(c.xp / max) * 100}%` }} aria-hidden />
                </td>
                <td className="num">{fmtNum(c.xp, 0)}</td>
                <td className="num">{g ? fmtNum(g.xp, 0) : '—'}</td>
                <td className="num">{g ? t.duration(Math.floor(g.minutes / 60), Math.round(g.minutes % 60)) : '—'}</td>
              </tr>
            )
          })}
        </tbody>
      </table>
      <p className="music-note">{t.courseNote(since)}</p>
    </div>
  )
}
