package export

import (
	"testing"
	"time"

	"github.com/Jason-cqtan/lifelog/internal/model"
)

func TestDedupe(t *testing.T) {
	t0 := time.Date(2026, 10, 1, 7, 0, 0, 0, time.UTC)
	acts := []model.Activity{
		{Source: "strava", SourceID: "1", Type: model.Run, StartTime: t0},
		{Source: "garmin", SourceID: "a", Type: model.Run, StartTime: t0.Add(30 * time.Second)},
		{Source: "applehealth", SourceID: "x", Type: model.Run, StartTime: t0.Add(time.Minute)},
		// same time but a different sport: a separate activity
		{Source: "strava", SourceID: "2", Type: model.Ride, StartTime: t0.Add(time.Minute)},
		// same sport an hour later: a second run
		{Source: "strava", SourceID: "3", Type: model.Run, StartTime: t0.Add(time.Hour)},
	}
	got := Dedupe(acts)
	var keys []string
	for _, a := range got {
		keys = append(keys, a.Key())
	}
	want := []string{"garmin:a", "strava:2", "strava:3"}
	if len(keys) != len(want) {
		t.Fatalf("got %v, want %v", keys, want)
	}
	for i := range want {
		if keys[i] != want[i] {
			t.Fatalf("got %v, want %v", keys, want)
		}
	}
}

func TestNormalizeType(t *testing.T) {
	cases := map[string]model.SportType{
		"TrailRun":                     model.Run,
		"treadmill_running":            model.Run,
		"MountainBikeRide":             model.Ride,
		"indoor_cycling":               model.Ride,
		"Hiking":                       model.Hike,
		"mountaineering":               model.Hike,
		"HKWorkoutActivityTypeWalking": model.Walk,
		"lap_swimming":                 model.Swim,
		"WeightTraining":               model.Workout,
	}
	for raw, want := range cases {
		if got := model.NormalizeType(raw); got != want {
			t.Errorf("NormalizeType(%q) = %s, want %s", raw, got, want)
		}
	}
}

func TestDuolingoCourses(t *testing.T) {
	daily := map[string]map[string]float64{
		"2026-10-24": {"duolingo_minutes": 60, courseXPPrefix + "EN": 300, courseXPPrefix + "OTHER": 100},
		"2026-10-25": {"duolingo_minutes": 30, courseXPPrefix + "EN": 50},
	}
	d := duolingoCourses(model.DuolingoCourses{}, daily)
	en, other := d.Periods["2026"]["EN"], d.Periods["all"]["OTHER"]
	if en.XP != 350 || en.Minutes != 75 { // 60*3/4 + 30
		t.Errorf("EN = %+v", en)
	}
	if other.XP != 100 || other.Minutes != 15 {
		t.Errorf("OTHER = %+v", other)
	}
}

func TestDedupeResyncedAndSameSource(t *testing.T) {
	t0 := time.Date(2021, 5, 1, 7, 0, 0, 0, time.UTC)
	acts := []model.Activity{
		// Joyrun copy of a Garmin run, 8 minutes off, same distance: one workout
		{Source: "running_page", SourceID: "j1", Type: model.Run, StartTime: t0, Distance: 10000},
		{Source: "garmin", SourceID: "g1", Type: model.Run, StartTime: t0.Add(8 * time.Minute), Distance: 10050},
		// two running_page records of one run (Joyrun + GPX): keep the one with efforts
		{Source: "running_page", SourceID: "a", Type: model.Run, StartTime: t0.Add(5 * time.Hour), Distance: 5000},
		{Source: "running_page", SourceID: "b", Type: model.Run, StartTime: t0.Add(5*time.Hour + time.Minute), Distance: 5010,
			BestEfforts: map[string]float64{"1000": 280}},
		// 8 minutes apart but clearly different distances: two runs
		{Source: "running_page", SourceID: "c", Type: model.Run, StartTime: t0.Add(9 * time.Hour), Distance: 3000},
		{Source: "garmin", SourceID: "d", Type: model.Run, StartTime: t0.Add(9*time.Hour + 8*time.Minute), Distance: 6000},
	}
	var keys []string
	for _, a := range Dedupe(acts) {
		keys = append(keys, a.Key())
	}
	want := []string{"garmin:g1", "running_page:b", "running_page:c", "garmin:d"}
	if len(keys) != len(want) {
		t.Fatalf("got %v, want %v", keys, want)
	}
	for i := range want {
		if keys[i] != want[i] {
			t.Fatalf("got %v, want %v", keys, want)
		}
	}
}
