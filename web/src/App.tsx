import { useEffect, useMemo, useState } from 'react'
import { CATEGORIES, type Data } from './types'
import { Heatmap } from './components/Heatmap'
import { ActivityList } from './components/ActivityList'
import { DICTS, I18n, LOCALE, initialLang, save, type Lang } from './i18n'

type Theme = 'light' | 'dark'

export function App() {
  const [data, setData] = useState<Data | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [year, setYear] = useState(new Date().getFullYear())
  const [lang, setLang] = useState<Lang>(initialLang)
  // index.html sets data-theme before first paint (saved choice, else the OS setting)
  const [theme, setTheme] = useState<Theme>(() => (document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light'))
  const t = DICTS[lang]

  useEffect(() => {
    document.documentElement.lang = LOCALE[lang]
    document.title = lang === 'zh' ? 'Lifelog · 生活记录' : 'Lifelog'
  }, [lang])

  useEffect(() => {
    document.documentElement.dataset.theme = theme
  }, [theme])

  useEffect(() => {
    // GitHub Pages caches files for 10 min; revalidate so a fresh sync shows up at once.
    fetch(import.meta.env.BASE_URL + 'data.json', { cache: 'no-cache' })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`${r.status} ${r.statusText}`))))
      .then(setData)
      .catch((e) => setError(String(e)))
  }, [])

  const years = useMemo(() => {
    if (!data) return []
    const ys = new Set<number>([new Date().getFullYear()])
    for (const d of Object.keys(data.daily)) ys.add(Number(d.slice(0, 4)))
    return [...ys].sort((a, b) => b - a)
  }, [data])

  // Only categories with at least one non-zero day in the selected year get a panel.
  const visible = useMemo(() => {
    if (!data) return []
    const prefix = String(year)
    const days = Object.entries(data.daily).filter(([d]) => d.startsWith(prefix))
    return CATEGORIES.filter((c) => days.some(([, m]) => (m[c.metric] ?? 0) > 0))
  }, [data, year])

  const switchLang = () => {
    const next = lang === 'zh' ? 'en' : 'zh'
    setLang(next)
    save('lang', next)
  }
  const switchTheme = () => {
    const next = theme === 'dark' ? 'light' : 'dark'
    setTheme(next)
    save('theme', next)
  }

  const yearActivities = data ? data.activities.filter((a) => a.date.startsWith(String(year))) : []

  return (
    <I18n.Provider value={{ lang, t }}>
      <main className="page">
        <header className="top">
          <div>
            <h1>Lifelog</h1>
            <p className="sub">
              {t.subtitle}
              {data && `${lang === 'zh' ? ' —— ' : ' — '}${t.updated} ${new Date(data.generated_at).toLocaleString(LOCALE[lang])}`}
            </p>
          </div>
          <div className="controls">
            <button className="icon-btn" onClick={switchLang} title={t.otherLangLabel} aria-label={t.otherLangLabel}>
              {t.otherLang}
            </button>
            <button
              className="icon-btn"
              onClick={switchTheme}
              title={theme === 'dark' ? t.toLight : t.toDark}
              aria-label={theme === 'dark' ? t.toLight : t.toDark}
            >
              {theme === 'dark' ? <SunIcon /> : <MoonIcon />}
            </button>
          </div>
        </header>

        {error && <p className="empty">{t.loadError(error)}</p>}

        {data && (
          <>
            <nav className="years">
              {years.map((y) => (
                <button key={y} className={y === year ? 'on' : ''} onClick={() => setYear(y)}>
                  {y}
                </button>
              ))}
            </nav>

            {visible.length === 0 && yearActivities.length === 0 && <p className="empty">{t.emptyYear}</p>}

            <div className="panels">
              {visible.map((c) => (
                <Heatmap key={c.key} year={year} category={c} daily={data.daily} />
              ))}
            </div>

            {yearActivities.length > 0 && <ActivityList key={year} activities={yearActivities} />}
          </>
        )}
      </main>
    </I18n.Provider>
  )
}

function SunIcon() {
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden>
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41" />
    </svg>
  )
}

function MoonIcon() {
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" aria-hidden>
      <path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z" />
    </svg>
  )
}
