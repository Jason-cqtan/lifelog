import type { Activity } from '../types'

export function fmtNum(v: number, digits = 1): string {
  if (v >= 1000) return Math.round(v).toLocaleString('zh-CN')
  return Number(v.toFixed(digits)).toLocaleString('zh-CN')
}

export function fmtDuration(sec: number): string {
  const h = Math.floor(sec / 3600)
  const m = Math.round((sec % 3600) / 60)
  return h > 0 ? `${h}小时${m}分` : `${m}分钟`
}

/** Pace for foot sports (min/km), speed for rides (km/h). */
export function fmtSpeed(a: Activity): string | null {
  if (!a.distance_m || !a.moving_time_s) return null
  const km = a.distance_m / 1000
  if (a.type === 'ride') return `${(km / (a.moving_time_s / 3600)).toFixed(1)} km/h`
  if (a.type === 'swim') return null
  const pace = a.moving_time_s / km
  const m = Math.floor(pace / 60)
  const s = Math.round(pace % 60)
  return `${m}'${String(s).padStart(2, '0')}"/km`
}

/** Local YYYY-MM-DD for a Date (the data is already bucketed in the export timezone). */
export function isoDate(d: Date): string {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

export function addDays(d: Date, n: number): Date {
  const out = new Date(d)
  out.setDate(out.getDate() + n)
  return out
}
