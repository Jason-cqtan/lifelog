package applehealth

import (
	"strings"
	"testing"
	"time"

	"github.com/Jason-cqtan/lifelog/internal/polyline"
	"github.com/Jason-cqtan/lifelog/internal/store"
)

const pushed = `{"data":{"metrics":[],"workouts":[{
	"id":"ABC-1","name":"Outdoor Run","start":"2026-10-31 07:00:00 +0800","end":"2026-10-31 07:30:00 +0800",
	"duration":1800.5,"isIndoor":false,
	"distance":{"qty":5.2,"units":"km"},
	"elevationUp":{"qty":100,"units":"ft"},
	"heartRate":{"min":{"qty":90,"units":"bpm"},"avg":{"qty":150,"units":"bpm"},"max":{"qty":170,"units":"bpm"}},
	"route":[{"latitude":29.5,"longitude":106.6,"altitude":200,"timestamp":"2026-10-31 07:00:00 +0800"},
	         {"latitude":29.51,"longitude":106.61,"altitude":201,"timestamp":"2026-10-31 07:00:10 +0800"}]
}]}}`

func TestImportPush(t *testing.T) {
	st, err := store.Open(t.TempDir(), "")
	if err != nil {
		t.Fatal(err)
	}
	received, changed, err := ImportPush(strings.NewReader(pushed), st)
	if err != nil || received != 1 || changed != 1 {
		t.Fatalf("got %d, %d, %v", received, changed, err)
	}
	a, ok := st.Activity("applehealth:ABC-1")
	if !ok {
		t.Fatal("not stored")
	}
	if want := time.Date(2026, 10, 30, 23, 0, 0, 0, time.UTC); !a.StartTime.Equal(want) {
		t.Errorf("start %v", a.StartTime)
	}
	if a.Type != "run" || a.Distance != 5200 || a.MovingTime != 1800 || a.AvgHeartRate != 150 {
		t.Errorf("activity %+v", a)
	}
	if a.ElevationGain < 30 || a.ElevationGain > 31 {
		t.Errorf("elevation %v", a.ElevationGain)
	}
	if want := polyline.Encode([][2]float64{{29.5, 106.6}, {29.51, 106.61}}); a.Polyline != want {
		t.Errorf("route %q, want %q", a.Polyline, want)
	}

	// the same workout again: nothing to do
	if _, changed, err := ImportPush(strings.NewReader(pushed), st); err != nil || changed != 0 {
		t.Errorf("repeat: changed %d, %v", changed, err)
	}
	// without its route, as when "Include Route Data" is off: the route stays
	noRoute := `{"data":{"workouts":[{"id":"ABC-1","name":"Outdoor Run","start":"2026-10-31 07:00:00 +0800","duration":1800.5,
		"distance":{"qty":5.3,"units":"km"}}]}}`
	if _, changed, err := ImportPush(strings.NewReader(noRoute), st); err != nil || changed != 1 {
		t.Errorf("update: changed %d, %v", changed, err)
	}
	if a, _ := st.Activity("applehealth:ABC-1"); a.Polyline == "" || a.Distance != 5300 {
		t.Errorf("after update %+v", a)
	}
}

func TestImportPushFormats(t *testing.T) {
	st, err := store.Open(t.TempDir(), "")
	if err != nil {
		t.Fatal(err)
	}
	// miles, and a 12-hour clock with iOS's narrow no-break space
	body := "{\"data\":{\"workouts\":[{\"id\":\"X\",\"name\":\"Outdoor Cycling\",\"start\":\"2026-10-31 3:04:05 PM +0800\",\"duration\":60,\"distance\":{\"qty\":1,\"units\":\"mi\"}}]}}"
	if _, _, err := ImportPush(strings.NewReader(body), st); err != nil {
		t.Fatal(err)
	}
	a, _ := st.Activity("applehealth:X")
	if a.Type != "ride" || a.Distance < 1609 || a.Distance > 1610 || a.StartTime.Hour() != 7 {
		t.Errorf("activity %+v", a)
	}
	// Export Version 1 has no id; say so rather than storing unusable records
	if _, _, err := ImportPush(strings.NewReader(`{"data":{"workouts":[{"name":"Run","start":"2026-10-31 07:00:00 +0800"}]}}`), st); err == nil {
		t.Error("version 1 accepted")
	}
	if _, _, err := ImportPush(strings.NewReader(`not json`), st); err == nil {
		t.Error("bad JSON accepted")
	}
}
