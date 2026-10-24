import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { HeatFooter } from './SportSummary';
import { addDays, fmtNum, isoDate } from '../lib/format';
import { useI18n } from '../i18n';
import { DownloadButton, Tooltip, downloadHeatmapPng, levelFill, quartileLevels, toViewport } from './heat';
import { categoryStats } from '../lib/stats';
const CELL = 11;
const GAP = 2;
const STEP = CELL + GAP;
const LEFT = 26;
const TOP = 16;
export function Heatmap({ year, category, daily, onDrill, activities, onOpen, extra }) {
    const { lang, t } = useI18n();
    const label = category.label[lang];
    const unit = category.unit[lang];
    const [tip, setTip] = useState(null);
    const clearTip = useCallback(() => setTip(null), []);
    const svgRef = useRef(null);
    const scrollRef = useRef(null);
    const { cells, weeks } = useMemo(() => {
        const jan1 = new Date(year, 0, 1);
        const offset = (jan1.getDay() + 6) % 7;
        const today = isoDate(new Date());
        const cells = [];
        for (let d = jan1, i = 0; d.getFullYear() === year; d = addDays(d, 1), i++) {
            const date = isoDate(d);
            if (date > today)
                break;
            const value = (daily[date]?.[category.metric] ?? 0) * category.scale;
            cells.push({ date, week: Math.floor((i + offset) / 7), dow: (d.getDay() + 6) % 7, value, level: 0 });
        }
        const level = quartileLevels(cells.map((c) => c.value));
        for (const c of cells)
            c.level = level(c.value);
        return { cells, weeks: Math.floor((offset + 365) / 7) + 1 };
    }, [year, category, daily]);
    const { total, activeDays, goalDays, longest, current } = useMemo(() => categoryStats(daily, category, `${year}-01-01`, `${year}-12-31`), [year, category, daily]);
    const byPos = useMemo(() => {
        const m = new Map();
        for (const c of cells)
            m.set(`${c.week}:${c.dow}`, c);
        return m;
    }, [cells]);
    // On narrow screens start scrolled to the most recent weeks.
    useEffect(() => {
        const el = scrollRef.current;
        if (el)
            el.scrollLeft = el.scrollWidth;
    }, [year]);
    const width = LEFT + weeks * STEP;
    const height = TOP + 7 * STEP;
    // One handler on the whole grid: the hit target is the full step, not just the cell.
    const cellAt = (e) => {
        const rect = e.currentTarget.getBoundingClientRect();
        const sx = width / rect.width;
        const x = (e.clientX - rect.left) * sx;
        const y = (e.clientY - rect.top) * sx;
        return byPos.get(`${Math.floor((x - LEFT) / STEP)}:${Math.floor((y - TOP) / STEP)}`);
    };
    const onMove = (e) => {
        const cell = cellAt(e);
        if (!cell)
            return setTip(null);
        setTip({ cell, ...toViewport(e.currentTarget, width, LEFT + cell.week * STEP + CELL / 2, TOP + cell.dow * STEP) });
    };
    const drillable = (c) => !!c && c.value > 0 && !!category.sport && !!onDrill;
    const onClick = (e) => {
        const cell = cellAt(e);
        if (cell && drillable(cell))
            onDrill(category.sport, cell.date);
    };
    const monthLabels = t.months.map((label, m) => {
        const first = cells.find((c) => Number(c.date.slice(5, 7)) === m + 1);
        return first ? { label, x: LEFT + first.week * STEP } : null;
    });
    return (_jsxs("section", { className: "panel", children: [_jsxs("header", { className: "panel-head", children: [_jsxs("h3", { children: [_jsx("span", { className: "swatch", style: { background: category.color } }), label, _jsx(DownloadButton, { onClick: () => svgRef.current &&
                                    downloadHeatmapPng(svgRef.current, `${label} · ${String(year)}`, [`${t.yearTotal(year)} ${fmtNum(total)} ${unit}`, `${t.activeDays} ${activeDays}`, goalDays !== null && `${t.goalDays} ${goalDays}`, `${t.longestStreak} ${longest} ${t.days}`]
                                        .filter(Boolean)
                                        .join(' · '), `lifelog-${category.key}-${year}.png`) })] }), _jsxs("dl", { className: "stats", children: [_jsxs("div", { children: [_jsx("dt", { children: t.yearTotal(year) }), _jsxs("dd", { children: [fmtNum(total), " ", _jsx("small", { children: unit })] })] }), _jsxs("div", { children: [_jsx("dt", { children: t.activeDays }), _jsx("dd", { children: activeDays })] }), goalDays !== null && (_jsxs("div", { children: [_jsx("dt", { children: t.goalDays }), _jsx("dd", { children: goalDays })] })), _jsxs("div", { children: [_jsx("dt", { children: t.longestStreak }), _jsxs("dd", { children: [longest, " ", _jsx("small", { children: t.days })] })] }), year === new Date().getFullYear() && (_jsxs("div", { children: [_jsx("dt", { children: t.streak }), _jsxs("dd", { children: [current, " ", _jsx("small", { children: t.days })] })] }))] })] }), _jsx("div", { className: "heatmap-scroll", ref: scrollRef, children: _jsxs("div", { className: "heatmap", style: { width }, children: [_jsxs("svg", { ref: svgRef, viewBox: `0 0 ${width} ${height}`, width: width, height: height, onMouseMove: onMove, onMouseLeave: clearTip, onClick: onClick, style: { cursor: drillable(tip?.cell) ? 'pointer' : undefined }, role: "img", "aria-label": t.heatmapLabel(year, label, fmtNum(total), unit), children: [monthLabels.map((m) => m && (_jsx("text", { x: m.x, y: 10, className: "axis-label", children: m.label }, m.label))), t.weekdays.map((d, i) => (_jsx("text", { x: 0, y: TOP + (i * 2) * STEP + CELL - 2, className: "axis-label", children: d }, d))), cells.map((c) => (_jsx("rect", { x: LEFT + c.week * STEP, y: TOP + c.dow * STEP, width: CELL, height: CELL, rx: 2, fill: levelFill(category.color, c.level), stroke: tip?.cell === c ? 'var(--text-primary)' : 'none', strokeWidth: 1.5 }, c.date)))] }), tip && (_jsxs(Tooltip, { x: tip.x, y: tip.y, onScroll: clearTip, children: [_jsx("strong", { children: tip.cell.value > 0 ? `${fmtNum(tip.cell.value)} ${unit}` : t.noRecord }), _jsx("span", { children: tip.cell.date }), drillable(tip.cell) && _jsx("span", { className: "tip-hint", children: t.drillDay })] }))] }) }), _jsx(HeatFooter, { category: category, activities: activities ?? [], onOpen: onOpen }), extra] }));
}
