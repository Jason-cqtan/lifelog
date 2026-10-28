import { Suspense, lazy, useEffect, useMemo, useState } from 'react'
import { CATEGORIES, type Data, type Drill, type SportType } from './types'
import { HeatmapPanel } from './components/HeatmapPanel'
import { HeatmapSkeleton, NavigationSkeleton } from './components/Loading'
import { ActivityList } from './components/ActivityList'
import { PersonalBests } from './components/PersonalBests'
import { Music } from './components/Music'
import { SpotifyTop } from './components/SpotifyTop'
import { RouteWall } from './components/RouteWall'
import { useHeightVar } from './lib/useHeightVar'
import { openRoutes, WrongAnswer } from './lib/routes'
import { LockIcon, MapLock } from './components/MapLock'
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
  const [raw, setRaw] = useState<Data | null>(null)
  // routes are sealed in data.json's sibling file; they open with the map answer
  const [routes, setRoutes] = useState<Record<string, string> | null>(null)
  const data = useMemo(
    () => (raw && routes ? { ...raw, activities: raw.activities.map((a) => (routes[a.id] ? { ...a, polyline: routes[a.id] } : a)) } : raw),
    [raw, routes],
  )
  const [error, setError] = useState<string | null>(null)
  const [loadAttempt, setLoadAttempt] = useState(0)
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
    const controller = new AbortController()
    // GitHub Pages caches files for 10 min; revalidate so a fresh sync shows up at once.
    fetch(import.meta.env.BASE_URL + 'data.json', { cache: 'no-cache', signal: controller.signal })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`${r.status} ${r.statusText}`))))
      .then((next: Data) => { if (!controller.signal.aborted) setRaw(next) })
      .catch((e) => { if (!controller.signal.aborted) setError(String(e)) })
    return () => controller.abort()
  }, [loadAttempt])

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
  const mapYears = useMemo(() => (data ? yearsOf(data.activities.filter((a) => a.has_route)) : []), [data])
  const musicYears = useMemo(
    () => Object.keys(data?.music ?? {}).filter((k) => k !== 'all').map(Number).sort((a, b) => b - a),
    [data],
  )
  const tabYears = { overview: years, activities: activityYears, music: musicYears, map: mapYears }[tab]
  useEffect(() => {
    if (year !== 'all' && tabYears.length > 0 && !tabYears.includes(year)) setYear(tabYears[0])
  }, [year, tabYears])

  // The map, and every way into it, waits for the answer to the map question.
  // A right answer is kept for this browser tab only, so a reload doesn't ask again.
  const [gate, setGate] = useState<(() => void) | null>(null)
  const [autoTried, setAutoTried] = useState(false)
  const unlock = async (answer: string) => {
    if (!raw?.routes) return false
    try {
      setRoutes(await openRoutes(raw.routes, answer))
    } catch (e) {
      if (e instanceof WrongAnswer) return false
      throw e
    }
    try {
      sessionStorage.setItem('mapAnswer', answer)
    } catch {
      // private mode: just ask again next time
    }
    return true
  }
  const withMap = (then: () => void) => (routes ? then() : setGate(() => then))
  useEffect(() => {
    if (!raw?.routes) return
    let saved: string | null = null
    try {
      saved = sessionStorage.getItem('mapAnswer')
    } catch {
      // unavailable: ask
    }
    if (!saved) return setAutoTried(true)
    unlock(saved)
      .catch(() => false)
      .then((ok) => ok || sessionStorage.removeItem('mapAnswer'))
      .finally(() => setAutoTried(true))
  }, [raw])
  // a #map link (or reload) while locked lands on the overview with the question up
  useEffect(() => {
    if (tab !== 'map' || routes || !raw || (raw.routes && !autoTried)) return
    setTab('overview')
    if (raw.routes) setGate(() => () => setTab('map'))
  }, [tab, routes, raw, autoTried])

  // Header, tabs and years stay pinned, then the personal bests under them; publish
  // their heights so each next pinned bar sits right below.
  const topbar = useHeightVar('--topbar-h')
  const pbBar = useHeightVar('--pb-h')

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
                <span className="updated">
                  <span className="dash">{lang === 'zh' ? ' —— ' : ' — '}</span>
                  {data ? <>{t.updated} {new Date(data.generated_at).toLocaleString(LOCALE[lang])}</> : !error && <span className="skeleton skeleton-updated" aria-hidden="true" />}
                </span>
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

          {error && (
            <div className="load-error" role="alert">
              <p>{t.loadError(error)}</p>
              <button className="more" onClick={() => { setError(null); setLoadAttempt((n) => n + 1) }}>{t.retry}</button>
            </div>
          )}

          {!data && !error && <NavigationSkeleton />}

          {data && (
            <>
              <nav className="tabs" role="tablist">
                {TABS.filter((k) => k !== 'map' || raw?.routes).map((k) => {
                  // greyed with a lock until the question is answered
                  const locked = k === 'map' && !routes
                  return (
                    <button
                      key={k}
                      role="tab"
                      aria-selected={tab === k}
                      className={[tab === k && 'on', locked && 'locked'].filter(Boolean).join(' ')}
                      title={locked ? t.mapLocked : undefined}
                      onClick={() => (k === 'map' ? withMap(() => setTab('map')) : setTab(k))}
                    >
                      {{ overview: t.tabOverview, activities: t.tabActivities, music: t.tabMusic, map: t.tabMap }[k]}
                      {locked && <LockIcon size={13} />}
                    </button>
                  )
                })}
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

        {!error && tab === 'overview' && (
          <>
            {data && visible.length === 0 && <p className="empty">{t.emptyYear}</p>}
            <div className="panels">
              {(data ? visible : CATEGORIES).map((c) => (
                <HeatmapPanel key={`${year}-${c.key}`} category={c} year={year} data={data} onDrill={openDrill} onOpen={openActivity} />
              ))}
            </div>
          </>
        )}

        {!data && !error && tab !== 'overview' && (
          <div className="panels">
            <HeatmapSkeleton />
            <HeatmapSkeleton />
          </div>
        )}

        {data && (
          <>
            {tab === 'map' && routes && (
              <>
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
              <RouteWall
                activities={yearActivities.filter((a) => a.polyline)}
                label={year === 'all' ? t.all : String(year)}
                onSelect={(id) => {
                  // reset first so picking the same route again re-centers the map
                  setMapFocus(null)
                  requestAnimationFrame(() => setMapFocus(id))
                  window.scrollTo({ top: 0, behavior: 'smooth' })
                }}
              />
              </>
            )}

            {tab === 'music' && (
              <>
                {data.spotify_top && <SpotifyTop top={data.spotify_top} />}
                {data.music?.[String(year)] ? (
                  <Music key={year} stats={data.music[String(year)]} />
                ) : (
                  <p className="empty">{t.noMusic}</p>
                )}
              </>
            )}

            {tab === 'activities' &&
              (yearActivities.length === 0 ? (
                <p className="empty">{t.emptyYear}</p>
              ) : (
                <>
                  {/* stays pinned while the list scrolls under it */}
                  <div className="pb-sticky" ref={pbBar}>
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
                    year={year}
                    focus={focus}
                    drill={drill}
                    onShowMap={(id) =>
                      withMap(() => {
                        setMapFocus(id)
                        setTab('map')
                        window.scrollTo(0, 0)
                      })
                    }
                  />
                </>
              ))}
          </>
        )}
      </main>
      {gate && raw?.routes && (
        <MapLock
          question={raw.routes.question}
          onClose={() => setGate(null)}
          onSubmit={async (answer) => {
            if (!(await unlock(answer))) return false
            setGate(null)
            gate()
            return true
          }}
        />
      )}
      <footer className="contact">
        <span>{t.contact}</span>
        <a href="https://t.me/aeiou_93" target="_blank" rel="noopener noreferrer" title="Telegram @aeiou_93">
          <TelegramIcon />
          <span>Telegram</span>
        </a>
        <a href="https://x.com/O_achengtan" target="_blank" rel="noopener noreferrer" title="X @O_achengtan">
          <XIcon />
          <span>X</span>
        </a>
      </footer>
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

function TelegramIcon() {
  return (
    <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor" aria-hidden>
      <path d="M21.9 4.3 18.7 19.4c-.2 1.1-.9 1.3-1.8.8l-4.9-3.6-2.4 2.3c-.3.3-.5.5-1 .5l.4-5 9.1-8.2c.4-.4-.1-.6-.6-.2L6.2 13.1 1.4 11.6c-1-.3-1.1-1 .2-1.5L20.5 2.8c.9-.3 1.6.2 1.4 1.5z" />
    </svg>
  )
}

function XIcon() {
  return (
    <svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor" aria-hidden>
      <path d="M18.2 2.3h3.4l-7.4 8.4 8.7 11.5h-6.8l-5.3-7-6.1 7H1.3l7.9-9L.9 2.3h7l4.8 6.4 5.5-6.4zm-1.2 17.9h1.9L7.1 4.2H5.1l11.9 16z" />
    </svg>
  )
}
