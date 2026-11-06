package netflix

import (
	"strings"
	"testing"
	"time"

	"github.com/Jason-cqtan/lifelog/internal/store"
)

const activity = "\xef\xbb\xbfProfile Name,Start Time,Duration,Attributes,Title,Supplemental Video Type,Device Type,Bookmark,Latest Bookmark,Country\n" +
	"Jason,2026-10-20 13:00:00,00:47:12,,Stranger Things: Season 1: Chapter One: The Vanishing of Will Byers (Episode 1),,Apple TV 4K,00:47:12,00:47:12,CN (China)\n" +
	"Jason,2026-10-20 14:00:00,00:00:08,Autoplayed: user action: None; ,怪奇物语：第 1 季：第二章：枫树街的怪人,,iPhone,00:00:08,00:00:08,CN (China)\n" +
	"Jason,2026-10-21 12:00:00,00:02:10,,Stranger Things: Season 5 (Trailer),TRAILER,iPhone,00:02:10,00:02:10,CN (China)\n" +
	"Jason,2026-10-22 12:30:00,01:58:00,,Glass Onion: A Knives Out Mystery,,Chrome PC (Cadmium),01:58:00,01:58:00,CN (China)\n" +
	"Kid,2026-10-22 09:00:00,00:20:00,,Peppa Pig: Season 1: Muddy Puddles,,iPad,00:20:00,00:20:00,CN (China)\n"

func TestImportActivity(t *testing.T) {
	st, _ := store.Open(t.TempDir(), "")
	if _, err := Import(strings.NewReader(activity), st, "", time.UTC); err == nil || !strings.Contains(err.Error(), `"Kid"`) {
		t.Fatalf("two profiles without -profile: err = %v, want the profile list", err)
	}
	n, err := Import(strings.NewReader(activity), st, "Jason", time.UTC)
	if err != nil || n != 2 {
		t.Fatalf("Import = %d, %v; want 2 (autoplay preview, trailer and the other profile skipped)", n, err)
	}
	ws := st.Watches()
	ep, movie := ws[0], ws[1]
	if ep.Title != "Stranger Things" || ep.Episode != "Season 1: Chapter One: The Vanishing of Will Byers (Episode 1)" ||
		ep.Kind != "episode" || ep.Seconds != 47*60+12 || ep.Device != "Apple TV 4K" ||
		!ep.WatchedAt.Equal(time.Date(2026, 10, 20, 13, 0, 0, 0, time.UTC)) {
		t.Errorf("episode = %+v", ep)
	}
	if movie.Title != "Glass Onion: A Knives Out Mystery" || movie.Kind != "movie" || movie.Seconds != 118*60 {
		t.Errorf("movie = %+v", movie)
	}
	if n, _ := Import(strings.NewReader(activity), st, "Jason", time.UTC); n != 0 {
		t.Errorf("re-import added %d, want 0", n)
	}
}

func TestImportHistory(t *testing.T) {
	loc, _ := time.LoadLocation("Asia/Shanghai")
	cases := map[string]string{
		"month-first": "Title,Date\n\"Wednesday: Season 1: Woe Is the Loneliest Number\",1/2/23\nRoma,12/25/22\n",
		"day-first":   "Title,Date\n\"Wednesday: Season 1: Woe Is the Loneliest Number\",02/01/2023\nRoma,25/12/2022\n",
		"year-first":  "Title,Date\n\"Wednesday: Season 1: Woe Is the Loneliest Number\",2023/1/2\nRoma,2022/12/25\n",
	}
	for name, csv := range cases {
		st, _ := store.Open(t.TempDir(), "")
		n, err := Import(strings.NewReader(csv), st, "", loc)
		if err != nil || n != 2 {
			t.Fatalf("%s: Import = %d, %v", name, n, err)
		}
		ws := st.Watches()
		if got := ws[1].WatchedAt.In(loc).Format("2006-01-02"); got != "2023-01-02" || ws[1].Title != "Wednesday" || ws[1].Seconds != 0 {
			t.Errorf("%s: %s %+v", name, got, ws[1])
		}
		if got := ws[0].WatchedAt.In(loc).Format("2006-01-02"); got != "2022-12-25" || ws[0].Kind != "movie" {
			t.Errorf("%s: %s %+v", name, got, ws[0])
		}
	}
}

func TestSplitTitle(t *testing.T) {
	cases := []struct{ raw, title, episode string }{
		{"Breaking Bad: Season 5: Felina", "Breaking Bad", "Season 5: Felina"},
		{"Squid Game: Limited Series: Red Light, Green Light", "Squid Game", "Limited Series: Red Light, Green Light"},
		{"Money Heist: Part 1: Episode 1", "Money Heist", "Part 1: Episode 1"},
		{"鱿鱼游戏：第 2 季：第 1 集", "鱿鱼游戏", "第 2 季: 第 1 集"},
		{"三体：第一季：第 3 集", "三体", "第一季: 第 3 集"},
		{"Spider-Man: Across the Spider-Verse", "Spider-Man: Across the Spider-Verse", ""},
		{"Roma", "Roma", ""},
	}
	for _, c := range cases {
		title, episode := SplitTitle(c.raw)
		if title != c.title || episode != c.episode {
			t.Errorf("SplitTitle(%q) = %q, %q; want %q, %q", c.raw, title, episode, c.title, c.episode)
		}
	}
}
