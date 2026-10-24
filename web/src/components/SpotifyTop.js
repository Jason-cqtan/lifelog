import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useState } from 'react';
import { load, save, useI18n } from '../i18n';
const RANGES = ['short_term', 'medium_term', 'long_term'];
const STEP = 10;
/** Spotify's own top artists and songs over its rolling windows (not the year filter). */
export function SpotifyTop({ top }) {
    const { t, lang } = useI18n();
    const [range, setRangeState] = useState(() => {
        const saved = load('spotifyRange');
        return RANGES.includes(saved ?? '') ? saved : 'short_term';
    });
    const setRange = (r) => {
        setRangeState(r);
        save('spotifyRange', r);
    };
    const [shown, setShown] = useState(STEP);
    const lists = top.ranges[range] ?? { artists: [], tracks: [] };
    const label = { short_term: t.range4w, medium_term: t.range6m, long_term: t.range1y };
    return (_jsxs("section", { className: "panel spotify-top", children: [_jsxs("header", { className: "panel-head", children: [_jsxs("h3", { children: [_jsx("span", { className: "swatch", style: { background: 'var(--c-spotify)' } }), t.spotifyTop, _jsx("span", { className: "hint", title: t.spotifyTopNote, children: "\u24D8" })] }), _jsx("div", { className: "seg seg-sm", role: "group", children: RANGES.map((r) => (_jsx("button", { className: r === range ? 'on' : '', "aria-pressed": r === range, onClick: () => setRange(r), children: label[r] }, r))) })] }), _jsxs("div", { className: "top-cols", children: [_jsxs("div", { children: [_jsx("h4", { children: t.topArtists }), _jsx("ol", { className: "top-list", children: lists.artists.slice(0, shown).map((a, i) => (_jsxs("li", { children: [_jsx("span", { className: "top-rank", children: i + 1 }), a.image ? _jsx("img", { src: a.image, alt: "", className: "round", loading: "lazy" }) : _jsx("span", { className: "img-ph round" }), _jsxs("span", { className: "top-text", children: [_jsx("b", { children: a.name }), a.genres?.length ? _jsx("small", { children: a.genres.slice(0, 2).join(' · ') }) : null] })] }, a.id))) })] }), _jsxs("div", { children: [_jsx("h4", { children: t.topTracks }), _jsx("ol", { className: "top-list", children: lists.tracks.slice(0, shown).map((s, i) => (_jsxs("li", { children: [_jsx("span", { className: "top-rank", children: i + 1 }), s.image ? _jsx("img", { src: s.image, alt: "", loading: "lazy" }) : _jsx("span", { className: "img-ph" }), _jsxs("span", { className: "top-text", children: [_jsx("b", { children: s.name }), _jsx("small", { children: s.artist })] })] }, s.id))) })] })] }), shown < Math.max(lists.artists.length, lists.tracks.length) && (_jsx("button", { className: "more", onClick: () => setShown(shown + STEP), children: t.showMore })), _jsx("p", { className: "music-note", children: t.spotifyUpdated(new Date(top.updated_at).toLocaleString(lang === 'zh' ? 'zh-CN' : 'en-US')) })] }));
}
