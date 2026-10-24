import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useCallback, useMemo, useRef, useState } from 'react';
import { HeatFooter } from './SportSummary';
import { fmtNum, isoDate } from '../lib/format';
import { categoryStats } from '../lib/stats';
import { useI18n } from '../i18n';
import { DownloadButton, Tooltip, downloadHeatmapPng, levelFill, quartileLevels, toViewport } from './heat';
// All-time view: one row per year, one cell per month (the monthly total).
const CW = 40;
const CH = 18;
const GAP = 3;
const LEFT = 40;
const TOP = 16;
export function Overview({ category, daily, onDrill, activities, onOpen, extra }) {
    const { lang, t } = useI18n();
    const label = category.label[lang];
    const unit = category.unit[lang];
    const [tip, setTip] = useState(null);
    const clearTip = useCallback(() => setTip(null), []);
    const svgRef = useRef(null);
    const { cells, years } = useMemo(() => {
        const byMonth = new Map();
        const activeDates = [];
        for (const [date, m] of Object.entries(daily)) {
            const v = (m[category.metric] ?? 0) * category.scale;
            if (v <= 0)
                continue;
            activeDates.push(date);
            const key = date.slice(0, 7);
            const cur = byMonth.get(key) ?? { value: 0, days: 0 };
            byMonth.set(key, { value: cur.value + v, days: cur.days + 1 });
        }
        activeDates.sort();
        const first = Number(activeDates[0]?.slice(0, 4) ?? new Date().getFullYear());
        const last = Number(activeDates[activeDates.length - 1]?.slice(0, 4) ?? first);
        const now = new Date();
        const years = [];
        for (let y = last; y >= first; y--)
            years.push(y); // newest on top, gaps kept
        const cells = [];
        for (const y of years) {
            for (let m = 0; m < 12; m++) {
                if (y === now.getFullYear() && m > now.getMonth())
                    break;
                const e = byMonth.get(`${y}-${String(m + 1).padStart(2, '0')}`);
                cells.push({ year: y, month: m, value: e?.value ?? 0, days: e?.days ?? 0, level: 0 });
            }
        }
        const level = quartileLevels(cells.map((c) => c.value));
        for (const c of cells)
            c.level = level(c.value);
        return { cells, years };
    }, [category, daily]);
    const { total, activeDays, goalDays, longest, current } = useMemo(() => categoryStats(daily, category, null, isoDate(new Date())), [category, daily]);
    const width = LEFT + 12 * (CW + GAP);
    const height = TOP + years.length * (CH + GAP);
    const row = (y) => years.indexOf(y);
    const cellAt = (e) => {
        const rect = e.currentTarget.getBoundingClientRect();
        const s = width / rect.width;
        const col = Math.floor(((e.clientX - rect.left) * s - LEFT) / (CW + GAP));
        const r = Math.floor(((e.clientY - rect.top) * s - TOP) / (CH + GAP));
        return cells.find((c) => c.month === col && row(c.year) === r);
    };
    const onMove = (e) => {
        const cell = cellAt(e);
        if (!cell)
            return setTip(null);
        setTip({ cell, ...toViewport(e.currentTarget, width, LEFT + cell.month * (CW + GAP) + CW / 2, TOP + row(cell.year) * (CH + GAP)) });
    };
    const ym = (c) => `${c.year}-${String(c.month + 1).padStart(2, '0')}`;
    const drillable = (c) => !!c && c.value > 0 && !!category.sport && !!onDrill;
    const onClick = (e) => {
        const cell = cellAt(e);
        if (cell && drillable(cell))
            onDrill(category.sport, ym(cell));
    };
    return (_jsxs("section", { className: "panel", children: [_jsxs("header", { className: "panel-head", children: [_jsxs("h3", { children: [_jsx("span", { className: "swatch", style: { background: category.color } }), label, _jsx(DownloadButton, { onClick: () => svgRef.current &&
                                    downloadHeatmapPng(svgRef.current, `${label} · ${t.all}`, [`${t.allTime} ${fmtNum(total)} ${unit}`, `${t.activeDays} ${activeDays}`, goalDays !== null && `${t.goalDays} ${goalDays}`, `${t.longestStreak} ${longest} ${t.days}`]
                                        .filter(Boolean)
                                        .join(' · '), `lifelog-${category.key}-${'all'}.png`) })] }), _jsxs("dl", { className: "stats", children: [_jsxs("div", { children: [_jsx("dt", { children: t.allTime }), _jsxs("dd", { children: [fmtNum(total), " ", _jsx("small", { children: unit })] })] }), _jsxs("div", { children: [_jsx("dt", { children: t.activeDays }), _jsx("dd", { children: activeDays })] }), goalDays !== null && (_jsxs("div", { children: [_jsx("dt", { children: t.goalDays }), _jsx("dd", { children: goalDays })] })), _jsxs("div", { children: [_jsx("dt", { children: t.longestStreak }), _jsxs("dd", { children: [longest, " ", _jsx("small", { children: t.days })] })] }), _jsxs("div", { children: [_jsx("dt", { children: t.streak }), _jsxs("dd", { children: [current, " ", _jsx("small", { children: t.days })] })] })] })] }), _jsx("div", { className: "heatmap-scroll", children: _jsxs("div", { className: "heatmap", style: { width }, children: [_jsxs("svg", { ref: svgRef, viewBox: `0 0 ${width} ${height}`, width: width, height: height, onMouseMove: onMove, onMouseLeave: clearTip, onClick: onClick, style: { cursor: drillable(tip?.cell) ? 'pointer' : undefined }, role: "img", "aria-label": t.overviewLabel(label, fmtNum(total), unit), children: [t.months.map((m, i) => (_jsx("text", { x: LEFT + i * (CW + GAP), y: 10, className: "axis-label", children: m }, m))), years.map((y, i) => (_jsx("text", { x: 0, y: TOP + i * (CH + GAP) + CH - 5, className: "axis-label", children: y }, y))), cells.map((c) => (_jsx("rect", { x: LEFT + c.month * (CW + GAP), y: TOP + row(c.year) * (CH + GAP), width: CW, height: CH, rx: 3, fill: levelFill(category.color, c.level), stroke: tip?.cell === c ? 'var(--text-primary)' : 'none', strokeWidth: 1.5 }, `${c.year}-${c.month}`)))] }), tip && (_jsxs(Tooltip, { x: tip.x, y: tip.y, onScroll: clearTip, children: [_jsx("strong", { children: tip.cell.value > 0 ? `${fmtNum(tip.cell.value)} ${unit}` : t.noRecord }), _jsxs("span", { children: [ym(tip.cell), tip.cell.days > 0 && ` · ${t.activeIn(tip.cell.days)}`] }), drillable(tip.cell) && _jsx("span", { className: "tip-hint", children: t.drillMonth })] }))] }) }), _jsx(HeatFooter, { category: category, activities: activities ?? [], onOpen: onOpen }), extra] }));
}
