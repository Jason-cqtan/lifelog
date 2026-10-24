import type { Activity } from '../types'
import type { Dict } from '../i18n'

export function fmtNum(v: number, digits = 1): string {
  if (v >= 1000) return Math.round(v).toLocaleString()
  return Number(v.toFixed(digits)).toLocaleString()
}

export function fmtDuration(sec: number, t: Dict): string {
  return t.duration(Math.floor(sec / 3600), Math.round((sec % 3600) / 60))
}

/** Pace for foot sports (min/km), speed for rides (km/h). */
export function fmtSpeed(a: Activity): string | null {
  if (!a.distance_m || !a.moving_time_s) return null
  const km = a.distance_m / 1000
  if (a.type === 'ride') return `${(km / (a.moving_time_s / 3600)).toFixed(1)} km/h`
  if (a.type === 'swim') return null
  return fmtPace(a.moving_time_s / km)
}

/** Seconds per km as m'ss"/km; rounds first so 5:59.6 becomes 6'00", not 5'60". */
export function fmtPace(secPerKm: number): string {
  const p = Math.round(secPerKm)
  return `${Math.floor(p / 60)}'${String(p % 60).padStart(2, '0')}"/km`
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

/** "169 spm" for foot sports, "85 rpm" for rides. */
export function fmtCadence(a: Pick<Activity, 'type' | 'avg_cadence'>): string | null {
  if (!a.avg_cadence) return null
  return `${Math.round(a.avg_cadence)} ${a.type === 'ride' ? 'rpm' : 'spm'}`
}
