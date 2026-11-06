package export

import (
	"testing"
	"time"

	"github.com/Jason-cqtan/lifelog/internal/model"
	"github.com/Jason-cqtan/lifelog/internal/store"
)

func TestWatchingDedupesByDay(t *testing.T) {
	loc, _ := time.LoadLocation("Asia/Shanghai")
	at := func(day, hour int) time.Time { return time.Date(2026, 10, day, hour, 0, 0, 0, loc) }
	st, _ := store.Open(t.TempDir(), "")
	for _, w := range []model.Watch{
		// Oct 20: the Netflix export and Trakt both saw it; Netflix wins the day
		{Source: "netflix", SourceID: "a", WatchedAt: at(20, 21), Kind: "episode", Title: "怪奇物语", Episode: "第 1 季: 第一章", Seconds: 2832},
		{Source: "trakt", SourceID: "1", WatchedAt: at(20, 22), Kind: "episode", Title: "Stranger Things", Episode: "S01E01", Seconds: 3000},
		// Oct 21: only in the basic CSV (no duration) and Trakt: Trakt counts
		{Source: "netflix", SourceID: "b", WatchedAt: at(21, 12), Kind: "movie", Title: "罗马"},
		{Source: "trakt", SourceID: "2", WatchedAt: at(21, 23), Kind: "movie", Title: "Roma", Seconds: 8100},
		// Oct 22: after the export, Trakt only
		{Source: "trakt", SourceID: "3", WatchedAt: at(22, 20), Kind: "episode", Title: "Stranger Things", Episode: "S01E02", Seconds: 3300},
	} {
		st.PutWatch(w)
	}
	out := Build(st, loc)
	want := map[string]float64{"2026-10-20": 47.2, "2026-10-21": 135, "2026-10-22": 55}
	for day, min := range want {
		if got := out.Daily[day]["watch_minutes"]; got != min {
			t.Errorf("%s watch_minutes = %v, want %v", day, got, min)
		}
	}
	all := out.Watching["all"]
	if all.Sessions != 4 || all.Titles != 4 || all.Minutes != 237.2 {
		t.Errorf("all = %+v, want 4 sessions (the Trakt copy on Oct 20 dropped), 4 titles, 237.2 min", all)
	}
	if all.Top[0].Title != "Roma" || all.Top[1].Title != "Stranger Things" || all.Top[1].Kind != "episode" {
		t.Errorf("top = %+v", all.Top)
	}
	if len(out.RecentWatches) != 4 || out.RecentWatches[0].Episode != "S01E02" || out.RecentWatches[0].Date != "2026-10-22" {
		t.Errorf("recent = %+v", out.RecentWatches)
	}
}
