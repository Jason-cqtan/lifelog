import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useI18n } from '../i18n';
import { fmtNum } from '../lib/format';
const LANG_ZH = {
    en: '英语',
    fr: '法语',
    es: '西班牙语',
    ja: '日语',
    ko: '韩语',
    de: '德语',
    it: '意大利语',
    'zh-HK': '粤语',
};
/** Per-course cumulative XP, plus XP gained and estimated time in the shown period. */
export function DuolingoCourses({ data, period }) {
    const { t, lang } = useI18n();
    const gained = data.periods?.[period] ?? {};
    const courses = [...data.courses].sort((a, b) => b.xp - a.xp);
    const max = courses[0]?.xp || 1;
    // a non-language current course (e.g. CHESS_CH) lives inside "OTHER"
    const currentId = courses.some((c) => c.id === data.current_course) ? data.current_course : 'OTHER';
    const name = (id, title, language) => id === 'OTHER' ? t.otherCourses : lang === 'zh' ? (LANG_ZH[language] ?? title) : title;
    const since = new Date(data.tracked_since).toLocaleDateString(lang === 'zh' ? 'zh-CN' : 'en-US');
    return (_jsxs("div", { className: "duo-courses", children: [_jsx("h4", { children: t.courses }), _jsxs("table", { className: "rank", children: [_jsx("thead", { children: _jsxs("tr", { children: [_jsx("th", { className: "course-col", children: t.course }), _jsx("th", { className: "num", children: t.totalXp }), _jsx("th", { className: "num", children: t.gainedXp }), _jsx("th", { className: "num", children: t.estTime })] }) }), _jsx("tbody", { children: courses.map((c) => {
                            const g = gained[c.id];
                            return (_jsxs("tr", { children: [_jsxs("td", { className: "rank-name", children: [_jsxs("span", { children: [name(c.id, c.title, c.language), c.id === currentId && _jsx("em", { className: "badge", children: t.current })] }), _jsx("i", { className: "rank-bar duo-bar", style: { width: `${(c.xp / max) * 100}%` }, "aria-hidden": true })] }), _jsx("td", { className: "num", children: fmtNum(c.xp, 0) }), _jsx("td", { className: "num", children: g ? fmtNum(g.xp, 0) : '—' }), _jsx("td", { className: "num", children: g ? t.duration(Math.floor(g.minutes / 60), Math.round(g.minutes % 60)) : '—' })] }, c.id));
                        }) })] }), _jsx("p", { className: "music-note", children: t.courseNote(since) })] }));
}
