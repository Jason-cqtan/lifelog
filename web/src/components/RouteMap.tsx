import { useEffect, useMemo, useRef, useState } from 'react'
// the ESM build is split into files that load on demand (the default build is one 1.9 MB file)
import * as mapboxgl from 'mapbox-gl/esm'
import mapboxWorkerUrl from 'mapbox-gl/dist/esm/worker.js?worker&url'
import 'mapbox-gl/dist/mapbox-gl.css'
import { SPORT_LABEL, type Activity, type SiteConfig } from '../types'
import { useI18n } from '../i18n'
import { decodePolyline } from '../lib/polyline'
import { fmtDuration, fmtNum, fmtSpeed } from '../lib/format'
import { wgs84ToGcj02 } from '../lib/gcj02'
import { WeatherLine } from './ActivityList'

// Set in the admin page and exported in data.json; the build-time VITE_* values
// are the fallback for sites built without one (GitHub Pages).
const ENV_TOKEN = import.meta.env.VITE_MAPBOX_TOKEN as string | undefined
// GCJ-02: turn on if routes sit beside the roads on the China basemap.
const ENV_GCJ02 = import.meta.env.VITE_MAP_GCJ02 === 'true'
// mapbox-gl looks for its worker next to its own file; Vite bundled it elsewhere
mapboxgl.setWorkerUrl(mapboxWorkerUrl)

const MAP_LANG = { zh: 'zh-Hans', en: 'en' } as const
const STYLE = { light: 'mapbox://styles/mapbox/light-v11', dark: 'mapbox://styles/mapbox/dark-v11' }

interface Props {
  config?: SiteConfig
  activities: Activity[]
  theme: 'light' | 'dark'
  focusId: string | null
  onShowInList: (id: string) => void
}

/** All routes of the selected period on a Mapbox map; this module is lazy-loaded. */
export default function RouteMap({ config, activities, theme, focusId, onShowInList }: Props) {
  const token = config?.mapbox_token || ENV_TOKEN
  const shiftGcj02 = config?.map_gcj02 ?? ENV_GCJ02
  const { lang, t } = useI18n()
  const box = useRef<HTMLDivElement>(null)
  const map = useRef<mapboxgl.Map | null>(null)
  const [selected, setSelected] = useState<string | null>(focusId)
  useEffect(() => setSelected(focusId), [focusId])

  const routes = useMemo(() => {
    const features = activities
      .filter((a) => a.polyline)
      .map((a) => {
        const coords = decodePolyline(a.polyline!).map(([lat, lng]) => {
          const [la, ln] = shiftGcj02 ? wgs84ToGcj02(lat, lng) : [lat, lng]
          return [ln, la] as [number, number]
        })
        return {
          type: 'Feature' as const,
          properties: { id: a.id, type: a.type },
          geometry: { type: 'LineString' as const, coordinates: coords },
        }
      })
      .filter((f) => f.geometry.coordinates.length > 1)
    return { type: 'FeatureCollection' as const, features }
  }, [activities])

  // Layers are (re)installed from 'style.load', which fires on the first load
  // and after every setStyle (a theme switch drops all custom layers).
  const routesRef = useRef(routes)
  routesRef.current = routes
  const selectedRef = useRef(selected)
  selectedRef.current = selected
  // countries that contain routes (ISO alpha-2), and the route starts already checked
  const keep = useRef(new Set<string>())
  const seen = useRef(new Map<string, string | null>())

  useEffect(() => {
    if (!token || !box.current) return
    mapboxgl.setAccessToken(token)
    const m = new mapboxgl.Map({
      container: box.current,
      style: STYLE[theme],
      center: [106.56, 29.52],
      zoom: 11,
      language: MAP_LANG[lang],
    })
    // follow the container, not just the window (layout changes, lazy CSS)
    const ro = new ResizeObserver(() => m.resize())
    ro.observe(box.current)
    m.addControl(new mapboxgl.NavigationControl({ showCompass: false }), 'top-right')
    let first = true
    m.on('style.load', () => {
      installLayers(m, routesRef.current, keep.current)
      highlight(m, routesRef.current, selectedRef.current, false)
      if (first && !selectedRef.current) fitAll(m, routesRef.current)
      first = false
    })
    m.on('idle', () => {
      if (classifyCountries(m, routesRef.current, seen.current, keep.current) && m.getLayer('country-mask')) {
        m.setFilter('country-mask', maskFilter(keep.current))
        filterLabels(m, keep.current)
      }
    })
    m.on('click', 'routes-hit', (e) => {
      const props = (e.features?.[0] as { properties?: { id?: string } } | undefined)?.properties
      if (props?.id) setSelected(props.id)
    })
    m.on('mouseenter', 'routes-hit', () => (m.getCanvas().style.cursor = 'pointer'))
    m.on('mouseleave', 'routes-hit', () => (m.getCanvas().style.cursor = ''))
    map.current = m
    return () => {
      ro.disconnect()
      m.remove()
      map.current = null
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    map.current?.setLanguage(MAP_LANG[lang])
  }, [lang])

  const styleRef = useRef(theme)
  useEffect(() => {
    const m = map.current
    if (!m || styleRef.current === theme) return
    styleRef.current = theme
    m.setStyle(STYLE[theme])
  }, [theme])

  // New period selected: swap the data and frame all routes.
  useEffect(() => {
    const m = map.current
    if (!m || !m.isStyleLoaded()) return
    ;(m.getSource('routes') as mapboxgl.GeoJSONSource | undefined)?.setData(routes)
    if (!selectedRef.current) fitAll(m, routes)
  }, [routes])

  useEffect(() => {
    const m = map.current
    if (m && m.isStyleLoaded()) highlight(m, routesRef.current, selected, true)
  }, [selected])

  if (!token) return <p className="empty map-empty">{t.mapNoToken}</p>

  const act = activities.find((a) => a.id === selected)
  return (
    <div className="map-wrap">
      <div ref={box} className="map" />
      <div className="map-count">{t.routesCount(routes.features.length)}</div>
      {routes.features.length === 0 && <div className="map-note">{t.noRoutes}</div>}
      {act && (
        <div className="map-card">
          <button className="map-close" onClick={() => setSelected(null)} aria-label="×">
            ×
          </button>
          <div className="card-title">
            <span className="tag">{SPORT_LABEL[lang][act.type]}</span>
            <span className="name">{act.name || SPORT_LABEL[lang][act.type]}</span>
          </div>
          <div className="card-meta">
            {act.start_local} · {act.source}
          </div>
          <div className="card-nums">
            <span>
              <b>{fmtNum(act.distance_m / 1000, 2)}</b> km
            </span>
            <span>{fmtDuration(act.moving_time_s, t)}</span>
            {fmtSpeed(act) && <span>{fmtSpeed(act)}</span>}
            {!!act.elevation_gain_m && <span>↑{Math.round(act.elevation_gain_m)} m</span>}
          </div>
          {act.weather && <WeatherLine w={act.weather} lang={lang} t={t} />}
          <button className="link-btn" onClick={() => onShowInList(act.id)}>
            {t.showInList} →
          </button>
        </div>
      )}
    </div>
  )
}

type Routes = { type: 'FeatureCollection'; features: { properties: { id: string; type: string }; geometry: { coordinates: [number, number][] } }[] }

// Countries with no routes are painted over with the background color, at every
// zoom, so only places with data show. Which countries those are is worked out
// from the loaded boundary shapes (see classifyCountries).
const WORLDVIEW: mapboxgl.FilterSpecification = [
  'all',
  ['==', ['get', 'disputed'], 'false'],
  ['any', ['==', 'all', ['get', 'worldview']], ['in', 'CN', ['get', 'worldview']]],
]

function maskFilter(keep: Set<string>): mapboxgl.FilterSpecification {
  // until we know where the data is, mask nothing
  if (keep.size === 0) return ['boolean', false]
  return ['all', WORLDVIEW, ['!', ['in', ['get', 'iso_3166_1'], ['literal', [...keep]]]]]
}

// Basemap labels can still draw above the mask, so they are filtered too: label
// features carry their country code; ones without it (e.g. oceans) stay.
const baseFilters = new WeakMap<mapboxgl.Map, Map<string, unknown>>()

function filterLabels(m: mapboxgl.Map, keep: Set<string>) {
  if (keep.size === 0) return
  let saved = baseFilters.get(m)
  if (!saved) baseFilters.set(m, (saved = new Map()))
  const clause = ['any', ['!', ['has', 'iso_3166_1']], ['in', ['get', 'iso_3166_1'], ['literal', [...keep]]]]
  for (const layer of m.getStyle()?.layers ?? []) {
    if (layer.type !== 'symbol' || layer.id.startsWith('routes')) continue
    if (!saved.has(layer.id)) saved.set(layer.id, (layer as { filter?: unknown }).filter)
    const base = saved.get(layer.id)
    try {
      m.setFilter(layer.id, (base ? ['all', base, clause] : clause) as mapboxgl.FilterSpecification)
    } catch {
      // a legacy-syntax filter can't be combined with an expression; leave it
    }
  }
}

function installLayers(m: mapboxgl.Map, routes: Routes, keep: Set<string>) {
  baseFilters.delete(m) // a new style brings new label layers
  filterLabels(m, keep)
  const css = getComputedStyle(document.documentElement)
  const color = (v: string) => css.getPropertyValue(v).trim()
  if (!m.getSource('countries')) m.addSource('countries', { type: 'vector', url: 'mapbox://mapbox.country-boundaries-v1' })
  // above every basemap layer (labels too), below our routes
  m.addLayer({
    id: 'country-mask',
    type: 'fill',
    source: 'countries',
    'source-layer': 'country_boundaries',
    filter: maskFilter(keep),
    paint: { 'fill-color': color('--surface'), 'fill-opacity': 1 },
  })
  if (!m.getSource('routes')) m.addSource('routes', { type: 'geojson', data: routes as mapboxgl.GeoJSONSourceSpecification['data'] })
  const lineColor: mapboxgl.ExpressionSpecification = [
    'match', ['get', 'type'],
    'run', color('--c-run'), 'ride', color('--c-ride'), 'hike', color('--c-hike'),
    color('--text-secondary'),
  ]
  const layout = { 'line-join': 'round', 'line-cap': 'round' } as const
  m.addLayer({ id: 'routes', type: 'line', source: 'routes', layout, paint: { 'line-color': lineColor, 'line-width': 2, 'line-opacity': 0.5 } })
  m.addLayer({ id: 'routes-hl', type: 'line', source: 'routes', layout, filter: ['==', ['get', 'id'], ''], paint: { 'line-color': lineColor, 'line-width': 5 } })
  // wide invisible line: a comfortable click target
  m.addLayer({ id: 'routes-hit', type: 'line', source: 'routes', layout, paint: { 'line-color': '#000', 'line-width': 14, 'line-opacity': 0 } })
}

function highlight(m: mapboxgl.Map, routes: Routes, id: string | null, animate: boolean) {
  if (!m.getLayer('routes-hl')) return
  m.setFilter('routes-hl', ['==', ['get', 'id'], id ?? ''])
  const f = routes.features.find((x) => x.properties.id === id)
  if (f) fit(m, f.geometry.coordinates, animate)
}

function fitAll(m: mapboxgl.Map, routes: Routes) {
  fit(m, routes.features.flatMap((f) => f.geometry.coordinates), false)
}

type Ring = [number, number][]

function inRing([x, y]: [number, number], ring: Ring): boolean {
  let inside = false
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i]
    const [xj, yj] = ring[j]
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside
  }
  return inside
}

function inPolygon(pt: [number, number], rings: Ring[]): boolean {
  return inRing(pt, rings[0]) && !rings.slice(1).some((h) => inRing(pt, h))
}

/**
 * Finds the country of each route start that isn't classified yet, using the
 * boundary shapes in the tiles loaded for the current view. Returns true when
 * the set of countries grew.
 */
function classifyCountries(m: mapboxgl.Map, routes: Routes, seen: Map<string, string | null>, keep: Set<string>): boolean {
  const pending: [string, [number, number]][] = []
  for (const f of routes.features) {
    const [lng, lat] = f.geometry.coordinates[0]
    const key = `${lng.toFixed(1)},${lat.toFixed(1)}`
    if (!seen.has(key)) pending.push([key, [lng, lat]])
  }
  if (pending.length === 0 || !m.getSource('countries')) return false
  type Shape = { geometry: { type: string; coordinates: unknown }; properties?: { iso_3166_1?: string } | null }
  const shapes = m.querySourceFeatures('countries', { sourceLayer: 'country_boundaries' }) as unknown as Shape[]
  if (shapes.length === 0) return false
  let grew = false
  for (const [key, pt] of pending) {
    if (seen.has(key)) continue
    const bounds = m.getBounds()
    if (!bounds || !bounds.contains(pt)) continue // its tiles may not be loaded yet
    let iso: string | null = null
    for (const f of shapes) {
      const g = f.geometry
      const polys = g.type === 'Polygon' ? [g.coordinates as Ring[]] : g.type === 'MultiPolygon' ? (g.coordinates as Ring[][]) : []
      if (polys.some((rings) => inPolygon(pt, rings))) {
        iso = String(f.properties?.iso_3166_1 ?? '')
        break
      }
    }
    seen.set(key, iso)
    if (iso && !keep.has(iso)) {
      keep.add(iso)
      grew = true
    }
  }
  return grew
}

function fit(m: mapboxgl.Map, coords: [number, number][], animate: boolean) {
  if (coords.length === 0) return
  const b = new mapboxgl.LngLatBounds(coords[0], coords[0])
  for (const c of coords) b.extend(c)
  m.fitBounds(b, { padding: 48, maxZoom: 15, duration: animate ? 800 : 0 })
}
