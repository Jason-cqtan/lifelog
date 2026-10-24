import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useCallback, useMemo, useState } from 'react';
import { useI18n } from '../i18n';
import { fmtNum } from '../lib/format';
import { Scale, Tooltip, levelFill, quartileLevels, toViewport } from './heat';
const COLOR = 'var(--c-spotify)';
const LIST_STEP = 20;
function minutes(ms, t) {
    const m = Math.round(ms / 60000);
    return m >= 60 ? t.duration(Math.floor(m / 60), m % 60) : t.duration(0, m);
}
/** Listening detail for one period: totals, when you listen, top artists and songs. */
export function Music({ stats }) {
    const { t } = useI18n();
    return (_jsxs("div", { className: "music", children: [_jsxs("div", { className: "music-tiles", children: [_jsx(Tile, { label: t.musicTime, value: fmtNum(stats.ms / 3600000), unit: t.hoursUnit }), _jsx(Tile, { label: t.musicPlays, value: fmtNum(stats.plays, 0) }), _jsx(Tile, { label: t.musicArtists, value: fmtNum(stats.artists, 0) }), _jsx(Tile, { label: t.musicTracks, value: fmtNum(stats.tracks, 0) })] }), _jsx(HourGrid, { hours: stats.hours }), _jsxs("div", { className: "music-lists", children: [_jsx(Artists, { stats: stats }), _jsx(Tracks, { stats: stats })] }), _jsx("p", { className: "music-note", children: t.musicNote })] }));
}
function Tile({ label, value, unit }) {
    return (_jsxs("div", { className: "music-tile", children: [_jsx("span", { className: "pb-label", children: label }), _jsxs("span", { className: "pb-time", children: [value, " ", unit && _jsx("small", { children: unit })] })] }));
}
const CW = 22;
const CH = 18;
const GAP = 3;
const LEFT = 30;
const TOP = 16;
/** Weekday × hour heatmap of listening time. */
function HourGrid({ hours }) {
    const { t } = useI18n();
    const [tip, setTip] = useState(null);
    const clearTip = useCallback(() => setTip(null), []);
    const level = useMemo(() => quartileLevels(hours.flat()), [hours]);
    const peak = useMemo(() => {
        const byHour = Array.from({ length: 24 }, (_, h) => hours.reduce((s, row) => s + row[h], 0));
        const max = Math.max(...byHour);
        return max > 0 ? byHour.indexOf(max) : null;
    }, [hours]);
    const width = LEFT + 24 * (CW + GAP);
    const height = TOP + 7 * (CH + GAP);
    const onMove = (e) => {
        const r = e.currentTarget.getBoundingClientRect();
        const s = width / r.width;
        const h = Math.floor(((e.clientX - r.left) * s - LEFT) / (CW + GAP));
        const d = Math.floor(((e.clientY - r.top) * s - TOP) / (CH + GAP));
        if (h < 0 || h > 23 || d < 0 || d > 6)
            return setTip(null);
        setTip({ d, h, ...toViewport(e.currentTarget, width, LEFT + h * (CW + GAP) + CW / 2, TOP + d * (CH + GAP)) });
    };
    const span = (h) => `${String(h).padStart(2, '0')}:00–${String((h + 1) % 24).padStart(2, '0')}:00`;
    return (_jsxs("section", { className: "panel", children: [_jsxs("header", { className: "panel-head", children: [_jsxs("h3", { children: [_jsx("span", { className: "swatch", style: { background: COLOR } }), t.whenListen] }), peak !== null && (_jsx("dl", { className: "stats", children: _jsxs("div", { children: [_jsx("dt", { children: t.peakHour }), _jsx("dd", { children: span(peak) })] }) }))] }), _jsx("div", { className: "heatmap-scroll", children: _jsxs("div", { className: "heatmap", style: { width }, children: [_jsxs("svg", { viewBox: `0 0 ${width} ${height}`, width: width, height: height, onMouseMove: onMove, onMouseLeave: clearTip, role: "img", "aria-label": t.whenListen, children: [Array.from({ length: 8 }, (_, i) => i * 3).map((h) => (_jsx("text", { x: LEFT + h * (CW + GAP), y: 10, className: "axis-label", children: h }, h))), t.weekdaysAll.map((d, i) => (_jsx("text", { x: 0, y: TOP + i * (CH + GAP) + CH - 5, className: "axis-label", children: d }, d))), hours.map((row, d) => row.map((ms, h) => (_jsx("rect", { x: LEFT + h * (CW + GAP), y: TOP + d * (CH + GAP), width: CW, height: CH, rx: 3, fill: levelFill(COLOR, level(ms)), stroke: tip?.d === d && tip?.h === h ? 'var(--text-primary)' : 'none', strokeWidth: 1.5 }, `${d}-${h}`))))] }), tip && (_jsxs(Tooltip, { x: tip.x, y: tip.y, onScroll: clearTip, children: [_jsx("strong", { children: hours[tip.d][tip.h] > 0 ? minutes(hours[tip.d][tip.h], t) : t.noRecord }), _jsxs("span", { children: [t.weekdaysAll[tip.d], " ", span(tip.h)] })] }))] }) }), _jsx("div", { className: "heat-foot", children: _jsx(Scale, { color: COLOR }) })] }));
}
function Artists({ stats }) {
    const { t } = useI18n();
    const [shown, setShown] = useState(LIST_STEP);
    const max = stats.top_artists[0]?.ms ?? 1;
    return (_jsxs("section", { className: "panel", children: [_jsx("header", { className: "panel-head", children: _jsxs("h3", { children: [_jsx("span", { className: "swatch", style: { background: COLOR } }), t.topArtists] }) }), _jsxs("table", { className: "rank", children: [_jsx("thead", { children: _jsxs("tr", { children: [_jsx("th", { children: "#" }), _jsx("th", { children: t.artist }), _jsx("th", { className: "num", children: t.listenTime }), _jsx("th", { className: "num", children: t.plays }), _jsx("th", { className: "num", children: t.songs })] }) }), _jsx("tbody", { children: stats.top_artists.slice(0, shown).map((a, i) => (_jsxs("tr", { children: [_jsx("td", { className: "muted", children: i + 1 }), _jsxs("td", { className: "rank-name", children: [_jsx("span", { children: a.name }), _jsx("i", { className: "rank-bar", style: { width: `${(a.ms / max) * 100}%` }, "aria-hidden": true })] }), _jsx("td", { className: "num", children: minutes(a.ms, t) }), _jsx("td", { className: "num", children: a.plays }), _jsx("td", { className: "num", children: a.tracks })] }, a.name))) })] }), shown < stats.top_artists.length && (_jsx("button", { className: "more", onClick: () => setShown(shown + LIST_STEP), children: t.loadMore(stats.top_artists.length - shown) }))] }));
}
function Tracks({ stats }) {
    const { t } = useI18n();
    const [shown, setShown] = useState(LIST_STEP);
    const [by, setBy] = useState('plays');
    const list = useMemo(() => [...stats.top_tracks].sort((a, b) => (by === 'plays' ? b.plays - a.plays || b.ms - a.ms : b.ms - a.ms || b.plays - a.plays)), [stats, by]);
    return (_jsxs("section", { className: "panel", children: [_jsxs("header", { className: "panel-head", children: [_jsxs("h3", { children: [_jsx("span", { className: "swatch", style: { background: COLOR } }), t.topTracks] }), _jsx("div", { className: "seg seg-sm", role: "group", children: ['plays', 'ms'].map((k) => (_jsx("button", { className: by === k ? 'on' : '', "aria-pressed": by === k, onClick: () => setBy(k), children: k === 'plays' ? t.byPlays : t.byTime }, k))) })] }), _jsxs("table", { className: "rank", children: [_jsx("thead", { children: _jsxs("tr", { children: [_jsx("th", { children: "#" }), _jsx("th", { children: t.song }), _jsx("th", { className: "num", children: t.plays }), _jsx("th", { className: "num", children: t.listenTime })] }) }), _jsx("tbody", { children: list.slice(0, shown).map((s, i) => (_jsxs("tr", { children: [_jsx("td", { className: "muted", children: i + 1 }), _jsxs("td", { className: "rank-name", children: [_jsx("span", { children: s.track }), _jsx("small", { children: s.artist })] }), _jsx("td", { className: "num", children: s.plays }), _jsx("td", { className: "num", children: minutes(s.ms, t) })] }, `${s.track}|${s.artist}`))) })] }), shown < list.length && (_jsx("button", { className: "more", onClick: () => setShown(shown + LIST_STEP), children: t.loadMore(list.length - shown) }))] }));
}
