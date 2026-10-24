package export

import (
	"sort"
	"strconv"
	"strings"
	"time"

	"github.com/Jason-cqtan/lifelog/internal/model"
)

// topN caps the artist and track rankings per period, keeping data.json small
// even with years of imported streaming history.
const topN = 50

type ArtistStat struct {
	Name   string `json:"name"`
	Ms     int64  `json:"ms"`
	Plays  int    `json:"plays"`
	Tracks int    `json:"tracks"` // distinct songs
}

type TrackStat struct {
	Track  string `json:"track"`
	Artist string `json:"artist,omitempty"`
	Ms     int64  `json:"ms"`
	Plays  int    `json:"plays"`
}

// MusicStats summarizes listening for one period (a year, or "all").
type MusicStats struct {
	Ms      int64        `json:"ms"`
	Plays   int          `json:"plays"`
	Artists int          `json:"artists"`
	Tracks  int          `json:"tracks"`
	Top     []ArtistStat `json:"top_artists"`
	Songs   []TrackStat  `json:"top_tracks"`
	// Hours[weekday][hour] is listening ms by local weekday (0 = Monday) and hour.
	Hours [7][24]int64 `json:"hours"`
}

// Music aggregates plays per local year plus "all".
func Music(plays []model.Play, loc *time.Location) map[string]*MusicStats {
	type acc struct {
		stats   MusicStats
		artists map[string]*ArtistStat
		artistT map[string]map[string]bool
		tracks  map[string]*TrackStat
	}
	periods := map[string]*acc{}
	get := func(k string) *acc {
		if periods[k] == nil {
			periods[k] = &acc{artists: map[string]*ArtistStat{}, artistT: map[string]map[string]bool{}, tracks: map[string]*TrackStat{}}
		}
		return periods[k]
	}
	for _, p := range plays {
		t := p.PlayedAt.In(loc)
		trackKey := p.TrackID
		if trackKey == "" {
			trackKey = p.Track + "\x00" + p.Artist
		}
		for _, k := range []string{strconv.Itoa(t.Year()), "all"} {
			a := get(k)
			a.stats.Ms += p.MsPlayed
			a.stats.Plays++
			a.stats.Hours[(int(t.Weekday())+6)%7][t.Hour()] += p.MsPlayed

			ts := a.tracks[trackKey]
			if ts == nil {
				ts = &TrackStat{Track: p.Track, Artist: p.Artist}
				a.tracks[trackKey] = ts
			}
			ts.Ms += p.MsPlayed
			ts.Plays++

			// A feature ("A, B") credits every listed artist with the full play.
			for _, name := range splitArtists(p.Artist) {
				as := a.artists[name]
				if as == nil {
					as = &ArtistStat{Name: name}
					a.artists[name] = as
					a.artistT[name] = map[string]bool{}
				}
				as.Ms += p.MsPlayed
				as.Plays++
				a.artistT[name][trackKey] = true
			}
		}
	}

	out := map[string]*MusicStats{}
	for k, a := range periods {
		s := a.stats
		s.Artists, s.Tracks = len(a.artists), len(a.tracks)
		for name, as := range a.artists {
			as.Tracks = len(a.artistT[name])
			s.Top = append(s.Top, *as)
		}
		sort.Slice(s.Top, func(i, j int) bool {
			if s.Top[i].Ms != s.Top[j].Ms {
				return s.Top[i].Ms > s.Top[j].Ms
			}
			return s.Top[i].Name < s.Top[j].Name
		})
		for _, ts := range a.tracks {
			s.Songs = append(s.Songs, *ts)
		}
		sort.Slice(s.Songs, func(i, j int) bool {
			if s.Songs[i].Plays != s.Songs[j].Plays {
				return s.Songs[i].Plays > s.Songs[j].Plays
			}
			if s.Songs[i].Ms != s.Songs[j].Ms {
				return s.Songs[i].Ms > s.Songs[j].Ms
			}
			return s.Songs[i].Track < s.Songs[j].Track
		})
		if len(s.Top) > topN {
			s.Top = s.Top[:topN]
		}
		if len(s.Songs) > topN {
			s.Songs = s.Songs[:topN]
		}
		out[k] = &s
	}
	return out
}

func splitArtists(s string) []string {
	var out []string
	for _, a := range strings.Split(s, ", ") {
		if a = strings.TrimSpace(a); a != "" {
			out = append(out, a)
		}
	}
	if len(out) == 0 {
		return []string{"?"}
	}
	return out
}
