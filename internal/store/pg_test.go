package store

import (
	"context"
	"os"
	"path/filepath"
	"testing"
	"time"

	"github.com/Jason-cqtan/lifelog/internal/db"
	"github.com/Jason-cqtan/lifelog/internal/model"
)

// TestDBRoundTrip needs an empty scratch database, e.g.
// LIFELOG_TEST_DATABASE_URL=postgres:///lifelog_test go test ./internal/store
func TestDBRoundTrip(t *testing.T) {
	url := os.Getenv("LIFELOG_TEST_DATABASE_URL")
	if url == "" {
		t.Skip("LIFELOG_TEST_DATABASE_URL not set")
	}
	ctx := context.Background()
	pool, err := db.Connect(ctx, url)
	if err != nil {
		t.Fatal(err)
	}
	defer pool.Close()
	for _, tbl := range []string{"activities", "daily_metrics", "plays", "snapshots"} {
		if _, err := pool.Exec(ctx, "TRUNCATE "+tbl); err != nil {
			t.Fatal(err)
		}
	}

	st, err := OpenDB(ctx, pool)
	if err != nil {
		t.Fatal(err)
	}
	a := model.Activity{Source: "garmin", SourceID: "1", Type: model.Run, StartTime: time.Unix(1e9, 0).UTC(), Distance: 5000,
		Polyline: route, Weather: &model.Weather{TempC: 12}, BestEfforts: map[string]float64{"1000": 300}}
	st.UpsertActivity(a)
	st.AddDaily(model.DailyMetric{Date: "2026-10-30", Source: "duolingo", Metric: "minutes", Value: 5})
	st.AddPlay(model.Play{PlayedAt: time.Unix(1e9, 5e8).UTC(), Track: "x", MsPlayed: 1000})
	if err := st.PutSnapshot("top", map[string]int{"b": 1, "a": 2}); err != nil {
		t.Fatal(err)
	}
	if err := st.Save(); err != nil {
		t.Fatal(err)
	}
	// a second change in the same store only writes what changed
	st.AddDaily(model.DailyMetric{Date: "2026-10-30", Source: "duolingo", Metric: "minutes", Value: 2})
	if err := st.Save(); err != nil {
		t.Fatal(err)
	}

	got, err := OpenDB(ctx, pool)
	if err != nil {
		t.Fatal(err)
	}
	if g, _ := got.Activity(a.Key()); g.Polyline != route || g.Weather.TempC != 12 || g.BestEfforts["1000"] != 300 || !g.StartTime.Equal(a.StartTime) {
		t.Errorf("activity = %+v", g)
	}
	if d := got.Daily(); len(d) != 1 || d[0].Value != 7 {
		t.Errorf("daily = %+v", d)
	}
	if p := got.Plays(); len(p) != 1 || !p[0].PlayedAt.Equal(time.Unix(1e9, 5e8)) {
		t.Errorf("plays = %+v", p)
	}
	if string(got.snapshots["top"]) != string(st.snapshots["top"]) {
		t.Errorf("snapshot changed: %q", got.snapshots["top"])
	}

	// the backup seals routes; a changed answer starts a fresh seal instead of failing
	dir := t.TempDir()
	if err := got.WriteFiles(dir, "Tan"); err != nil {
		t.Fatal(err)
	}
	if err := got.WriteFiles(dir, "Li"); err != nil {
		t.Fatal(err)
	}
	files, err := Open(dir, "Li")
	if err != nil {
		t.Fatal(err)
	}
	if g, _ := files.Activity(a.Key()); g.Polyline != route {
		t.Errorf("backup route = %q", g.Polyline)
	}
	if b, _ := os.ReadFile(filepath.Join(dir, "activities.json")); len(b) == 0 {
		t.Error("no activities.json")
	}
}

func TestWriteFilesKeepsHistory(t *testing.T) {
	dir := t.TempDir()
	old, err := Open(dir, "")
	if err != nil {
		t.Fatal(err)
	}
	old.PutDaily(model.DailyMetric{Date: "2020-01-01", Source: "github", Metric: "contributions", Value: 3})
	if err := old.Save(); err != nil {
		t.Fatal(err)
	}
	empty, err := Open(t.TempDir(), "") // stands in for a database nothing was imported into
	if err != nil {
		t.Fatal(err)
	}
	if err := empty.WriteFiles(dir, ""); err == nil {
		t.Fatal("an empty store overwrote the history in data/")
	}
}
