// Package polyline implements Google's encoded polyline format (precision 5),
// the route format Strava returns and the frontend decodes.
package polyline

import "math"

// Encode encodes [lat, lng] pairs.
func Encode(pts [][2]float64) string {
	var buf []byte
	var plat, plng int
	enc := func(v int) {
		u := v << 1
		if v < 0 {
			u = ^u
		}
		for u >= 0x20 {
			buf = append(buf, byte((0x20|(u&0x1f))+63))
			u >>= 5
		}
		buf = append(buf, byte(u+63))
	}
	for _, p := range pts {
		lat, lng := int(math.Round(p[0]*1e5)), int(math.Round(p[1]*1e5))
		enc(lat - plat)
		enc(lng - plng)
		plat, plng = lat, lng
	}
	return string(buf)
}

// Decode is the inverse of Encode.
func Decode(s string) [][2]float64 {
	var pts [][2]float64
	var lat, lng int
	for i := 0; i < len(s); {
		var v [2]int
		for k := 0; k < 2; k++ {
			result, shift := 0, 0
			for i < len(s) {
				b := int(s[i]) - 63
				i++
				result |= (b & 0x1f) << shift
				shift += 5
				if b < 0x20 {
					break
				}
			}
			if result&1 != 0 {
				v[k] = ^(result >> 1)
			} else {
				v[k] = result >> 1
			}
		}
		lat += v[0]
		lng += v[1]
		pts = append(pts, [2]float64{float64(lat) / 1e5, float64(lng) / 1e5})
	}
	return pts
}

// Simplify drops points that deviate less than tolerance meters from the line
// (Ramer–Douglas–Peucker), keeping the first and last point.
func Simplify(pts [][2]float64, tolerance float64) [][2]float64 {
	if len(pts) < 3 {
		return pts
	}
	// local planar meters around the route
	lat0 := pts[0][0] * math.Pi / 180
	kx, ky := 111320*math.Cos(lat0), 110540.0
	xy := make([][2]float64, len(pts))
	for i, p := range pts {
		xy[i] = [2]float64{p[1] * kx, p[0] * ky}
	}
	keep := make([]bool, len(pts))
	keep[0], keep[len(pts)-1] = true, true
	var rdp func(a, b int)
	rdp = func(a, b int) {
		maxD, idx := 0.0, -1
		for i := a + 1; i < b; i++ {
			if d := segDist(xy[i], xy[a], xy[b]); d > maxD {
				maxD, idx = d, i
			}
		}
		if idx >= 0 && maxD > tolerance {
			keep[idx] = true
			rdp(a, idx)
			rdp(idx, b)
		}
	}
	rdp(0, len(pts)-1)
	out := make([][2]float64, 0, len(pts))
	for i, p := range pts {
		if keep[i] {
			out = append(out, p)
		}
	}
	return out
}

func segDist(p, a, b [2]float64) float64 {
	dx, dy := b[0]-a[0], b[1]-a[1]
	if dx == 0 && dy == 0 {
		return math.Hypot(p[0]-a[0], p[1]-a[1])
	}
	t := ((p[0]-a[0])*dx + (p[1]-a[1])*dy) / (dx*dx + dy*dy)
	t = math.Max(0, math.Min(1, t))
	return math.Hypot(p[0]-(a[0]+t*dx), p[1]-(a[1]+t*dy))
}
