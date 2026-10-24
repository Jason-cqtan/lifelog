import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useMemo, useState } from 'react';
import { SPORT_LABEL } from '../types';
import { load, save, useI18n } from '../i18n';
import { fmtNum } from '../lib/format';
import { groupRoutes, routePath } from '../lib/route';
// Runs at least this long get their own color, like running_page.
const LONG_RUN_KM = 20;
function color(g) {
    if (g.rep.type === 'run')
        return g.maxDistance >= LONG_RUN_KM * 1000 ? 'var(--c-run-long)' : 'var(--c-run)';
    if (g.rep.type === 'ride')
        return 'var(--c-ride)';
    if (g.rep.type === 'hike')
        return 'var(--c-hike)';
    return 'var(--text-secondary)';
}
/**
 * Every distinct route of the period as a small shape; repeats of the same
 * route are one tile with a count. Clicking a tile shows it on the map.
 */
export function RouteWall({ activities, label, onSelect, }) {
    const { t, lang } = useI18n();
    const [type, setType] = useState('all');
    const [sort, setSortState] = useState(() => (load('wallSort') === 'distance' ? 'distance' : 'time'));
    const setSort = (s) => {
        setSortState(s);
        save('wallSort', s);
    };
    const types = useMemo(() => [...new Set(activities.map((a) => a.type))], [activities]);
    const groups = useMemo(() => {
        const g = groupRoutes(type === 'all' ? activities : activities.filter((a) => a.type === type));
        return sort === 'distance' ? [...g].sort((a, b) => b.maxDistance - a.maxDistance) : g;
    }, [activities, type, sort]);
    const legend = useMemo(() => {
        const out = [];
        const present = new Set(groups.map(color));
        if (present.has('var(--c-run)'))
            out.push({ color: 'var(--c-run)', label: SPORT_LABEL[lang].run });
        if (present.has('var(--c-run-long)'))
            out.push({ color: 'var(--c-run-long)', label: `${SPORT_LABEL[lang].run} ≥${LONG_RUN_KM}km` });
        if (present.has('var(--c-ride)'))
            out.push({ color: 'var(--c-ride)', label: SPORT_LABEL[lang].ride });
        if (present.has('var(--c-hike)'))
            out.push({ color: 'var(--c-hike)', label: SPORT_LABEL[lang].hike });
        return out;
    }, [groups, lang]);
    if (activities.length === 0)
        return null;
    return (_jsxs("section", { className: "panel wall", children: [_jsxs("header", { className: "wall-head", children: [_jsx("h3", { children: t.routeWall }), _jsxs("div", { className: "wall-tools", children: [_jsxs("div", { className: "chips", children: [_jsx("button", { className: type === 'all' ? 'on' : '', onClick: () => setType('all'), children: t.all }), types.map((k) => (_jsx("button", { className: type === k ? 'on' : '', onClick: () => setType(k), children: SPORT_LABEL[lang][k] }, k)))] }), _jsx("button", { className: "dl-btn", onClick: () => downloadWall(groups, `${t.routeWall} · ${label}`, lang), title: t.downloadWall, "aria-label": t.downloadWall, children: _jsx("svg", { viewBox: "0 0 24 24", width: "15", height: "15", fill: "none", stroke: "currentColor", strokeWidth: "2", strokeLinecap: "round", strokeLinejoin: "round", "aria-hidden": true, children: _jsx("path", { d: "M12 4v11M7 10l5 5 5-5M5 20h14" }) }) })] })] }), _jsx("div", { className: "wall-grid", children: groups.map((g) => {
                    const d = routePath(g.rep.polyline);
                    const km = fmtNum(g.maxDistance / 1000, 1);
                    return (_jsxs("button", { className: "wall-tile", onClick: () => onSelect(g.rep.id), title: t.wallTip(g.rep.name || SPORT_LABEL[lang][g.rep.type], g.members.length, g.rep.date, km), children: [_jsx("svg", { viewBox: "0 0 100 100", "aria-hidden": true, children: d && _jsx("path", { d: d, style: { stroke: color(g) } }) }), g.members.length > 1 && _jsxs("span", { className: "wall-count", children: ["\u00D7", g.members.length] })] }, g.rep.id));
                }) }), _jsxs("footer", { className: "wall-foot", children: [_jsx("span", { className: "wall-legend", children: legend.map((l) => (_jsxs("span", { children: [_jsx("i", { style: { background: l.color } }), l.label] }, l.label))) }), _jsxs("span", { className: "wall-meta", children: [t.routesCount(groups.length), _jsx("span", { className: "sep", children: "\u00B7" }), ['time', 'distance'].map((s) => (_jsx("button", { className: sort === s ? 'on' : '', onClick: () => setSort(s), children: s === 'time' ? t.sortTime : t.sortDistance }, s)))] })] })] }));
}
/** Renders the wall as a PNG on the current theme's surface. */
async function downloadWall(groups, title, lang) {
    const css = getComputedStyle(document.documentElement);
    const v = (name) => css.getPropertyValue(name).trim();
    const resolve = (c) => (c.startsWith('var(') ? v(c.slice(4, -1)) : c);
    const cols = Math.min(10, Math.max(1, groups.length));
    const tile = 110;
    const head = 56;
    const pad = 24;
    const rows = Math.ceil(groups.length / cols);
    const w = pad * 2 + cols * tile;
    const h = head + pad + rows * tile;
    const tiles = groups
        .map((g, i) => {
        const d = routePath(g.rep.polyline, tile, 14);
        if (!d)
            return '';
        const x = pad + (i % cols) * tile;
        const y = head + Math.floor(i / cols) * tile;
        const n = g.members.length > 1 ? `<text x="${tile - 10}" y="${tile - 8}" text-anchor="end" font-size="11" font-weight="600" fill="${v('--text-secondary')}">×${g.members.length}</text>` : '';
        return `<g transform="translate(${x},${y})"><path d="${d}" fill="none" stroke="${resolve(color(g))}" stroke-width="1.6" stroke-linejoin="round" stroke-linecap="round"/>${n}</g>`;
    })
        .join('');
    const font = 'system-ui, -apple-system, PingFang SC, sans-serif';
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" font-family="${font}">
<rect width="100%" height="100%" fill="${v('--surface')}"/>
<text x="${pad}" y="${pad + 14}" font-size="17" font-weight="600" fill="${v('--text-primary')}">${title.replace(/&/g, '&amp;').replace(/</g, '&lt;')}</text>
<text x="${pad}" y="${pad + 34}" font-size="12" fill="${v('--text-muted')}">${lang === 'zh' ? `${groups.length} 条路线` : `${groups.length} routes`}</text>
${tiles}</svg>`;
    const url = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml' }));
    const img = new Image();
    img.src = url;
    await img.decode();
    URL.revokeObjectURL(url);
    const canvas = document.createElement('canvas');
    canvas.width = w * 2;
    canvas.height = h * 2;
    const ctx = canvas.getContext('2d');
    ctx.scale(2, 2);
    ctx.drawImage(img, 0, 0);
    const blob = await new Promise((r) => canvas.toBlob(r, 'image/png'));
    if (!blob)
        return;
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'lifelog-route-wall.png';
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}
