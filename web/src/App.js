import { jsx as _jsx, jsxs as _jsxs, Fragment as _Fragment } from "react/jsx-runtime";
import { Suspense, lazy, useEffect, useMemo, useRef, useState } from 'react';
import { CATEGORIES } from './types';
import { Heatmap } from './components/Heatmap';
import { ActivityList } from './components/ActivityList';
import { Overview } from './components/Overview';
import { PersonalBests } from './components/PersonalBests';
import { Music } from './components/Music';
import { SpotifyTop } from './components/SpotifyTop';
import { DuolingoCourses } from './components/DuolingoCourses';
import { RouteWall } from './components/RouteWall';
import { DICTS, I18n, LOCALE, initialLang, save } from './i18n';
// mapbox-gl is large; load it only when the map tab opens
const RouteMap = lazy(() => import('./components/RouteMap'));
const TABS = ['overview', 'activities', 'music', 'map'];
const tabFromHash = () => {
    const h = location.hash.slice(1);
    return TABS.includes(h) ? h : 'overview';
};
export function App() {
    const [data, setData] = useState(null);
    const [error, setError] = useState(null);
    const [year, setYear] = useState(new Date().getFullYear());
    const [lang, setLang] = useState(initialLang);
    // index.html sets data-theme before first paint (saved choice, else the OS setting)
    const [theme, setTheme] = useState(() => (document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light'));
    const t = DICTS[lang];
    // activity to scroll to and highlight; seq re-triggers when the same one is picked twice
    const [focus, setFocus] = useState(null);
    const [tab, setTabState] = useState(tabFromHash);
    const [mapFocus, setMapFocus] = useState(null);
    const [drill, setDrill] = useState(null);
    const setTab = (next) => {
        setTabState(next);
        history.replaceState(null, '', next === 'overview' ? location.pathname + location.search : `#${next}`);
    };
    useEffect(() => {
        const onHash = () => setTabState(tabFromHash());
        window.addEventListener('hashchange', onHash);
        return () => window.removeEventListener('hashchange', onHash);
    }, []);
    useEffect(() => {
        document.documentElement.lang = LOCALE[lang];
        document.title = lang === 'zh' ? 'Lifelog · 生活记录' : 'Lifelog';
    }, [lang]);
    useEffect(() => {
        document.documentElement.dataset.theme = theme;
    }, [theme]);
    useEffect(() => {
        // GitHub Pages caches files for 10 min; revalidate so a fresh sync shows up at once.
        fetch(import.meta.env.BASE_URL + 'data.json', { cache: 'no-cache' })
            .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`${r.status} ${r.statusText}`))))
            .then(setData)
            .catch((e) => setError(String(e)));
    }, []);
    const years = useMemo(() => {
        if (!data)
            return [];
        const ys = new Set([new Date().getFullYear()]);
        for (const d of Object.keys(data.daily))
            ys.add(Number(d.slice(0, 4)));
        return [...ys].sort((a, b) => b - a);
    }, [data]);
    // The activity list only offers years with activities, the map only years with
    // routes; if the selected year has none there, jump to the newest that does.
    const yearsOf = (acts) => [...new Set(acts.map((a) => Number(a.date.slice(0, 4))))].sort((a, b) => b - a);
    const activityYears = useMemo(() => (data ? yearsOf(data.activities) : []), [data]);
    const mapYears = useMemo(() => (data ? yearsOf(data.activities.filter((a) => a.polyline)) : []), [data]);
    const musicYears = useMemo(() => Object.keys(data?.music ?? {}).filter((k) => k !== 'all').map(Number).sort((a, b) => b - a), [data]);
    const tabYears = { overview: years, activities: activityYears, music: musicYears, map: mapYears }[tab];
    useEffect(() => {
        if (year !== 'all' && tabYears.length > 0 && !tabYears.includes(year))
            setYear(tabYears[0]);
    }, [year, tabYears]);
    // Header, tabs and years stay pinned; publish their height so the personal-bests
    // bar can pin right under them.
    const topbar = useRef(null);
    useEffect(() => {
        const el = topbar.current;
        if (!el)
            return;
        const ro = new ResizeObserver(() => document.documentElement.style.setProperty('--topbar-h', `${el.offsetHeight}px`));
        ro.observe(el);
        return () => ro.disconnect();
    }, []);
    // Only categories with at least one non-zero day in the selected year (or ever,
    // for "all") get a panel.
    const visible = useMemo(() => {
        if (!data)
            return [];
        const prefix = year === 'all' ? '' : String(year);
        const days = Object.entries(data.daily).filter(([d]) => d.startsWith(prefix));
        return CATEGORIES.filter((c) => days.some(([, m]) => (m[c.metric] ?? 0) > 0));
    }, [data, year]);
    const openActivity = (id) => {
        setDrill(null);
        setTab('activities');
        setFocus({ id, seq: Date.now() });
    };
    const openDrill = (type, period) => {
        setFocus(null);
        setDrill({ type, period, seq: Date.now() });
        setTab('activities');
    };
    const switchLang = () => {
        const next = lang === 'zh' ? 'en' : 'zh';
        setLang(next);
        save('lang', next);
    };
    const switchTheme = () => {
        const next = theme === 'dark' ? 'light' : 'dark';
        setTheme(next);
        save('theme', next);
    };
    const yearActivities = !data ? [] : year === 'all' ? data.activities : data.activities.filter((a) => a.date.startsWith(String(year)));
    return (_jsx(I18n.Provider, { value: { lang, t }, children: _jsxs("main", { className: "page", children: [_jsxs("div", { className: "topbar", ref: topbar, children: [_jsxs("header", { className: "top", children: [_jsxs("div", { children: [_jsx("h1", { children: "Lifelog" }), _jsxs("p", { className: "sub", children: [t.subtitle, data && `${lang === 'zh' ? ' —— ' : ' — '}${t.updated} ${new Date(data.generated_at).toLocaleString(LOCALE[lang])}`] })] }), _jsxs("div", { className: "controls", children: [_jsx("button", { className: "icon-btn", onClick: switchLang, title: t.otherLangLabel, "aria-label": t.otherLangLabel, children: t.otherLang }), _jsx("button", { className: "icon-btn", onClick: switchTheme, title: theme === 'dark' ? t.toLight : t.toDark, "aria-label": theme === 'dark' ? t.toLight : t.toDark, children: theme === 'dark' ? _jsx(SunIcon, {}) : _jsx(MoonIcon, {}) })] })] }), error && _jsx("p", { className: "empty", children: t.loadError(error) }), data && (_jsxs(_Fragment, { children: [_jsx("nav", { className: "tabs", role: "tablist", children: TABS.map((k) => (_jsx("button", { role: "tab", "aria-selected": tab === k, className: tab === k ? 'on' : '', onClick: () => setTab(k), children: { overview: t.tabOverview, activities: t.tabActivities, music: t.tabMusic, map: t.tabMap }[k] }, k))) }), _jsxs("nav", { className: "years", children: [_jsx("button", { className: year === 'all' ? 'on' : '', onClick: () => {
                                                setYear('all');
                                                setFocus(null);
                                                setMapFocus(null);
                                                setDrill(null);
                                            }, children: t.all }), tabYears.map((y) => (_jsx("button", { className: y === year ? 'on' : '', onClick: () => {
                                                setYear(y);
                                                setFocus(null);
                                                setMapFocus(null);
                                                setDrill(null);
                                            }, children: y }, y)))] })] }))] }), data && (_jsxs(_Fragment, { children: [tab === 'map' && (_jsxs(_Fragment, { children: [_jsx(Suspense, { fallback: _jsx("div", { className: "map-wrap" }), children: _jsx(RouteMap, { activities: yearActivities, theme: theme, focusId: mapFocus, onShowInList: (id) => {
                                            setTab('activities');
                                            setDrill(null);
                                            setFocus({ id, seq: Date.now() });
                                        } }) }), _jsx(RouteWall, { activities: yearActivities.filter((a) => a.polyline), label: year === 'all' ? t.all : String(year), onSelect: (id) => {
                                        // reset first so picking the same route again re-centers the map
                                        setMapFocus(null);
                                        requestAnimationFrame(() => setMapFocus(id));
                                        window.scrollTo({ top: 0, behavior: 'smooth' });
                                    } })] })), tab === 'music' && (_jsxs(_Fragment, { children: [data.spotify_top && _jsx(SpotifyTop, { top: data.spotify_top }), data.music?.[String(year)] ? (_jsx(Music, { stats: data.music[String(year)] }, year)) : (_jsx("p", { className: "empty", children: t.noMusic }))] })), tab === 'overview' && (_jsxs(_Fragment, { children: [visible.length === 0 && _jsx("p", { className: "empty", children: t.emptyYear }), _jsx("div", { className: "panels", children: visible.map((c) => year === 'all' ? (_jsx(Overview, { category: c, daily: data.daily, onDrill: openDrill, activities: c.sport ? yearActivities.filter((a) => a.type === c.sport) : undefined, onOpen: openActivity, extra: c.key === 'duolingo' && data.duolingo ? (_jsx(DuolingoCourses, { data: data.duolingo, period: String(year) })) : undefined }, c.key)) : (_jsx(Heatmap, { year: year, category: c, daily: data.daily, onDrill: openDrill, activities: c.sport ? yearActivities.filter((a) => a.type === c.sport) : undefined, onOpen: openActivity, extra: c.key === 'duolingo' && data.duolingo ? (_jsx(DuolingoCourses, { data: data.duolingo, period: String(year) })) : undefined }, c.key))) })] })), tab === 'activities' &&
                            (yearActivities.length === 0 ? (_jsx("p", { className: "empty", children: t.emptyYear })) : (_jsxs(_Fragment, { children: [_jsx("div", { className: "pb-sticky", children: _jsx(PersonalBests, { activities: yearActivities, prefer: drill?.type, onSelect: (id) => {
                                                setDrill(null);
                                                setFocus({ id, seq: Date.now() });
                                            } }) }), _jsx(ActivityList, { activities: yearActivities, year: year, focus: focus, drill: drill, onShowMap: (id) => {
                                            setMapFocus(id);
                                            setTab('map');
                                            window.scrollTo(0, 0);
                                        } }, year)] })))] }))] }) }));
}
function SunIcon() {
    return (_jsxs("svg", { viewBox: "0 0 24 24", width: "18", height: "18", fill: "none", stroke: "currentColor", strokeWidth: "2", strokeLinecap: "round", "aria-hidden": true, children: [_jsx("circle", { cx: "12", cy: "12", r: "4" }), _jsx("path", { d: "M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41" })] }));
}
function MoonIcon() {
    return (_jsx("svg", { viewBox: "0 0 24 24", width: "18", height: "18", fill: "none", stroke: "currentColor", strokeWidth: "2", strokeLinejoin: "round", "aria-hidden": true, children: _jsx("path", { d: "M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z" }) }));
}
