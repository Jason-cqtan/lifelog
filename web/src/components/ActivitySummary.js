import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useCallback, useMemo, useState } from 'react';
import { load, save, useI18n } from '../i18n';
import { fmtDuration, fmtNum, fmtPace } from '../lib/format';
import { Tooltip, toViewport } from './heat';
function totals(list) {
    let meters = 0;
    let secs = 0;
    let elev = 0;
    let hrSecs = 0;
    let hrSum = 0;
    let longest = 0;
    let cadSecs = 0;
    let cadSum = 0;
    for (const a of list) {
        meters += a.distance_m;
        secs += a.moving_time_s;
        elev += a.elevation_gain_m ?? 0;
        longest = Math.max(longest, a.distance_m);
        if (a.avg_hr) {
            hrSecs += a.moving_time_s;
            hrSum += a.avg_hr * a.moving_time_s;
        }
        if (a.avg_cadence) {
            cadSecs += a.moving_time_s;
            cadSum += a.avg_cadence * a.moving_time_s;
        }
    }
    return {
        count: list.length,
        meters,
        secs,
        elev,
        hr: hrSecs ? Math.round(hrSum / hrSecs) : null,
        // time-weighted, over activities that recorded it
        cadence: cadSecs ? Math.round(cadSum / cadSecs) : null,
        longest,
    };
}
const single = (list) => {
    const types = new Set(list.map((a) => a.type));
    return types.size === 1 ? [...types][0] : null;
};
/** Pace for foot sports, speed for rides; nothing when sports are mixed. */
function speed(list, tt) {
    const type = single(list);
    if (!tt.meters || !tt.secs || !type)
        return '—';
    return type === 'ride' ? `${(tt.meters / 1000 / (tt.secs / 3600)).toFixed(1)} km/h` : fmtPace(tt.secs / (tt.meters / 1000));
}
/** Best average pace (or speed) of a single activity of at least 1 km. */
function fastest(list) {
    const type = single(list);
    const ok = list.filter((a) => a.distance_m >= 1000 && a.moving_time_s > 0);
    if (!type || ok.length === 0)
        return '—';
    const secPerKm = Math.min(...ok.map((a) => a.moving_time_s / (a.distance_m / 1000)));
    return type === 'ride' ? `${(3600 / secPerKm).toFixed(1)} km/h` : fmtPace(secPerKm);
}
const COLOR = { ride: 'var(--c-ride)', hike: 'var(--c-hike)' };
/**
 * Totals for what the list currently shows, plus a by-month (one year) or
 * by-year (all years) chart or table whose bars / rows filter the list.
 */
export function ActivitySummary({ list, base, year, period, onPick, }) {
    const { t, lang } = useI18n();
    const [view, setViewState] = useState(() => (load('summaryView') === 'table' ? 'table' : 'chart'));
    const setView = (v) => {
        setViewState(v);
        save('summaryView', v);
    };
    const all = useMemo(() => totals(list), [list]);
    // every month of the year (or every year from the first to the last), oldest first
    const buckets = useMemo(() => {
        const keyOf = (a) => (year === 'all' ? a.date.slice(0, 4) : a.date.slice(0, 7));
        const groups = new Map();
        for (const a of base)
            groups.set(keyOf(a), [...(groups.get(keyOf(a)) ?? []), a]);
        let keys;
        if (year === 'all') {
            const ys = [...groups.keys()].map(Number).sort((a, b) => a - b);
            keys = ys.length ? Array.from({ length: ys[ys.length - 1] - ys[0] + 1 }, (_, i) => String(ys[0] + i)) : [];
        }
        else {
            keys = Array.from({ length: 12 }, (_, i) => `${year}-${String(i + 1).padStart(2, '0')}`);
        }
        return keys.map((k) => ({ k, acts: groups.get(k) ?? [], tt: totals(groups.get(k) ?? []) }));
    }, [base, year]);
    const label = (k) => (year === 'all' ? k : lang === 'zh' ? `${Number(k.slice(5))}月` : t.months[Number(k.slice(5)) - 1]);
    const color = COLOR[single(base) ?? ''] ?? 'var(--c-run)';
    const pick = (k) => onPick(period === k ? null : k);
    return (_jsxs("section", { className: "panel summary", children: [_jsxs("header", { className: "sum-head", children: [_jsx("h3", { children: period ? (period.length === 10 ? period : label(period)) : year === 'all' ? t.allHistory : String(year) }), _jsxs("div", { className: "sum-head-right", children: [_jsxs("span", { className: "sum-total", style: { color }, children: [fmtNum(all.meters / 1000, 2), " ", _jsx("small", { children: "km" })] }), _jsx("div", { className: "seg seg-sm", role: "group", children: ['chart', 'table'].map((v) => (_jsx("button", { className: view === v ? 'on' : '', "aria-pressed": view === v, onClick: () => setView(v), children: v === 'chart' ? t.viewChart : t.viewTable }, v))) })] })] }), _jsxs("dl", { className: "sum-grid", children: [_jsx(Stat, { label: t.count, value: fmtNum(all.count, 0) }), _jsx(Stat, { label: t.totalTime, value: fmtDuration(all.secs, t) }), _jsx(Stat, { label: t.cols.pace, value: speed(list, all) }), _jsx(Stat, { label: t.avgHr, value: all.hr ? `♥ ${all.hr}` : '—' }), _jsx(Stat, { label: t.longestDist, value: all.longest ? `${fmtNum(all.longest / 1000, 2)} km` : '—' }), _jsx(Stat, { label: t.fastestPace, value: fastest(list) }), _jsx(Stat, { label: t.avgDist, value: all.count ? `${fmtNum(all.meters / 1000 / all.count, 2)} km` : '—' }), _jsx(Stat, { label: t.totalElev, value: all.elev ? `${fmtNum(all.elev, 0)} m` : '—' }), _jsx(Stat, { label: t.avgCadence, value: all.cadence && single(list) ? `${all.cadence} ${single(list) === 'ride' ? 'rpm' : 'spm'}` : '—' })] }), view === 'chart' ? (_jsx(BarChart, { buckets: buckets, color: color, period: period, label: label, unit: year === 'all' ? t.unitYearKm : t.unitMonthKm, shortLabel: (k) => (year === 'all' ? k : k.slice(5)), onPick: pick })) : (_jsxs("table", { className: "rank sum-table", children: [_jsx("thead", { children: _jsxs("tr", { children: [_jsx("th", { children: year === 'all' ? t.yearCol : t.monthCol }), _jsx("th", { className: "num", children: t.count }), _jsx("th", { className: "num", children: t.cols.distance }), _jsx("th", { className: "num", children: t.totalTime }), _jsx("th", { className: "num", children: t.avgHr })] }) }), _jsx("tbody", { children: [...buckets].reverse().filter((b) => b.tt.count > 0).map(({ k, acts, tt }) => (_jsxs("tr", { className: period === k ? 'on' : undefined, onClick: () => pick(k), title: t.sumRowHint(label(k), speed(acts, tt)), children: [_jsx("td", { children: label(k) }), _jsx("td", { className: "num", children: tt.count }), _jsxs("td", { className: "num", children: [fmtNum(tt.meters / 1000), " km"] }), _jsx("td", { className: "num", children: fmtDuration(tt.secs, t) }), _jsx("td", { className: "num", children: tt.hr ?? '—' })] }, k))) })] }))] }));
}
const W = 640;
const H = 210;
const PAD_L = 40;
const PAD_R = 8;
const PAD_T = 10;
const PAD_B = 24;
/** 0 plus 4 evenly spaced "nice" ticks covering max. */
function ticks(max) {
    if (max <= 0)
        return [0];
    const raw = max / 4;
    const mag = 10 ** Math.floor(Math.log10(raw));
    const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= raw);
    return [0, 1, 2, 3, 4].map((i) => +(i * step).toFixed(6));
}
/** Bar with a rounded top and a flat base on the axis. */
function bar(x, y, w, h) {
    const r = Math.min(4, w / 2, h);
    return `M${x},${y + h}V${y + r}Q${x},${y} ${x + r},${y}H${x + w - r}Q${x + w},${y} ${x + w},${y + r}V${y + h}Z`;
}
function BarChart({ buckets, color, period, label, shortLabel, unit, onPick, }) {
    const { t } = useI18n();
    const [tip, setTip] = useState(null);
    const clearTip = useCallback(() => setTip(null), []);
    const km = buckets.map((b) => b.tt.meters / 1000);
    const ys = ticks(Math.max(0, ...km));
    const top = ys[ys.length - 1] || 1;
    const plotW = W - PAD_L - PAD_R;
    const plotH = H - PAD_T - PAD_B;
    const slot = plotW / Math.max(1, buckets.length);
    const bw = Math.min(40, slot * 0.56);
    const yOf = (v) => PAD_T + plotH * (1 - v / top);
    // a picked day or month highlights the bar that contains it
    const selected = period && buckets.length ? period.slice(0, buckets[0].k.length) : null;
    const indexAt = (e) => {
        const r = e.currentTarget.getBoundingClientRect();
        const x = ((e.clientX - r.left) / r.width) * W - PAD_L;
        const i = Math.floor(x / slot);
        return i >= 0 && i < buckets.length ? i : -1;
    };
    return (_jsxs("div", { className: "sum-chart", children: [_jsxs("svg", { viewBox: `0 0 ${W} ${H}`, role: "img", "aria-label": unit, onMouseMove: (e) => {
                    const i = indexAt(e);
                    if (i < 0)
                        return setTip(null);
                    setTip({ i, ...toViewport(e.currentTarget, W, PAD_L + slot * i + slot / 2, yOf(km[i])) });
                }, onMouseLeave: clearTip, onClick: (e) => {
                    const i = indexAt(e);
                    if (i >= 0 && buckets[i].tt.count > 0)
                        onPick(buckets[i].k);
                }, style: { cursor: tip && buckets[tip.i].tt.count > 0 ? 'pointer' : undefined }, children: [ys.map((v) => (_jsxs("g", { children: [_jsx("line", { x1: PAD_L, x2: W - PAD_R, y1: yOf(v), y2: yOf(v), className: v === 0 ? 'chart-base' : 'chart-grid' }), _jsx("text", { x: PAD_L - 8, y: yOf(v) + 4, textAnchor: "end", className: "axis-label", children: fmtNum(v, 1) })] }, v))), buckets.map((b, i) => {
                        const x = PAD_L + slot * i + (slot - bw) / 2;
                        const h = plotH * (km[i] / top);
                        const dim = selected !== null && b.k !== selected;
                        return (_jsxs("g", { children: [h > 0 && _jsx("path", { d: bar(x, yOf(km[i]), bw, Math.max(h, 1.5)), fill: color, opacity: dim ? 0.35 : tip?.i === i ? 0.85 : 1 }), _jsx("text", { x: PAD_L + slot * i + slot / 2, y: H - 6, textAnchor: "middle", className: "axis-label", children: shortLabel(b.k) })] }, b.k));
                    })] }), _jsx("div", { className: "chart-unit", children: unit }), tip && (_jsxs(Tooltip, { x: tip.x, y: tip.y, onScroll: clearTip, children: [_jsxs("strong", { children: [fmtNum(km[tip.i], 1), " km"] }), _jsxs("span", { children: [label(buckets[tip.i].k), " \u00B7 ", t.barTip(buckets[tip.i].tt.count, fmtDuration(buckets[tip.i].tt.secs, t))] })] }))] }));
}
function Stat({ label, value }) {
    return (_jsxs("div", { children: [_jsx("dt", { children: label }), _jsx("dd", { children: value })] }));
}
