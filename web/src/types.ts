// Mirrors internal/export/export.go.

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
}

export interface Data {
  generated_at: string
  timezone: string
  activities: Activity[]
  daily: Record<string, Record<string, number>>
}

export interface Category {
  key: string
  label: string
  metric: string
  /** turns the raw daily value into what is shown */
  scale: number
  unit: string
  color: string
}

// Each category gets its own heatmap (small multiples), so color only has to
// identify the panel; it is never the sole label.
export const CATEGORIES: Category[] = [
  { key: 'run', label: '跑步', metric: 'run_km', scale: 1, unit: 'km', color: 'var(--c-run)' },
  { key: 'ride', label: '骑行', metric: 'ride_km', scale: 1, unit: 'km', color: 'var(--c-ride)' },
  { key: 'hike', label: '徒步 / 爬山', metric: 'hike_km', scale: 1, unit: 'km', color: 'var(--c-hike)' },
  { key: 'duolingo', label: '多邻国', metric: 'duolingo_minutes', scale: 1, unit: '分钟', color: 'var(--c-duolingo)' },
  { key: 'spotify', label: 'Spotify', metric: 'spotify_minutes', scale: 1 / 60, unit: '小时', color: 'var(--c-spotify)' },
  { key: 'github', label: 'GitHub', metric: 'github_contributions', scale: 1, unit: '次贡献', color: 'var(--c-github)' },
]

export const SPORT_LABEL: Record<SportType, string> = {
  run: '跑步',
  ride: '骑行',
  hike: '徒步',
  walk: '步行',
  swim: '游泳',
  workout: '训练',
}
