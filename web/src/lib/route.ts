import type { Activity } from '../types'
import { decodePolyline } from './polyline'

type XY = [number, number]

/** Polyline -> local planar meters (equirectangular around the route; fine at city scale). */
export function toMeters(polyline: string): XY[] {
  const pts = decodePolyline(polyline)
  if (pts.length === 0) return []
  const lat0 = (pts.reduce((s, p) => s + p[0], 0) / pts.length) * (Math.PI / 180)
  const kx = 111320 * Math.cos(lat0)
  return pts.map(([la, ln]) => [ln * kx, la * 110540])
}

function length(pts: XY[]): number {
  let d = 0
  for (let i = 1; i < pts.length; i++) d += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1])
  return d
}

/** n points evenly spaced along the path. */
function resample(pts: XY[], n: number): XY[] {
  const total = length(pts)
  if (pts.length < 2 || total === 0) return []
  const out: XY[] = []
  let seg = 1
  let walked = 0
  for (let k = 0; k < n; k++) {
    const target = (total * k) / (n - 1)
    while (seg < pts.length - 1 && walked + Math.hypot(pts[seg][0] - pts[seg - 1][0], pts[seg][1] - pts[seg - 1][1]) < target) {
      walked += Math.hypot(pts[seg][0] - pts[seg - 1][0], pts[seg][1] - pts[seg - 1][1])
      seg++
    }
    const [x0, y0] = pts[seg - 1]
    const [x1, y1] = pts[seg]
    const L = Math.hypot(x1 - x0, y1 - y0) || 1
    const f = Math.min(1, Math.max(0, (target - walked) / L))
    out.push([x0 + (x1 - x0) * f, y0 + (y1 - y0) * f])
  }
  return out
}

const SAMPLES = 32
// Two tracks are the same route when their resampled points are on average this
// close (meters), in either direction, and their lengths are similar.
const SAME_ROUTE_M = 300
const LENGTH_RATIO = 1.4

function meanGap(a: XY[], b: XY[]): number {
  let fwd = 0
  let rev = 0
  for (let i = 0; i < a.length; i++) {
    fwd += Math.hypot(a[i][0] - b[i][0], a[i][1] - b[i][1])
    const r = b[b.length - 1 - i]
    rev += Math.hypot(a[i][0] - r[0], a[i][1] - r[1])
  }
  return Math.min(fwd, rev) / a.length
}

export interface RouteGroup {
  /** the newest activity: its track is drawn */
  rep: Activity
  members: Activity[]
  /** newest first */
  latest: string
  maxDistance: number
}

/** Groups activities that ran the same route (newest first in, newest first out). */
export function groupRoutes(activities: Activity[]): RouteGroup[] {
  const groups: { g: RouteGroup; shape: XY[]; len: number }[] = []
  for (const a of activities) {
    if (!a.polyline) continue
    const pts = toMeters(a.polyline)
    const shape = resample(pts, SAMPLES)
    if (shape.length < SAMPLES) continue
    const len = length(pts)
    const hit = groups.find(
      (x) => x.g.rep.type === a.type && len / x.len < LENGTH_RATIO && x.len / len < LENGTH_RATIO && meanGap(shape, x.shape) < SAME_ROUTE_M,
    )
    if (hit) {
      hit.g.members.push(a)
      hit.g.maxDistance = Math.max(hit.g.maxDistance, a.distance_m)
    } else {
      groups.push({ g: { rep: a, members: [a], latest: a.start_local, maxDistance: a.distance_m }, shape, len })
    }
  }
  return groups.map((x) => x.g)
}

/** SVG path for a polyline fitted into a size x size box with padding. */
export function routePath(polyline: string, size = 100, pad = 8): string | null {
  const pts = toMeters(polyline)
  if (pts.length < 2) return null
  const xs = pts.map((p) => p[0])
  const ys = pts.map((p) => p[1])
  const minX = Math.min(...xs)
  const maxY = Math.max(...ys)
  const w = Math.max(...xs) - minX || 1
  const h = maxY - Math.min(...ys) || 1
  const s = (size - pad * 2) / Math.max(w, h)
  const ox = (size - w * s) / 2
  const oy = (size - h * s) / 2
  return pts.map(([x, y], i) => `${i ? 'L' : 'M'}${(ox + (x - minX) * s).toFixed(1)},${(oy + (maxY - y) * s).toFixed(1)}`).join('')
}
