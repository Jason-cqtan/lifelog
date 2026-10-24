package polyline

import "testing"

func TestEncode(t *testing.T) {
	// Example from Google's polyline algorithm documentation.
	got := Encode([][2]float64{{38.5, -120.2}, {40.7, -120.95}, {43.252, -126.453}})
	if want := "_p~iF~ps|U_ulLnnqC_mqNvxq`@"; got != want {
		t.Errorf("Encode = %q, want %q", got, want)
	}
}

func TestDecodeRoundTrip(t *testing.T) {
	pts := [][2]float64{{38.5, -120.2}, {40.7, -120.95}, {43.252, -126.453}}
	got := Decode(Encode(pts))
	for i := range pts {
		if got[i] != pts[i] {
			t.Fatalf("Decode(Encode) = %v, want %v", got, pts)
		}
	}
}

func TestSimplify(t *testing.T) {
	// a straight 1 km line with 1 m jitter, plus one real 50 m corner in the middle
	var pts [][2]float64
	for i := 0; i <= 100; i++ {
		jitter := float64(i%2) * 0.00001 // ~1 m
		lat := 29.5 + jitter
		if i == 50 {
			lat += 0.00045 // ~50 m off the line
		}
		pts = append(pts, [2]float64{lat, 106.5 + float64(i)*0.0001})
	}
	out := Simplify(pts, 4)
	if len(out) > 10 { // ends, the corner and its two neighbours, not the 1 m jitter
		t.Errorf("kept %d of %d points; jitter should go", len(out), len(pts))
	}
	found := false
	for _, p := range out {
		if p == pts[50] {
			found = true
		}
	}
	if !found || out[0] != pts[0] || out[len(out)-1] != pts[100] {
		t.Errorf("the corner and both ends must stay: %v", out)
	}
}
