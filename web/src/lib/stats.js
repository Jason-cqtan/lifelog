import { isoDate } from './format';
const DAY = 86400000;
const toDay = (s) => Date.UTC(+s.slice(0, 4), +s.slice(5, 7) - 1, +s.slice(8, 10)) / DAY;
const fromDay = (n) => new Date(n * DAY).toISOString().slice(0, 10);
/**
 * Stats for one category over [from, to] (inclusive ISO dates; from = null means
 * since the first record). A streak counts active days; a day marked by the
 * category's bridgeMetric (e.g. a Duolingo streak freeze) keeps a streak going
 * without adding to it, the way Duolingo counts its own streak.
 */
export function categoryStats(daily, c, from, to) {
    const today = isoDate(new Date());
    const value = (d) => (daily[d]?.[c.metric] ?? 0) * c.scale;
    const bridged = (d) => !!c.bridgeMetric && (daily[d]?.[c.bridgeMetric] ?? 0) > 0;
    const dates = Object.keys(daily).filter((d) => value(d) > 0 || bridged(d)).sort();
    const s = { total: 0, activeDays: 0, goalDays: c.goalMetric ? 0 : null, longest: 0, current: 0 };
    if (dates.length === 0)
        return s;
    const start = from ?? dates[0];
    const end = to < today ? to : today;
    let run = 0;
    for (let n = toDay(start); n <= toDay(end); n++) {
        const d = fromDay(n);
        const v = value(d);
        if (v > 0) {
            s.total += v;
            s.activeDays++;
            run++;
            s.longest = Math.max(s.longest, run);
            const goal = c.goalMetric ? (daily[d]?.[c.goalMetric] ?? 0) : 0;
            if (goal > 0 && v >= goal * c.scale)
                s.goalDays++;
        }
        else if (!bridged(d)) {
            run = 0;
        }
    }
    let n = toDay(today);
    if (value(today) <= 0 && !bridged(today))
        n--; // today not logged yet doesn't break it
    for (const first = toDay(dates[0]); n >= first; n--) {
        const d = fromDay(n);
        if (value(d) > 0)
            s.current++;
        else if (!bridged(d))
            break;
    }
    return s;
}
