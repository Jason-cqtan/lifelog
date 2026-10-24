package effort

import (
	"math"
	"testing"
)

func TestBest(t *testing.T) {
	// 12 km: 6:00/km for 4 km, then 4:00/km for 5 km, then 6:00/km again.
	var pts []Point
	var tt, d float64
	pace := func(km float64) float64 {
		if km >= 4 && km < 9 {
			return 240
		}
		return 360
	}
	for d < 12000 {
		pts = append(pts, Point{T: tt, D: d})
		tt += pace(d/1000) / 100 // 10 m steps
		d += 10
	}
	pts = append(pts, Point{T: tt, D: d})

	got := Best(pts)
	want := map[string]float64{"1000": 240, "5000": 1200, "10000": 240*5 + 360*5}
	for k, v := range want {
		if math.Abs(got[k]-v) > 0.5 {
			t.Errorf("Best[%s] = %v, want %v", k, got[k], v)
		}
	}
	if _, ok := got["21097.5"]; ok {
		t.Errorf("a 12 km run must not have a half-marathon effort")
	}
}

func TestBestIgnoresPauseAndResets(t *testing.T) {
	// 1 km in 300 s, a 10-minute stop, then 1 km in 280 s; a bogus backwards sample.
	pts := []Point{{0, 0}, {300, 1000}, {900, 1000}, {950, 500}, {1180, 2000}}
	if got := Best(pts)["1000"]; math.Abs(got-280) > 0.5 {
		t.Errorf("Best 1000 = %v, want 280", got)
	}
}

func TestFromTrackSkipsGlitches(t *testing.T) {
	// ~111 m north per step every 30 s, then a 1 km jump in 1 s (glitch).
	lat := []float64{0, 0.001, 0.002, 0.011}
	lng := []float64{0, 0, 0, 0}
	ts := []float64{0, 30, 60, 61}
	pts := FromTrack(lat, lng, ts, 10, 0)
	if d := pts[len(pts)-1].D; math.Abs(d-222.4) > 1 {
		t.Errorf("distance = %v, want ~222 (glitch skipped)", d)
	}
}

func TestFromTrackMergesJitter(t *testing.T) {
	// Standing still with ±5 m jitter every second for 60 s must add ~no distance
	// once samples are merged into 5 s steps (here: under a quarter of the raw sum).
	var lat, lng, ts []float64
	for k := 0; k <= 60; k++ {
		j := 0.000045 * float64(k%2*2-1) // ~5 m north/south
		lat, lng, ts = append(lat, j), append(lng, 0), append(ts, float64(k))
	}
	raw := FromTrack(lat, lng, ts, 100, 0)
	merged := FromTrack(lat, lng, ts, 100, 5)
	if raw[len(raw)-1].D < 500 || merged[len(merged)-1].D > raw[len(raw)-1].D/4 {
		t.Errorf("raw %v m, merged %v m", raw[len(raw)-1].D, merged[len(merged)-1].D)
	}
}
