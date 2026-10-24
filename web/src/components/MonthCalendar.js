import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useEffect, useMemo, useState } from 'react';
import { CATEGORIES, SPORT_LABEL } from '../types';
import { useI18n } from '../i18n';
import { fmtNum } from '../lib/format';
const COLOR = Object.fromEntries(CATEGORIES.filter((c) => c.sport).map((c) => [c.sport, c.color]));
const pad = (n) => String(n).padStart(2, '0');
/**
 * One month of the selected year. Days with activities show their distance in
 * the color of that day's main sport; clicking one filters the list to it.
 */
export function MonthCalendar({ year, activities, selected, onPick, }) {
    const { t, lang } = useI18n();
    const now = new Date();
    const latestMonth = useMemo(() => {
        const a = activities.find((x) => x.date.startsWith(String(year)));
        return a ? Number(a.date.slice(5, 7)) - 1 : year === now.getFullYear() ? now.getMonth() : 11;
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [activities, year]);
    const [month, setMonth] = useState(latestMonth);
    // a new year starts on its latest month with activity
    useEffect(() => setMonth(latestMonth), [year]); // eslint-disable-line react-hooks/exhaustive-deps
    // follow a day or month picked elsewhere (e.g. the summary table)
    useEffect(() => {
        if (selected && selected.length >= 7 && selected.startsWith(String(year)))
            setMonth(Number(selected.slice(5, 7)) - 1);
    }, [selected, year]);
    const prefix = `${year}-${pad(month + 1)}`;
    const days = useMemo(() => {
        const byDay = new Map();
        for (const a of activities) {
            if (!a.date.startsWith(prefix))
                continue;
            byDay.set(a.date, [...(byDay.get(a.date) ?? []), a]);
        }
        return byDay;
    }, [activities, prefix]);
    const monthActs = [...days.values()].flat();
    const monthKm = monthActs.reduce((s, a) => s + a.distance_m, 0) / 1000;
    const first = new Date(year, month, 1);
    const lead = (first.getDay() + 6) % 7; // Monday-first
    const count = new Date(year, month + 1, 0).getDate();
    const cells = [...Array(lead).fill(null), ...Array.from({ length: count }, (_, i) => i + 1)];
    const isThisYear = year === now.getFullYear();
    const title = lang === 'zh' ? `${year}年${month + 1}月` : first.toLocaleDateString('en-US', { year: 'numeric', month: 'long' });
    return (_jsxs("section", { className: "panel cal", children: [_jsxs("header", { className: "cal-head", children: [_jsx("h3", { children: title }), _jsxs("div", { className: "cal-nav", children: [_jsx("button", { onClick: () => setMonth(month - 1), disabled: month === 0, "aria-label": t.prevMonth, children: "\u2190" }), _jsx("button", { onClick: () => setMonth(month + 1), disabled: month === 11, "aria-label": t.nextMonth, children: "\u2192" })] })] }), _jsxs("div", { className: "cal-sub", children: [_jsx("span", { children: t.calSummary(monthActs.length, fmtNum(monthKm)) }), _jsxs("span", { className: "cal-jump", children: [isThisYear && (_jsx("button", { onClick: () => setMonth(now.getMonth()), disabled: month === now.getMonth(), children: t.thisMonth })), _jsx("button", { onClick: () => setMonth(latestMonth), disabled: month === latestMonth, children: t.latestActivity })] })] }), _jsxs("div", { className: "cal-grid", role: "grid", children: [t.weekdaysShort.map((d) => (_jsx("div", { className: "cal-dow", children: d }, d))), cells.map((d, i) => {
                        if (d === null)
                            return _jsx("div", {}, `x${i}`);
                        const date = `${prefix}-${pad(d)}`;
                        const acts = days.get(date);
                        if (!acts)
                            return _jsx("div", { className: "cal-day", children: d }, date);
                        const km = acts.reduce((s, a) => s + a.distance_m, 0) / 1000;
                        // the day's main sport (most distance) picks the color
                        const main = [...acts].sort((a, b) => b.distance_m - a.distance_m)[0].type;
                        const color = COLOR[main] ?? 'var(--text-secondary)';
                        return (_jsxs("button", { className: selected === date ? 'cal-day has on' : 'cal-day has', style: { ['--day']: color }, onClick: () => onPick(selected === date ? null : date), title: acts.map((a) => `${SPORT_LABEL[lang][a.type]} ${fmtNum(a.distance_m / 1000, 2)} km`).join('\n'), children: [_jsx("span", { children: d }), _jsx("small", { children: km > 0 ? `${km.toFixed(1)}k` : '·' })] }, date));
                    })] })] }));
}
