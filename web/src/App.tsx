import { Suspense, lazy, useEffect, useMemo, useRef, useState } from 'react'
import { CATEGORIES, type Data, type Drill, type SportType } from './types'
import { Heatmap } from './components/Heatmap'
import { ActivityList } from './components/ActivityList'
import { Overview } from './components/Overview'
import { PersonalBests } from './components/PersonalBests'
import { Music } from './components/Music'
import { DICTS, I18n, LOCALE, initialLang, save, type Lang } from './i18n'

// mapbox-gl is large; load it only when the map tab opens
const RouteMap = lazy(() => import('./components/RouteMap'))

type Theme = 'light' | 'dark'
const TABS = ['overview', 'activities', 'music', 'map'] as const
type Tab = (typeof TABS)[number]

const tabFromHash = (): Tab => {
  const h = location.hash.slice(1)
  return (TABS as readonly string[]).includes(h) ? (h as Tab) : 'overview'
}

export function App() {
  const [data, setData] = useState<Data | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [year, setYear] = useState<number | 'all'>(new Date().getFullYear())
  const [lang, setLang] = useState<Lang>(initialLang)
  // index.html sets data-theme before first paint (saved choice, else the OS setting)
  const [theme, setTheme] = useState<Theme>(() => (document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light'))
  const t = DICTS[lang]
  // activity to scroll to and highlight; seq re-triggers when the same one is picked twice
  const [focus, setFocus] = useState<{ id: string; seq: number } | null>(null)
  const [tab, setTabState] = useState<Tab>(tabFromHash)
  const [mapFocus, setMapFocus] = useState<string | null>(null)
  const [drill, setDrill] = useState<Drill | null>(null)
  const setTab = (next: Tab) => {
    setTabState(next)
    history.replaceState(null, '', next === 'overview' ? location.pathname + location.search : `#${next}`)
  }
  useEffect(() => {
    const onHash = () => setTabState(tabFromHash())
    window.addEventListener('hashchange', onHash)
    return () => window.removeEventListener('hashchange', onHash)
  }, [])

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

  // The activity list only offers years with activities, the map only years with
  // routes; if the selected year has none there, jump to the newest that does.
  const yearsOf = (acts: Data['activities']) => [...new Set(acts.map((a) => Number(a.date.slice(0, 4))))].sort((a, b) => b - a)
  const activityYears = useMemo(() => (data ? yearsOf(data.activities) : []), [data])
  const mapYears = useMemo(() => (data ? yearsOf(data.activities.filter((a) => a.polyline)) : []), [data])
  const musicYears = useMemo(
    () => Object.keys(data?.music ?? {}).filter((k) => k !== 'all').map(Number).sort((a, b) => b - a),
    [data],
  )
  const tabYears = { overview: years, activities: activityYears, music: musicYears, map: mapYears }[tab]
  useEffect(() => {
    if (year !== 'all' && tabYears.length > 0 && !tabYears.includes(year)) setYear(tabYears[0])
  }, [year, tabYears])

  // Header, tabs and years stay pinned; publish their height so the personal-bests
  // bar can pin right under them.
  const topbar = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const el = topbar.current
    if (!el) return
    const ro = new ResizeObserver(() => document.documentElement.style.setProperty('--topbar-h', `${el.offsetHeight}px`))
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  // Only categories with at least one non-zero day in the selected year (or ever,
  // for "all") get a panel.
  const visible = useMemo(() => {
    if (!data) return []
    const prefix = year === 'all' ? '' : String(year)
    const days = Object.entries(data.daily).filter(([d]) => d.startsWith(prefix))
    return CATEGORIES.filter((c) => days.some(([, m]) => (m[c.metric] ?? 0) > 0))
  }, [data, year])

  const openActivity = (id: string) => {
    setDrill(null)
    setTab('activities')
    setFocus({ id, seq: Date.now() })
  }

  const openDrill = (type: SportType, period: string) => {
    setFocus(null)
    setDrill({ type, period, seq: Date.now() })
    setTab('activities')
  }

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

  const yearActivities = !data ? [] : year === 'all' ? data.activities : data.activities.filter((a) => a.date.startsWith(String(year)))

  return (
    <I18n.Provider value={{ lang, t }}>
      <main className="page">
        <div className="topbar" ref={topbar}>
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
              <nav className="tabs" role="tablist">
                {TABS.map((k) => (
                  <button key={k} role="tab" aria-selected={tab === k} className={tab === k ? 'on' : ''} onClick={() => setTab(k)}>
                    {{ overview: t.tabOverview, activities: t.tabActivities, music: t.tabMusic, map: t.tabMap }[k]}
                  </button>
                ))}
              </nav>

              <nav className="years">
                <button
                  className={year === 'all' ? 'on' : ''}
                  onClick={() => {
                    setYear('all')
                    setFocus(null)
                    setMapFocus(null)
                    setDrill(null)
                  }}
                >
                  {t.all}
                </button>
                {tabYears.map((y) => (
                  <button
                    key={y}
                    className={y === year ? 'on' : ''}
                    onClick={() => {
                      setYear(y)
                      setFocus(null)
                      setMapFocus(null)
                      setDrill(null)
                    }}
                  >
                    {y}
                  </button>
                ))}
              </nav>
            </>
          )}
        </div>

        {data && (
          <>
            {tab === 'map' && (
              <Suspense fallback={<div className="map-wrap" />}>
                <RouteMap
                  activities={yearActivities}
                  theme={theme}
                  focusId={mapFocus}
                  onShowInList={(id) => {
                    setTab('activities')
                    setDrill(null)
                    setFocus({ id, seq: Date.now() })
                  }}
                />
              </Suspense>
            )}

            {tab === 'music' &&
              (data.music?.[String(year)] ? (
                <Music key={year} stats={data.music[String(year)]} />
              ) : (
                <p className="empty">{t.noMusic}</p>
              ))}

            {tab === 'overview' && (
              <>
                {visible.length === 0 && <p className="empty">{t.emptyYear}</p>}
                <div className="panels">
                  {visible.map((c) =>
                    year === 'all' ? (
                      <Overview
                        key={c.key}
                        category={c}
                        daily={data.daily}
                        onDrill={openDrill}
                        activities={c.sport ? yearActivities.filter((a) => a.type === c.sport) : undefined}
                        onOpen={openActivity}
                      />
                    ) : (
                      <Heatmap
                        key={c.key}
                        year={year}
                        category={c}
                        daily={data.daily}
                        onDrill={openDrill}
                        activities={c.sport ? yearActivities.filter((a) => a.type === c.sport) : undefined}
                        onOpen={openActivity}
                      />
                    ),
                  )}
                </div>
              </>
            )}

            {tab === 'activities' &&
              (yearActivities.length === 0 ? (
                <p className="empty">{t.emptyYear}</p>
              ) : (
                <>
                  {/* stays pinned while the list scrolls under it */}
                  <div className="pb-sticky">
                    <PersonalBests
                      activities={yearActivities}
                      prefer={drill?.type}
                      onSelect={(id) => {
                        setDrill(null)
                        setFocus({ id, seq: Date.now() })
                      }}
                    />
                  </div>
                  <ActivityList
                    key={year}
                    activities={yearActivities}
                    focus={focus}
                    drill={drill}
                    onShowMap={(id) => {
                      setMapFocus(id)
                      setTab('map')
                      window.scrollTo(0, 0)
                    }}
                  />
                </>
              ))}
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
