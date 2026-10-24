package export

import (
	"testing"
	"time"

	"github.com/Jason-cqtan/lifelog/internal/model"
)

func TestMusic(t *testing.T) {
	sh, _ := time.LoadLocation("Asia/Shanghai")
	// Monday 2026-10-19 21:30 local = 13:30 UTC
	at := func(day, hourUTC int) time.Time { return time.Date(2026, 10, day, hourUTC, 30, 0, 0, time.UTC) }
	plays := []model.Play{
		{PlayedAt: at(19, 13), Track: "Kiss Me More", Artist: "Doja Cat, SZA", TrackID: "k", MsPlayed: 200000},
		{PlayedAt: at(19, 14), Track: "Kiss Me More", Artist: "Doja Cat, SZA", TrackID: "k", MsPlayed: 200000},
		{PlayedAt: at(20, 13), Track: "Woman", Artist: "Doja Cat", TrackID: "w", MsPlayed: 170000},
		{PlayedAt: time.Date(2025, 12, 31, 17, 0, 0, 0, time.UTC), Track: "Old", Artist: "X", MsPlayed: 60000}, // 2026-01-01 01:00 local
	}
	m := Music(plays, sh)

	y := m["2026"]
	if y == nil || y.Plays != 4 || y.Tracks != 3 || y.Artists != 3 {
		t.Fatalf("2026 = %+v", y)
	}
	if _, ok := m["2025"]; ok {
		t.Errorf("a play at 01:00 local on Jan 1 belongs to 2026, not 2025")
	}
	if top := y.Top[0]; top.Name != "Doja Cat" || top.Ms != 570000 || top.Plays != 3 || top.Tracks != 2 {
		t.Errorf("top artist = %+v", top)
	}
	if s := y.Songs[0]; s.Track != "Kiss Me More" || s.Plays != 2 || s.Ms != 400000 {
		t.Errorf("top track = %+v", s)
	}
	if got := y.Hours[0][21]; got != 200000 { // Monday 21:00 local
		t.Errorf("Mon 21h = %d", got)
	}
	if m["all"].Plays != 4 {
		t.Errorf("all = %+v", m["all"])
	}
}
