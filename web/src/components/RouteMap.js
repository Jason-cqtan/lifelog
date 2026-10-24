import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useEffect, useMemo, useRef, useState } from 'react';
import mapboxgl from 'mapbox-gl';
import 'mapbox-gl/dist/mapbox-gl.css';
import { SPORT_LABEL } from '../types';
import { useI18n } from '../i18n';
import { decodePolyline } from '../lib/polyline';
import { fmtDuration, fmtNum, fmtSpeed } from '../lib/format';
import { wgs84ToGcj02 } from '../lib/gcj02';
import { WeatherLine } from './ActivityList';
const TOKEN = import.meta.env.VITE_MAPBOX_TOKEN;
// Set VITE_MAP_GCJ02=true if routes sit beside the roads on the China basemap.
const SHIFT_GCJ02 = import.meta.env.VITE_MAP_GCJ02 === 'true';
const MAP_LANG = { zh: 'zh-Hans', en: 'en' };
const STYLE = { light: 'mapbox://styles/mapbox/light-v11', dark: 'mapbox://styles/mapbox/dark-v11' };
/** All routes of the selected period on a Mapbox map; this module is lazy-loaded. */
export default function RouteMap({ activities, theme, focusId, onShowInList }) {
    const { lang, t } = useI18n();
    const box = useRef(null);
    const map = useRef(null);
    const [selected, setSelected] = useState(focusId);
    useEffect(() => setSelected(focusId), [focusId]);
    const routes = useMemo(() => {
        const features = activities
            .filter((a) => a.polyline)
            .map((a) => {
            const coords = decodePolyline(a.polyline).map(([lat, lng]) => {
                const [la, ln] = SHIFT_GCJ02 ? wgs84ToGcj02(lat, lng) : [lat, lng];
                return [ln, la];
            });
            return {
                type: 'Feature',
                properties: { id: a.id, type: a.type },
                geometry: { type: 'LineString', coordinates: coords },
            };
        })
            .filter((f) => f.geometry.coordinates.length > 1);
        return { type: 'FeatureCollection', features };
    }, [activities]);
    // Layers are (re)installed from 'style.load', which fires on the first load
    // and after every setStyle (a theme switch drops all custom layers).
    const routesRef = useRef(routes);
    routesRef.current = routes;
    const selectedRef = useRef(selected);
    selectedRef.current = selected;
    // countries that contain routes (ISO alpha-2), and the route starts already checked
    const keep = useRef(new Set());
    const seen = useRef(new Map());
    useEffect(() => {
        if (!TOKEN || !box.current)
            return;
        mapboxgl.accessToken = TOKEN;
        const m = new mapboxgl.Map({
            container: box.current,
            style: STYLE[theme],
            center: [106.56, 29.52],
            zoom: 11,
            language: MAP_LANG[lang],
        });
        // follow the container, not just the window (layout changes, lazy CSS)
        const ro = new ResizeObserver(() => m.resize());
        ro.observe(box.current);
        m.addControl(new mapboxgl.NavigationControl({ showCompass: false }), 'top-right');
        let first = true;
        m.on('style.load', () => {
            installLayers(m, routesRef.current, keep.current);
            highlight(m, routesRef.current, selectedRef.current, false);
            if (first && !selectedRef.current)
                fitAll(m, routesRef.current);
            first = false;
        });
        m.on('idle', () => {
            if (classifyCountries(m, routesRef.current, seen.current, keep.current) && m.getLayer('country-mask')) {
                m.setFilter('country-mask', maskFilter(keep.current));
                filterLabels(m, keep.current);
            }
        });
        m.on('click', 'routes-hit', (e) => {
            const props = e.features?.[0]?.properties;
            if (props?.id)
                setSelected(props.id);
        });
        m.on('mouseenter', 'routes-hit', () => (m.getCanvas().style.cursor = 'pointer'));
        m.on('mouseleave', 'routes-hit', () => (m.getCanvas().style.cursor = ''));
        map.current = m;
        return () => {
            ro.disconnect();
            m.remove();
            map.current = null;
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);
    useEffect(() => {
        map.current?.setLanguage(MAP_LANG[lang]);
    }, [lang]);
    const styleRef = useRef(theme);
    useEffect(() => {
        const m = map.current;
        if (!m || styleRef.current === theme)
            return;
        styleRef.current = theme;
        m.setStyle(STYLE[theme]);
    }, [theme]);
    // New period selected: swap the data and frame all routes.
    useEffect(() => {
        const m = map.current;
        if (!m || !m.isStyleLoaded())
            return;
        m.getSource('routes')?.setData(routes);
        if (!selectedRef.current)
            fitAll(m, routes);
    }, [routes]);
    useEffect(() => {
        const m = map.current;
        if (m && m.isStyleLoaded())
            highlight(m, routesRef.current, selected, true);
    }, [selected]);
    if (!TOKEN)
        return _jsx("p", { className: "empty map-empty", children: t.mapNoToken });
    const act = activities.find((a) => a.id === selected);
    return (_jsxs("div", { className: "map-wrap", children: [_jsx("div", { ref: box, className: "map" }), _jsx("div", { className: "map-count", children: t.routesCount(routes.features.length) }), routes.features.length === 0 && _jsx("div", { className: "map-note", children: t.noRoutes }), act && (_jsxs("div", { className: "map-card", children: [_jsx("button", { className: "map-close", onClick: () => setSelected(null), "aria-label": "\u00D7", children: "\u00D7" }), _jsxs("div", { className: "card-title", children: [_jsx("span", { className: "tag", children: SPORT_LABEL[lang][act.type] }), _jsx("span", { className: "name", children: act.name || SPORT_LABEL[lang][act.type] })] }), _jsxs("div", { className: "card-meta", children: [act.start_local, " \u00B7 ", act.source] }), _jsxs("div", { className: "card-nums", children: [_jsxs("span", { children: [_jsx("b", { children: fmtNum(act.distance_m / 1000, 2) }), " km"] }), _jsx("span", { children: fmtDuration(act.moving_time_s, t) }), fmtSpeed(act) && _jsx("span", { children: fmtSpeed(act) }), !!act.elevation_gain_m && _jsxs("span", { children: ["\u2191", Math.round(act.elevation_gain_m), " m"] })] }), act.weather && _jsx(WeatherLine, { w: act.weather, lang: lang, t: t }), _jsxs("button", { className: "link-btn", onClick: () => onShowInList(act.id), children: [t.showInList, " \u2192"] })] }))] }));
}
// Countries with no routes are painted over with the background color, at every
// zoom, so only places with data show. Which countries those are is worked out
// from the loaded boundary shapes (see classifyCountries).
const WORLDVIEW = [
    'all',
    ['==', ['get', 'disputed'], 'false'],
    ['any', ['==', 'all', ['get', 'worldview']], ['in', 'CN', ['get', 'worldview']]],
];
function maskFilter(keep) {
    // until we know where the data is, mask nothing
    if (keep.size === 0)
        return ['boolean', false];
    return ['all', WORLDVIEW, ['!', ['in', ['get', 'iso_3166_1'], ['literal', [...keep]]]]];
}
// Basemap labels can still draw above the mask, so they are filtered too: label
// features carry their country code; ones without it (e.g. oceans) stay.
const baseFilters = new WeakMap();
function filterLabels(m, keep) {
    if (keep.size === 0)
        return;
    let saved = baseFilters.get(m);
    if (!saved)
        baseFilters.set(m, (saved = new Map()));
    const clause = ['any', ['!', ['has', 'iso_3166_1']], ['in', ['get', 'iso_3166_1'], ['literal', [...keep]]]];
    for (const layer of m.getStyle()?.layers ?? []) {
        if (layer.type !== 'symbol' || layer.id.startsWith('routes'))
            continue;
        if (!saved.has(layer.id))
            saved.set(layer.id, layer.filter);
        const base = saved.get(layer.id);
        try {
            m.setFilter(layer.id, (base ? ['all', base, clause] : clause));
        }
        catch {
            // a legacy-syntax filter can't be combined with an expression; leave it
        }
    }
}
function installLayers(m, routes, keep) {
    baseFilters.delete(m); // a new style brings new label layers
    filterLabels(m, keep);
    const css = getComputedStyle(document.documentElement);
    const color = (v) => css.getPropertyValue(v).trim();
    if (!m.getSource('countries'))
        m.addSource('countries', { type: 'vector', url: 'mapbox://mapbox.country-boundaries-v1' });
    // above every basemap layer (labels too), below our routes
    m.addLayer({
        id: 'country-mask',
        type: 'fill',
        source: 'countries',
        'source-layer': 'country_boundaries',
        filter: maskFilter(keep),
        paint: { 'fill-color': color('--surface'), 'fill-opacity': 1 },
    });
    if (!m.getSource('routes'))
        m.addSource('routes', { type: 'geojson', data: routes });
    const lineColor = [
        'match', ['get', 'type'],
        'run', color('--c-run'), 'ride', color('--c-ride'), 'hike', color('--c-hike'),
        color('--text-secondary'),
    ];
    const layout = { 'line-join': 'round', 'line-cap': 'round' };
    m.addLayer({ id: 'routes', type: 'line', source: 'routes', layout, paint: { 'line-color': lineColor, 'line-width': 2, 'line-opacity': 0.5 } });
    m.addLayer({ id: 'routes-hl', type: 'line', source: 'routes', layout, filter: ['==', ['get', 'id'], ''], paint: { 'line-color': lineColor, 'line-width': 5 } });
    // wide invisible line: a comfortable click target
    m.addLayer({ id: 'routes-hit', type: 'line', source: 'routes', layout, paint: { 'line-color': '#000', 'line-width': 14, 'line-opacity': 0 } });
}
function highlight(m, routes, id, animate) {
    if (!m.getLayer('routes-hl'))
        return;
    m.setFilter('routes-hl', ['==', ['get', 'id'], id ?? '']);
    const f = routes.features.find((x) => x.properties.id === id);
    if (f)
        fit(m, f.geometry.coordinates, animate);
}
function fitAll(m, routes) {
    fit(m, routes.features.flatMap((f) => f.geometry.coordinates), false);
}
function inRing([x, y], ring) {
    let inside = false;
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
        const [xi, yi] = ring[i];
        const [xj, yj] = ring[j];
        if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi)
            inside = !inside;
    }
    return inside;
}
function inPolygon(pt, rings) {
    return inRing(pt, rings[0]) && !rings.slice(1).some((h) => inRing(pt, h));
}
/**
 * Finds the country of each route start that isn't classified yet, using the
 * boundary shapes in the tiles loaded for the current view. Returns true when
 * the set of countries grew.
 */
function classifyCountries(m, routes, seen, keep) {
    const pending = [];
    for (const f of routes.features) {
        const [lng, lat] = f.geometry.coordinates[0];
        const key = `${lng.toFixed(1)},${lat.toFixed(1)}`;
        if (!seen.has(key))
            pending.push([key, [lng, lat]]);
    }
    if (pending.length === 0 || !m.getSource('countries'))
        return false;
    const shapes = m.querySourceFeatures('countries', { sourceLayer: 'country_boundaries' });
    if (shapes.length === 0)
        return false;
    let grew = false;
    for (const [key, pt] of pending) {
        if (seen.has(key))
            continue;
        const bounds = m.getBounds();
        if (!bounds || !bounds.contains(pt))
            continue; // its tiles may not be loaded yet
        let iso = null;
        for (const f of shapes) {
            const g = f.geometry;
            const polys = g.type === 'Polygon' ? [g.coordinates] : g.type === 'MultiPolygon' ? g.coordinates : [];
            if (polys.some((rings) => inPolygon(pt, rings))) {
                iso = String(f.properties?.iso_3166_1 ?? '');
                break;
            }
        }
        seen.set(key, iso);
        if (iso && !keep.has(iso)) {
            keep.add(iso);
            grew = true;
        }
    }
    return grew;
}
function fit(m, coords, animate) {
    if (coords.length === 0)
        return;
    const b = new mapboxgl.LngLatBounds(coords[0], coords[0]);
    for (const c of coords)
        b.extend(c);
    m.fitBounds(b, { padding: 48, maxZoom: 15, duration: animate ? 800 : 0 });
}
