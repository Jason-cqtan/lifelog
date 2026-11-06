package export

import (
	"sort"
	"time"

	"github.com/Jason-cqtan/lifelog/internal/model"
	"github.com/Jason-cqtan/lifelog/internal/store"
)

// WatchStats sums what was watched in a year ("2026") or overall ("all").
type WatchStats struct {
	Minutes  float64     `json:"minutes"`
	Sessions int         `json:"sessions"`
	Titles   int         `json:"titles"`
	Top      []TitleTime `json:"top"` // by minutes
}

type TitleTime struct {
	Title    string  `json:"title"`
	Kind     string  `json:"kind"`
	Minutes  float64 `json:"minutes"`
	Sessions int     `json:"sessions"`
}

type RecentWatch struct {
	Date    string  `json:"date"`
	Title   string  `json:"title"`
	Episode string  `json:"episode,omitempty"`
	Kind    string  `json:"kind"`
	Source  string  `json:"source"`
	Minutes float64 `json:"minutes"`
}

const (
	topTitles   = 20
	recentCount = 12
	watchMetric = "watch_minutes"
)

// CountedWatches drops copies of the same viewing. Netflix's export and Trakt
// name titles differently (localized vs English), so they cannot be matched
// one by one; instead a day with Netflix playback time counts Netflix only, and
// Trakt fills the other days (after the export, and other services).
// Netflix rows without a duration (the basic CSV) don't claim their day.
func CountedWatches(ws []model.Watch, loc *time.Location) []model.Watch {
	netflixDays := map[string]bool{}
	for _, w := range ws {
		if w.Source == "netflix" && w.Seconds > 0 {
			netflixDays[store.DateIn(w.WatchedAt, loc)] = true
		}
	}
	out := make([]model.Watch, 0, len(ws))
	for _, w := range ws {
		if w.Source != "netflix" && netflixDays[store.DateIn(w.WatchedAt, loc)] {
			continue
		}
		out = append(out, w)
	}
	return out
}

// Watching aggregates counted watches per local year plus "all", and lists the newest ones.
func Watching(ws []model.Watch, loc *time.Location) (map[string]*WatchStats, []RecentWatch) {
	type acc struct {
		stats  *WatchStats
		titles map[string]*TitleTime
	}
	periods := map[string]*acc{}
	get := func(p string) *acc {
		if periods[p] == nil {
			periods[p] = &acc{stats: &WatchStats{}, titles: map[string]*TitleTime{}}
		}
		return periods[p]
	}
	for _, w := range ws {
		min := float64(w.Seconds) / 60
		for _, p := range []string{w.WatchedAt.In(loc).Format("2006"), "all"} {
			a := get(p)
			a.stats.Minutes += min
			a.stats.Sessions++
			tt := a.titles[w.Title]
			if tt == nil {
				tt = &TitleTime{Title: w.Title, Kind: w.Kind}
				a.titles[w.Title] = tt
			}
			tt.Minutes += min
			tt.Sessions++
			if w.Kind == "episode" {
				tt.Kind = "episode" // a show seen once as a "movie" row stays a show
			}
		}
	}
	out := map[string]*WatchStats{}
	for p, a := range periods {
		for _, tt := range a.titles {
			tt.Minutes = round(tt.Minutes)
			a.stats.Top = append(a.stats.Top, *tt)
		}
		sort.Slice(a.stats.Top, func(i, j int) bool {
			x, y := a.stats.Top[i], a.stats.Top[j]
			if x.Minutes != y.Minutes {
				return x.Minutes > y.Minutes
			}
			if x.Sessions != y.Sessions {
				return x.Sessions > y.Sessions
			}
			return x.Title < y.Title
		})
		a.stats.Titles = len(a.stats.Top)
		if len(a.stats.Top) > topTitles {
			a.stats.Top = a.stats.Top[:topTitles]
		}
		a.stats.Minutes = round(a.stats.Minutes)
		out[p] = a.stats
	}

	var recent []RecentWatch
	for i := len(ws) - 1; i >= 0 && len(recent) < recentCount; i-- {
		w := ws[i]
		recent = append(recent, RecentWatch{
			Date: store.DateIn(w.WatchedAt, loc), Title: w.Title, Episode: w.Episode,
			Kind: w.Kind, Source: w.Source, Minutes: round(float64(w.Seconds) / 60),
		})
	}
	return out, recent
}
