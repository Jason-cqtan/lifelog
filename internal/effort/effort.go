// Package effort finds best efforts: the fastest stretch of a given distance
// anywhere inside an activity, from its time/distance samples (like Strava's
// and Garmin's split-based records, not whole-activity averages).
package effort

import (
	"math"
	"strconv"
)

// Distances are the standard running distances, in meters.
var Distances = []float64{1000, 5000, 10000, 21097.5, 42195}

// Key is how a distance is stored in Activity.BestEfforts.
func Key(meters float64) string { return strconv.FormatFloat(meters, 'f', -1, 64) }

// Point is one sample: seconds since the start and cumulative meters.
type Point struct{ T, D float64 }

// Best returns, per distance the activity covers, the shortest elapsed time (s)
// over any window of exactly that distance. Samples must be in time order;
// distance going backwards (sensor resets) is ignored.
func Best(pts []Point) map[string]float64 {
	clean := make([]Point, 0, len(pts))
	for _, p := range pts {
		if len(clean) > 0 && (p.D < clean[len(clean)-1].D || p.T < clean[len(clean)-1].T) {
			continue
		}
		clean = append(clean, p)
	}
	out := map[string]float64{}
	if len(clean) < 2 {
		return out
	}
	for _, target := range Distances {
		best := math.Inf(1)
		i := 0
		for j := 1; j < len(clean); j++ {
			// slide i to the last sample that still leaves >= target to j
			for i+1 < j && clean[j].D-clean[i+1].D >= target {
				i++
			}
			if clean[j].D-clean[i].D < target {
				continue
			}
			// the window starts between i and i+1, where exactly target remains
			start := clean[i].T
			if span := clean[i+1].D - clean[i].D; span > 0 {
				f := (clean[j].D - target - clean[i].D) / span
				start += f * (clean[i+1].T - clean[i].T)
			}
			if d := clean[j].T - start; d > 0 && d < best {
				best = d
			}
		}
		if !math.IsInf(best, 1) {
			out[Key(target)] = math.Round(best*10) / 10
		}
	}
	return out
}

// FromTrack turns GPS samples into Points using great-circle distance. Samples
// closer than minStep seconds are merged (1 s GPS jitter adds fake distance),
// and steps faster than maxSpeed m/s are treated as glitches and add nothing.
// Both only ever make an effort slower, never faster.
func FromTrack(lat, lng, t []float64, maxSpeed, minStep float64) []Point {
	pts := make([]Point, 0, len(t))
	var d float64
	last := 0
	for k := range t {
		if k > 0 {
			if t[k]-t[last] < minStep && k < len(t)-1 {
				continue
			}
			step := haversine(lat[last], lng[last], lat[k], lng[k])
			if dt := t[k] - t[last]; dt > 0 && step/dt <= maxSpeed {
				d += step
			}
			last = k
		}
		pts = append(pts, Point{T: t[k] - t[0], D: d})
	}
	return pts
}

func haversine(lat1, lng1, lat2, lng2 float64) float64 {
	const r = 6371000
	rad := math.Pi / 180
	dLat := (lat2 - lat1) * rad
	dLng := (lng2 - lng1) * rad
	a := math.Sin(dLat/2)*math.Sin(dLat/2) + math.Cos(lat1*rad)*math.Cos(lat2*rad)*math.Sin(dLng/2)*math.Sin(dLng/2)
	return 2 * r * math.Asin(math.Sqrt(a))
}
