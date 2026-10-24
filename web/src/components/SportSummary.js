import { jsx as _jsx, jsxs as _jsxs, Fragment as _Fragment } from "react/jsx-runtime";
import { useMemo } from 'react';
import { SPORT_LABEL } from '../types';
import { useI18n } from '../i18n';
import { fmtDuration, fmtNum, fmtSpeed } from '../lib/format';
import { Scale } from './heat';
/**
 * Bottom of a heatmap panel: the color legend on the left and, for sport
 * categories, count / total time / average heart rate on the right, then the
 * most recent activity as a link into the activity list.
 */
export function HeatFooter({ category, activities, onOpen, }) {
    const { lang, t } = useI18n();
    const sum = useMemo(() => {
        let secs = 0;
        let hrSecs = 0;
        let hrWeighted = 0;
        for (const a of activities) {
            secs += a.moving_time_s;
            if (a.avg_hr) {
                hrSecs += a.moving_time_s;
                hrWeighted += a.avg_hr * a.moving_time_s;
            }
        }
        // time-weighted, so a long run counts more than a short one
        return { count: activities.length, secs, hr: hrSecs > 0 ? Math.round(hrWeighted / hrSecs) : null };
    }, [activities]);
    const latest = activities[0];
    return (_jsxs(_Fragment, { children: [_jsxs("div", { className: "heat-foot", children: [_jsx(Scale, { color: category.color }), category.sport && activities.length > 0 && (_jsxs("dl", { className: "mini-stats", children: [_jsxs("div", { children: [_jsx("dt", { children: t.count }), _jsx("dd", { children: sum.count })] }), _jsxs("div", { children: [_jsx("dt", { children: t.totalTime }), _jsx("dd", { children: fmtDuration(sum.secs, t) })] }), sum.hr && (_jsxs("div", { children: [_jsx("dt", { children: t.avgHr }), _jsxs("dd", { children: ["\u2665 ", sum.hr] })] }))] }))] }), category.sport && latest && (_jsxs("button", { className: "latest", onClick: () => onOpen?.(latest.id), title: t.pbJump, children: [_jsx("span", { className: "latest-label", children: t.latest }), _jsx("span", { className: "latest-date", children: latest.start_local }), _jsx("span", { className: "latest-name", children: latest.name || SPORT_LABEL[lang][latest.type] }), latest.distance_m > 0 && _jsxs("b", { children: [fmtNum(latest.distance_m / 1000, 2), " km"] }), _jsx("span", { children: fmtDuration(latest.moving_time_s, t) }), fmtSpeed(latest) && _jsx("span", { children: fmtSpeed(latest) }), !!latest.avg_hr && _jsxs("span", { children: ["\u2665 ", Math.round(latest.avg_hr)] }), _jsx("span", { className: "latest-go", "aria-hidden": true, children: "\u2192" })] }))] }));
}
