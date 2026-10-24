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
