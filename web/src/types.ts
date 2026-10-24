// Mirrors internal/export/export.go.
import type { Lang } from './i18n'

export type SportType = 'run' | 'ride' | 'hike' | 'walk' | 'swim' | 'workout'

export interface Activity {
  id: string
  source: string
  type: SportType
  name?: string
  date: string
  start_local: string
  distance_m: number
  moving_time_s: number
  elevation_gain_m?: number
  avg_hr?: number
  polyline?: string
  weather?: Weather
}

export interface Weather {
  temp_c: number
  feels_like_c: number
  humidity: number
  wind_ms: number
  wind_dir?: string
  desc?: string
}

export interface Data {
  generated_at: string
  timezone: string
  activities: Activity[]
  daily: Record<string, Record<string, number>>
}

export interface Category {
  key: string
  label: Record<Lang, string>
  metric: string
  /** turns the raw daily value into what is shown */
  scale: number
  unit: Record<Lang, string>
  color: string
  /** daily metric holding a per-day target; the panel then counts days that met it */
  goalMetric?: string
}

// Each category gets its own heatmap (small multiples), so color only has to
// identify the panel; it is never the sole label. Order keeps the two greens
// (steps, Duolingo) apart.
export const CATEGORIES: Category[] = [
  { key: 'run', label: { zh: '跑步', en: 'Running' }, metric: 'run_km', scale: 1, unit: { zh: 'km', en: 'km' }, color: 'var(--c-run)' },
  { key: 'ride', label: { zh: '骑行', en: 'Cycling' }, metric: 'ride_km', scale: 1, unit: { zh: 'km', en: 'km' }, color: 'var(--c-ride)' },
  { key: 'hike', label: { zh: '徒步 / 爬山', en: 'Hiking' }, metric: 'hike_km', scale: 1, unit: { zh: 'km', en: 'km' }, color: 'var(--c-hike)' },
  { key: 'steps', label: { zh: '步数', en: 'Steps' }, metric: 'garmin_steps', scale: 1, unit: { zh: '步', en: 'steps' }, color: 'var(--c-steps)', goalMetric: 'garmin_step_goal' },
  { key: 'spotify', label: { zh: 'Spotify', en: 'Spotify' }, metric: 'spotify_minutes', scale: 1 / 60, unit: { zh: '小时', en: 'h' }, color: 'var(--c-spotify)' },
  { key: 'duolingo', label: { zh: '多邻国', en: 'Duolingo' }, metric: 'duolingo_minutes', scale: 1, unit: { zh: '分钟', en: 'min' }, color: 'var(--c-duolingo)' },
  { key: 'github', label: { zh: 'GitHub', en: 'GitHub' }, metric: 'github_contributions', scale: 1, unit: { zh: '次贡献', en: 'contributions' }, color: 'var(--c-github)' },
]

export const SPORT_LABEL: Record<Lang, Record<SportType, string>> = {
  zh: { run: '跑步', ride: '骑行', hike: '徒步', walk: '步行', swim: '游泳', workout: '训练' },
  en: { run: 'Run', ride: 'Ride', hike: 'Hike', walk: 'Walk', swim: 'Swim', workout: 'Workout' },
}
