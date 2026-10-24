import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useEffect, useMemo, useState } from 'react';
import { useI18n } from '../i18n';
import { fmtDuration, fmtNum, fmtPace } from '../lib/format';
// Standard running distances; values come from best_efforts, the fastest stretch
// of exactly that distance inside a run (computed from its time/distance series).
const RUN_DISTANCES = [
    { key: 'k1', meters: '1000' },
    { key: 'k5', meters: '5000' },
    { key: 'k10', meters: '10000' },
    { key: 'half', meters: '21097.5' },
    { key: 'full', meters: '42195' },
];
// A ride's average speed only counts from this distance, so a short spin can't win.
const MIN_RIDE_FOR_SPEED = 10000;
function clock(sec) {
    const s = Math.round(sec);
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    const ss = String(s % 60).padStart(2, '0');
    return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${ss}` : `${m}:${ss}`;
}
const km = (a) => `${fmtNum(a.distance_m / 1000, 2)} km`;
const kmh = (a) => (a.distance_m / 1000 / (a.moving_time_s / 3600)).toFixed(1);
function maxBy(list, f) {
    let best = null;
    for (const a of list)
        if (!best || f(a) > f(best))
            best = a;
    return best;
}
export function bests(activities, group, t) {
    const list = activities.filter((a) => a.type === group && a.moving_time_s > 0);
    const empty = (key, label) => ({ key, label, value: '—', meta: t.pbNone, activity: null });
    const top = (key, label, a, value, meta) => a ? { key, label, value: value(a), meta: `${meta(a)} · ${a.date}`, activity: a } : empty(key, label);
    if (group === 'run') {
        const efforts = RUN_DISTANCES.map(({ key, meters }) => {
            let best = null;
            for (const a of list) {
                const sec = a.best_efforts?.[meters];
                if (sec && (!best || sec < best.sec))
                    best = { a, sec };
            }
            if (!best)
                return empty(key, t[key]);
            const pace = fmtPace(best.sec / (Number(meters) / 1000));
            return { key, label: t[key], value: clock(best.sec), meta: `${pace} · ${best.a.date}`, activity: best.a };
        });
        return [
            ...efforts,
            top('runDist', t.longestDist, maxBy(list, (a) => a.distance_m), km, (a) => fmtDuration(a.moving_time_s, t)),
            top('runTime', t.longestTime, maxBy(list, (a) => a.moving_time_s), (a) => clock(a.moving_time_s), km),
        ];
    }
    const speedy = list.filter((a) => a.distance_m >= MIN_RIDE_FOR_SPEED);
    return [
        top('rideSpeed', t.fastestSpeed, maxBy(speedy, (a) => a.distance_m / a.moving_time_s), (a) => `${kmh(a)} km/h`, km),
        top('rideDist', t.longestDist, maxBy(list, (a) => a.distance_m), km, (a) => fmtDuration(a.moving_time_s, t)),
        top('rideTime', t.longestTime, maxBy(list, (a) => a.moving_time_s), (a) => clock(a.moving_time_s), km),
    ];
}
export function PersonalBests({ activities, prefer, onSelect, }) {
    const { t, lang } = useI18n();
    const groups = useMemo(() => ['run', 'ride'].filter((g) => activities.some((a) => a.type === g)), [activities]);
    const [group, setGroup] = useState('run');
    useEffect(() => {
        if (prefer === 'run' || prefer === 'ride')
            setGroup(prefer);
    }, [prefer]);
    const shown = groups.includes(group) ? group : groups[0];
    const list = useMemo(() => (shown ? bests(activities, shown, t) : []), [activities, shown, t]);
    if (!shown)
        return null;
    return (_jsxs("section", { className: "pbs", "aria-label": t.pb, children: [_jsxs("div", { className: "pb-head", children: [_jsxs("h2", { title: shown === 'run' ? t.pbNote : t.pbRideNote, children: [t.pb, " ", _jsx("span", { className: "hint", children: "\u24D8" })] }), groups.length > 1 && (_jsx("div", { className: "seg seg-sm", role: "group", children: groups.map((g) => (_jsx("button", { className: g === shown ? 'on' : '', "aria-pressed": g === shown, onClick: () => setGroup(g), children: g === 'run' ? (lang === 'zh' ? '跑步' : 'Running') : lang === 'zh' ? '骑行' : 'Cycling' }, g))) }))] }), _jsx("div", { className: "pb-tiles", children: list.map((b) => b.activity ? (_jsxs("button", { className: `pb pb-${shown}`, onClick: () => onSelect(b.activity.id), title: t.pbJump, children: [_jsx("span", { className: "pb-label", children: b.label }), _jsx("span", { className: "pb-time", children: b.value }), _jsx("span", { className: "pb-meta", children: b.meta })] }, b.key)) : (_jsxs("div", { className: "pb empty-pb", children: [_jsx("span", { className: "pb-label", children: b.label }), _jsx("span", { className: "pb-time", children: "\u2014" }), _jsx("span", { className: "pb-meta", children: b.meta })] }, b.key))) })] }));
}
