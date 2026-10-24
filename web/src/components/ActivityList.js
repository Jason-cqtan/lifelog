import { jsxs as _jsxs, jsx as _jsx } from "react/jsx-runtime";
import { useEffect, useMemo, useRef, useState } from 'react';
import { SPORT_LABEL } from '../types';
import { fmtCadence, fmtDuration, fmtNum, fmtSpeed } from '../lib/format';
import { decodePolyline } from '../lib/polyline';
import { load, save, useI18n } from '../i18n';
import { weatherLabel, windLabel } from '../lib/weather';
import { MonthCalendar } from './MonthCalendar';
import { ActivitySummary } from './ActivitySummary';
const PAGE = 24;
// quick "at least N km" filters
const MIN_KM = [10, 15, 20, 30, 50];
// Values a column sorts by; pace sorts as seconds per km, so rides sort by speed too.
const SORT = {
    date: (a) => Date.parse(a.start_local.replace(' ', 'T')),
    distance: (a) => a.distance_m,
    time: (a) => a.moving_time_s,
    pace: (a) => (a.distance_m > 0 ? a.moving_time_s / a.distance_m : Infinity),
    elev: (a) => a.elevation_gain_m ?? 0,
    hr: (a) => a.avg_hr ?? 0,
    cadence: (a) => a.avg_cadence ?? 0,
};
export function ActivityList({ activities, year, focus, drill, onShowMap, }) {
    const { lang, t } = useI18n();
    const sport = SPORT_LABEL[lang];
    const [filter, setFilter] = useState('all');
    // 'YYYY-MM' or 'YYYY-MM-DD' prefix of activity dates, set by a heatmap drill-down
    const [period, setPeriod] = useState(null);
    const [minKm, setMinKm] = useState(null);
    const [shown, setShown] = useState(PAGE);
    const [view, setViewState] = useState(() => (load('activityView') === 'table' ? 'table' : 'cards'));
    const setView = (v) => {
        setViewState(v);
        save('activityView', v);
    };
    // table sort; the default (date, newest first) matches the card order
    const [sort, setSort] = useState({ key: 'date', desc: true });
    const inPeriod = useMemo(() => activities.filter((a) => (!period || a.date.startsWith(period)) && (minKm === null || a.distance_m >= minKm * 1000)), [activities, period, minKm]);
    const types = useMemo(() => {
        const counts = new Map();
        for (const a of inPeriod)
            counts.set(a.type, (counts.get(a.type) ?? 0) + 1);
        return [...counts.entries()].sort((a, b) => b[1] - a[1]);
    }, [inPeriod]);
    const list = useMemo(() => {
        const filtered = filter === 'all' ? inPeriod : inPeriod.filter((a) => a.type === filter);
        if (view === 'cards' || (sort.key === 'date' && sort.desc))
            return filtered;
        const f = SORT[sort.key];
        return [...filtered].sort((a, b) => (sort.desc ? f(b) - f(a) : f(a) - f(b)));
    }, [inPeriod, filter, view, sort]);
    // Jump to a picked activity: reset filter and sort, widen the page so its row
    // exists, then scroll to it and flash it.
    const [flash, setFlash] = useState(null);
    useEffect(() => {
        if (!focus)
            return;
        const idx = activities.findIndex((a) => a.id === focus.id);
        if (idx < 0)
            return;
        setFilter('all');
        setPeriod(null);
        setMinKm(null);
        setSort({ key: 'date', desc: true });
        setShown((n) => Math.max(n, Math.ceil((idx + 1) / PAGE) * PAGE));
        setFlash(focus);
        const timer = setTimeout(() => setFlash(null), 2400);
        return () => clearTimeout(timer);
    }, [focus, activities]);
    // Heatmap drill-down: narrow to that sport and period, then bring the list into
    // view and flash every match.
    const [flashAll, setFlashAll] = useState(false);
    const head = useRef(null);
    useEffect(() => {
        if (!drill)
            return;
        setFilter(drill.type);
        setPeriod(drill.period);
        setMinKm(null);
        setSort({ key: 'date', desc: true });
        setShown(PAGE);
        setFlashAll(true);
        requestAnimationFrame(() => head.current?.scrollIntoView({ block: 'start' }));
        const timer = setTimeout(() => setFlashAll(false), 2400);
        return () => clearTimeout(timer);
    }, [drill]);
    // Runs after the render that added the item, so the element exists. Long jumps
    // are instant (the flash shows where you landed); short ones scroll smoothly.
    useEffect(() => {
        if (!flash)
            return;
        const el = document.getElementById(`act-${flash.id}`);
        if (!el)
            return;
        const far = Math.abs(el.getBoundingClientRect().top) > window.innerHeight * 2;
        el.scrollIntoView({ behavior: far ? 'auto' : 'smooth', block: 'center' });
    }, [flash]);
    // the calendar shows the whole month: sport and distance filters, not the date one
    const calActs = useMemo(() => activities.filter((a) => (filter === 'all' || a.type === filter) && (minKm === null || a.distance_m >= minKm * 1000)), [activities, filter, minKm]);
    const pickPeriod = (p) => {
        setPeriod(p);
        setShown(PAGE);
    };
    const page = list.slice(0, shown);
    const isFlash = (a) => a.id === flash?.id || (flashAll && !!period);
    return (_jsxs("section", { className: "activities", children: [_jsxs("div", { className: "activities-head", ref: head, children: [_jsxs("div", { className: "chips", role: "tablist", children: [period && (_jsxs("button", { className: "period-chip", onClick: () => setPeriod(null), title: t.clearPeriod, "aria-label": t.clearPeriod, children: [t.periodChip(period, filter === 'all' ? t.all : sport[filter]), " \u2715"] })), _jsxs("button", { className: filter === 'all' ? 'on' : '', onClick: () => setFilter('all'), children: [t.all, " ", inPeriod.length] }), types.map(([type, n]) => (_jsxs("button", { className: filter === type ? 'on' : '', onClick: () => setFilter(type), children: [sport[type], " ", n] }, type)))] }), _jsx("div", { className: "chips km-chips", role: "group", "aria-label": t.minDistance, children: MIN_KM.map((k) => {
                            const n = activities.filter((a) => (!period || a.date.startsWith(period)) && a.distance_m >= k * 1000).length;
                            return (_jsxs("button", { className: minKm === k ? 'on' : '', "aria-pressed": minKm === k, disabled: n === 0 && minKm !== k, onClick: () => setMinKm(minKm === k ? null : k), title: t.kmPlusTitle(k, n), children: [k, "KM+"] }, k));
                        }) })] }), _jsxs("div", { className: year === 'all' ? 'act-top single' : 'act-top', children: [year !== 'all' && _jsx(MonthCalendar, { year: year, activities: calActs, selected: period, onPick: pickPeriod }), _jsx(ActivitySummary, { list: list, base: calActs, year: year, period: period, onPick: pickPeriod })] }), _jsxs("div", { className: "list-head", children: [_jsxs("h3", { children: [t.details, " ", _jsx("span", { children: t.itemsCount(list.length) })] }), _jsx("div", { className: "seg", role: "group", children: ['cards', 'table'].map((v) => (_jsxs("button", { className: view === v ? 'on' : '', "aria-pressed": view === v, onClick: () => setView(v), children: [v === 'cards' ? _jsx(CardsIcon, {}) : _jsx(TableIcon, {}), v === 'cards' ? t.viewCards : t.viewTable] }, v))) })] }), view === 'cards' ? (_jsx("ul", { className: "cards", children: page.map((a) => (_jsxs("li", { id: `act-${a.id}`, className: isFlash(a) ? 'card flash' : 'card', children: [a.polyline ? (_jsx("button", { className: "route-btn", onClick: () => onShowMap(a.id), title: t.showOnMap, "aria-label": t.showOnMap, children: _jsx(Route, { polyline: a.polyline, type: a.type, label: sport[a.type] }) })) : (_jsx(Route, { polyline: a.polyline, type: a.type, label: sport[a.type] })), _jsxs("div", { className: "card-body", children: [_jsxs("div", { className: "card-title", children: [_jsx("span", { className: `tag tag-${a.type}`, children: sport[a.type] }), _jsx("span", { className: "name", children: a.name || sport[a.type] })] }), _jsxs("div", { className: "card-meta", children: [a.start_local, " \u00B7 ", a.source] }), _jsxs("div", { className: "card-nums", children: [a.distance_m > 0 && (_jsxs("span", { children: [_jsx("b", { children: fmtNum(a.distance_m / 1000, 2) }), " km"] })), _jsx("span", { children: fmtDuration(a.moving_time_s, t) }), fmtSpeed(a) && _jsx("span", { children: fmtSpeed(a) }), !!a.elevation_gain_m && _jsxs("span", { children: ["\u2191", Math.round(a.elevation_gain_m), " m"] }), !!a.avg_hr && _jsxs("span", { children: ["\u2665 ", Math.round(a.avg_hr)] }), fmtCadence(a) && _jsx("span", { title: a.stride_m ? t.strideTip(a.stride_m.toFixed(2)) : undefined, children: fmtCadence(a) })] }), a.weather && _jsx(WeatherLine, { w: a.weather, lang: lang, t: t })] })] }, a.id))) })) : (_jsx("div", { className: "table-scroll", children: _jsxs("table", { className: "act-table", children: [_jsx("thead", { children: _jsxs("tr", { children: [_jsx(SortTh, { k: "date", label: t.cols.date, sort: sort, setSort: setSort, t: t }), _jsx("th", { children: t.cols.type }), _jsx("th", { children: t.cols.name }), _jsx(SortTh, { k: "distance", label: t.cols.distance, sort: sort, setSort: setSort, t: t, num: true }), _jsx(SortTh, { k: "time", label: t.cols.time, sort: sort, setSort: setSort, t: t, num: true }), _jsx(SortTh, { k: "pace", label: t.cols.pace, sort: sort, setSort: setSort, t: t, num: true }), _jsx(SortTh, { k: "elev", label: t.cols.elev, sort: sort, setSort: setSort, t: t, num: true }), _jsx(SortTh, { k: "hr", label: t.cols.hr, sort: sort, setSort: setSort, t: t, num: true }), _jsx(SortTh, { k: "cadence", label: t.cols.cadence, sort: sort, setSort: setSort, t: t, num: true }), _jsx("th", { children: t.cols.weather }), _jsx("th", { children: t.cols.source }), _jsx("th", { "aria-label": t.showOnMap })] }) }), _jsx("tbody", { children: page.map((a) => {
                                const w = a.weather && weatherLabel(a.weather.desc, lang);
                                return (_jsxs("tr", { id: `act-${a.id}`, className: isFlash(a) ? 'flash' : undefined, children: [_jsx("td", { className: "nowrap", children: a.start_local }), _jsx("td", { children: _jsx("span", { className: `tag tag-${a.type}`, children: sport[a.type] }) }), _jsx("td", { className: "name-cell", children: a.name || sport[a.type] }), _jsx("td", { className: "num", children: a.distance_m > 0 ? `${fmtNum(a.distance_m / 1000, 2)} km` : '—' }), _jsx("td", { className: "num", children: fmtDuration(a.moving_time_s, t) }), _jsx("td", { className: "num", children: fmtSpeed(a) ?? '—' }), _jsx("td", { className: "num", children: a.elevation_gain_m ? `${Math.round(a.elevation_gain_m)} m` : '—' }), _jsx("td", { className: "num", children: a.avg_hr ? Math.round(a.avg_hr) : '—' }), _jsx("td", { className: "num", title: a.stride_m ? t.strideTip(a.stride_m.toFixed(2)) : undefined, children: a.avg_cadence ? Math.round(a.avg_cadence) : '—' }), _jsx("td", { className: "nowrap", children: a.weather && w ? (_jsxs("span", { title: w.text || undefined, children: [w.icon, " ", Math.round(a.weather.temp_c), "\u00B0C"] })) : ('—') }), _jsx("td", { className: "muted", children: a.source }), _jsx("td", { children: a.polyline && (_jsx("button", { className: "map-link", onClick: () => onShowMap(a.id), title: t.showOnMap, "aria-label": t.showOnMap, children: _jsx(MapIcon, {}) })) })] }, a.id));
                            }) })] }) })), shown < list.length && (_jsx("button", { className: "more", onClick: () => setShown(shown + PAGE), children: t.loadMore(list.length - shown) }))] }));
}
function SortTh({ k, label, sort, setSort, t, num, }) {
    const active = sort.key === k;
    return (_jsx("th", { className: num ? 'num' : undefined, "aria-sort": active ? (sort.desc ? 'descending' : 'ascending') : 'none', children: _jsxs("button", { className: active ? 'sort on' : 'sort', title: t.sortBy(label), 
            // first click sorts the "best/biggest" end: newest, longest… fastest pace is ascending
            onClick: () => setSort({ key: k, desc: active ? !sort.desc : k !== 'pace' }), children: [label, _jsx("span", { "aria-hidden": true, children: active ? (sort.desc ? ' ↓' : ' ↑') : '' })] }) }));
}
export function WeatherLine({ w, lang, t }) {
    const { icon, text } = weatherLabel(w.desc, lang);
    const deg = (c) => `${Math.round(c)}°C`;
    return (_jsxs("div", { className: "card-weather", children: [_jsxs("span", { children: [_jsx("span", { "aria-hidden": true, children: icon }), " ", text && `${text} `, _jsx("b", { children: deg(w.temp_c) })] }), Math.round(w.feels_like_c) !== Math.round(w.temp_c) && _jsx("span", { children: t.feelsLike(deg(w.feels_like_c)) }), _jsx("span", { children: t.humidity(Math.round(w.humidity)) }), _jsx("span", { children: windLabel(w.wind_dir, w.wind_ms, lang) })] }));
}
/** Route thumbnail drawn straight from the polyline — no map tiles needed. */
function Route({ polyline, type, label }) {
    const d = useMemo(() => {
        if (!polyline)
            return null;
        const pts = decodePolyline(polyline);
        if (pts.length < 2)
            return null;
        const lats = pts.map((p) => p[0]);
        const lngs = pts.map((p) => p[1]);
        const minLat = Math.min(...lats);
        const maxLat = Math.max(...lats);
        const minLng = Math.min(...lngs);
        const maxLng = Math.max(...lngs);
        // rough equirectangular correction so routes aren't stretched east-west
        const kx = Math.cos(((minLat + maxLat) / 2) * (Math.PI / 180));
        const w = (maxLng - minLng) * kx || 1e-6;
        const h = maxLat - minLat || 1e-6;
        const s = 84 / Math.max(w, h);
        const ox = (100 - w * s) / 2;
        const oy = (100 - h * s) / 2;
        return pts
            .map(([la, ln], i) => `${i ? 'L' : 'M'}${(ox + (ln - minLng) * kx * s).toFixed(1)},${(oy + (maxLat - la) * s).toFixed(1)}`)
            .join('');
    }, [polyline]);
    return (_jsx("svg", { className: `route route-${type}`, viewBox: "0 0 100 100", "aria-hidden": true, children: d ? _jsx("path", { d: d }) : _jsx("text", { x: "50", y: "56", children: label }) }));
}
const iconProps = {
    viewBox: '0 0 24 24',
    width: 15,
    height: 15,
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 2,
    strokeLinecap: 'round',
    strokeLinejoin: 'round',
    'aria-hidden': true,
};
function CardsIcon() {
    return (_jsxs("svg", { ...iconProps, children: [_jsx("rect", { x: "3", y: "3", width: "7", height: "7", rx: "1.5" }), _jsx("rect", { x: "14", y: "3", width: "7", height: "7", rx: "1.5" }), _jsx("rect", { x: "3", y: "14", width: "7", height: "7", rx: "1.5" }), _jsx("rect", { x: "14", y: "14", width: "7", height: "7", rx: "1.5" })] }));
}
function TableIcon() {
    return (_jsxs("svg", { ...iconProps, children: [_jsx("rect", { x: "3", y: "4", width: "18", height: "16", rx: "2" }), _jsx("path", { d: "M3 10h18M3 15h18M9 4v16" })] }));
}
function MapIcon() {
    return (_jsx("svg", { ...iconProps, children: _jsx("path", { d: "M9 4 3 6v14l6-2 6 2 6-2V4l-6 2-6-2zM9 4v14M15 6v14" }) }));
}
