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
  /** steps per minute (runs, walks, hikes) or pedal rpm (rides) */
  avg_cadence?: number
  stride_m?: number
  /** only once the map is unlocked (merged in from the sealed routes) */
  polyline?: string
  /** whether a sealed route exists for this activity */
  has_route?: boolean
  weather?: Weather
  /** fastest elapsed seconds over a distance inside this run, keyed by meters */
  best_efforts?: Record<string, number>
}

export interface Weather {
  temp_c: number
  feels_like_c: number
  humidity: number
  wind_ms: number
  wind_dir?: string
  desc?: string
}

export interface MusicStats {
  ms: number
  plays: number
  artists: number
  tracks: number
  top_artists: { name: string; ms: number; plays: number; tracks: number }[]
  top_tracks: { track: string; artist?: string; ms: number; plays: number }[]
  /** listening ms by weekday (0 = Monday) and hour */
  hours: number[][]
}

export interface SpotifyTop {
  updated_at: string
  /** short_term ~4 weeks, medium_term ~6 months, long_term ~1 year */
  ranges: Record<string, {
    artists: { id: string; name: string; image?: string; genres?: string[] }[]
    tracks: { id: string; name: string; artist: string; album?: string; image?: string }[]
  }>
}

export interface DuolingoData {
  updated_at: string
  tracked_since: string
  total_xp: number
  current_course?: string
  courses: { id: string; title: string; language: string; xp: number }[]
  /** year or "all" -> course id -> XP gained and estimated minutes */
  periods?: Record<string, Record<string, { xp: number; minutes: number }>>
}

export interface Data {
  generated_at: string
  timezone: string
  activities: Activity[]
  daily: Record<string, Record<string, number>>
  /** keyed by year and "all" */
  music?: Record<string, MusicStats>
  spotify_top?: SpotifyTop
  duolingo?: DuolingoData
  /** set when the routes were exported, sealed behind a question */
  routes?: RouteLock
}

export interface RouteLock {
  question: string
  /** relative to data.json */
  file: string
  /** PBKDF2 iterations */
  iter: number
}

/** A heatmap drill-down: show one sport's activities in a day ('YYYY-MM-DD') or month ('YYYY-MM'). */
export interface Drill {
  type: SportType
  period: string
  seq: number
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
  /** daily metric marking days that keep a streak alive without counting as active */
  bridgeMetric?: string
  /** sport behind the metric; its heatmap cells link to those activities */
  sport?: SportType
}

// Each category gets its own heatmap (small multiples), so color only has to
// identify the panel; it is never the sole label. Order keeps the two greens
// (steps, Duolingo) apart.
export const CATEGORIES: Category[] = [
  { key: 'run', label: { zh: '跑步', en: 'Running' }, metric: 'run_km', scale: 1, unit: { zh: 'km', en: 'km' }, color: 'var(--c-run)', sport: 'run' },
  { key: 'ride', label: { zh: '骑行', en: 'Cycling' }, metric: 'ride_km', scale: 1, unit: { zh: 'km', en: 'km' }, color: 'var(--c-ride)', sport: 'ride' },
  { key: 'hike', label: { zh: '徒步 / 爬山', en: 'Hiking' }, metric: 'hike_km', scale: 1, unit: { zh: 'km', en: 'km' }, color: 'var(--c-hike)', sport: 'hike' },
  { key: 'steps', label: { zh: '步数', en: 'Steps' }, metric: 'garmin_steps', scale: 1, unit: { zh: '步', en: 'steps' }, color: 'var(--c-steps)', goalMetric: 'garmin_step_goal' },
  { key: 'spotify', label: { zh: 'Spotify', en: 'Spotify' }, metric: 'spotify_minutes', scale: 1 / 60, unit: { zh: '小时', en: 'h' }, color: 'var(--c-spotify)' },
  { key: 'duolingo', label: { zh: '多邻国', en: 'Duolingo' }, metric: 'duolingo_minutes', scale: 1, unit: { zh: '分钟', en: 'min' }, color: 'var(--c-duolingo)', bridgeMetric: 'duolingo_streak_protected' },
  { key: 'github', label: { zh: 'GitHub', en: 'GitHub' }, metric: 'github_contributions', scale: 1, unit: { zh: '次贡献', en: 'contributions' }, color: 'var(--c-github)' },
]

export const SPORT_LABEL: Record<Lang, Record<SportType, string>> = {
  zh: { run: '跑步', ride: '骑行', hike: '徒步', walk: '步行', swim: '游泳', workout: '训练' },
  en: { run: 'Run', ride: 'Ride', hike: 'Hike', walk: 'Walk', swim: 'Swim', workout: 'Workout' },
}
