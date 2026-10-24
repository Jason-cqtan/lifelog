import { useEffect, useMemo, useRef, useState } from 'react'
import mapboxgl from 'mapbox-gl'
import 'mapbox-gl/dist/mapbox-gl.css'
import { SPORT_LABEL, type Activity } from '../types'
import { useI18n } from '../i18n'
import { decodePolyline } from '../lib/polyline'
import { fmtDuration, fmtNum, fmtSpeed } from '../lib/format'
import { wgs84ToGcj02 } from '../lib/gcj02'
import { WeatherLine } from './ActivityList'

const TOKEN = import.meta.env.VITE_MAPBOX_TOKEN as string | undefined
// Set VITE_MAP_GCJ02=true if routes sit beside the roads on the China basemap.
const SHIFT_GCJ02 = import.meta.env.VITE_MAP_GCJ02 === 'true'
const STYLE = { light: 'mapbox://styles/mapbox/light-v11', dark: 'mapbox://styles/mapbox/dark-v11' }

interface Props {
  activities: Activity[]
  theme: 'light' | 'dark'
  focusId: string | null
  onShowInList: (id: string) => void
}

/** All routes of the selected period on a Mapbox map; this module is lazy-loaded. */
export default function RouteMap({ activities, theme, focusId, onShowInList }: Props) {
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
          const [la, ln] = SHIFT_GCJ02 ? wgs84ToGcj02(lat, lng) : [lat, lng]
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

  useEffect(() => {
    if (!TOKEN || !box.current) return
    mapboxgl.accessToken = TOKEN
    const m = new mapboxgl.Map({ container: box.current, style: STYLE[theme], center: [106.56, 29.52], zoom: 11 })
    m.addControl(new mapboxgl.NavigationControl({ showCompass: false }), 'top-right')
    let first = true
    m.on('style.load', () => {
      installLayers(m, routesRef.current)
      highlight(m, routesRef.current, selectedRef.current, false)
      if (first && !selectedRef.current) fitAll(m, routesRef.current)
      first = false
    })
    m.on('click', 'routes-hit', (e) => {
      const props = (e.features?.[0] as { properties?: { id?: string } } | undefined)?.properties
      if (props?.id) setSelected(props.id)
    })
    m.on('mouseenter', 'routes-hit', () => (m.getCanvas().style.cursor = 'pointer'))
    m.on('mouseleave', 'routes-hit', () => (m.getCanvas().style.cursor = ''))
    map.current = m
    return () => {
      m.remove()
      map.current = null
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

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

  if (!TOKEN) return <p className="empty map-empty">{t.mapNoToken}</p>

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

function installLayers(m: mapboxgl.Map, routes: Routes) {
  const css = getComputedStyle(document.documentElement)
  const color = (v: string) => css.getPropertyValue(v).trim()
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

function fit(m: mapboxgl.Map, coords: [number, number][], animate: boolean) {
  if (coords.length === 0) return
  const b = new mapboxgl.LngLatBounds(coords[0], coords[0])
  for (const c of coords) b.extend(c)
  m.fitBounds(b, { padding: 48, maxZoom: 15, duration: animate ? 800 : 0 })
}
