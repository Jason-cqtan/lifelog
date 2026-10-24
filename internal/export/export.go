// Package export turns the raw store into the single data.json the frontend reads.
package export

import (
	"encoding/json"
	"math"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"time"

	"github.com/Jason-cqtan/lifelog/internal/model"
	"github.com/Jason-cqtan/lifelog/internal/polyline"
	"github.com/Jason-cqtan/lifelog/internal/store"
)

type Activity struct {
	ID            string             `json:"id"`
	Source        string             `json:"source"`
	Type          model.SportType    `json:"type"`
	Name          string             `json:"name,omitempty"`
	Date          string             `json:"date"`
	StartLocal    string             `json:"start_local"`
	Distance      float64            `json:"distance_m"`
	MovingTime    int                `json:"moving_time_s"`
	ElevationGain float64            `json:"elevation_gain_m,omitempty"`
	AvgHeartRate  float64            `json:"avg_hr,omitempty"`
	AvgCadence    float64            `json:"avg_cadence,omitempty"`
	StrideM       float64            `json:"stride_m,omitempty"`
	Polyline      string             `json:"polyline,omitempty"`
	Weather       *model.Weather     `json:"weather,omitempty"`
	BestEfforts   map[string]float64 `json:"best_efforts,omitempty"`
}

type Output struct {
	GeneratedAt time.Time  `json:"generated_at"`
	Timezone    string     `json:"timezone"`
	Activities  []Activity `json:"activities"` // newest first, de-duplicated
	// Daily maps date -> metric -> value. Metrics: <type>_km, sport_min,
	// duolingo_minutes, duolingo_xp, spotify_minutes, github_contributions ...
	Daily map[string]map[string]float64 `json:"daily"`
	// Music is listening stats keyed by year ("2026") and "all".
	Music map[string]*MusicStats `json:"music,omitempty"`
	// SpotifyTop is Spotify's own top-items ranking (not filtered by year).
	SpotifyTop *model.SpotifyTop `json:"spotify_top,omitempty"`
	Duolingo   *Duolingo         `json:"duolingo,omitempty"`
}

// Duolingo is the course snapshot plus, per year and "all", each course's XP
// gained and estimated minutes since per-course tracking started.
type Duolingo struct {
	model.DuolingoCourses
	Periods map[string]map[string]*CourseTime `json:"periods"`
}

type CourseTime struct {
	XP      float64 `json:"xp"`
	Minutes float64 `json:"minutes"` // that day's minutes split by the course's share of its XP
}

const courseXPPrefix = "duolingo_course_xp:"

func duolingoCourses(snap model.DuolingoCourses, daily map[string]map[string]float64) *Duolingo {
	d := &Duolingo{DuolingoCourses: snap, Periods: map[string]map[string]*CourseTime{}}
	for date, m := range daily {
		var total float64
		for k, v := range m {
			if strings.HasPrefix(k, courseXPPrefix) {
				total += v
			}
		}
		if total == 0 {
			continue
		}
		for k, v := range m {
			if !strings.HasPrefix(k, courseXPPrefix) {
				continue
			}
			id := strings.TrimPrefix(k, courseXPPrefix)
			for _, p := range []string{date[:4], "all"} {
				if d.Periods[p] == nil {
					d.Periods[p] = map[string]*CourseTime{}
				}
				ct := d.Periods[p][id]
				if ct == nil {
					ct = &CourseTime{}
					d.Periods[p][id] = ct
				}
				ct.XP += v
				ct.Minutes += m["duolingo_minutes"] * v / total
			}
		}
	}
	for _, p := range d.Periods {
		for _, ct := range p {
			ct.Minutes = round(ct.Minutes)
		}
	}
	return d
}

func Build(st *store.Store, loc *time.Location) Output {
	out := Output{GeneratedAt: time.Now().UTC(), Timezone: loc.String(), Daily: map[string]map[string]float64{}}
	add := func(date, metric string, v float64) {
		if out.Daily[date] == nil {
			out.Daily[date] = map[string]float64{}
		}
		out.Daily[date][metric] += v
	}

	acts := Dedupe(st.Activities())
	for i := len(acts) - 1; i >= 0; i-- {
		a := acts[i]
		date := store.DateIn(a.StartTime, loc)
		out.Activities = append(out.Activities, Activity{
			ID:            a.Key(),
			Source:        a.Source,
			Type:          a.Type,
			Name:          a.Name,
			Date:          date,
			StartLocal:    a.StartTime.In(loc).Format("2006-01-02 15:04"),
			Distance:      round(a.Distance),
			MovingTime:    a.MovingTime,
			ElevationGain: round(a.ElevationGain),
			AvgHeartRate:  round(a.AvgHeartRate),
			AvgCadence:    a.AvgCadence,
			StrideM:       a.StrideM,
			Polyline:      slim(a.Polyline),
			Weather:       a.Weather,
			BestEfforts:   a.BestEfforts,
		})
		if a.Distance > 0 {
			add(date, string(a.Type)+"_km", a.Distance/1000)
		}
		add(date, "sport_min", float64(a.MovingTime)/60)
	}
	for _, d := range st.Daily() {
		add(d.Date, d.Source+"_"+d.Metric, d.Value)
	}
	plays := st.Plays()
	for _, p := range plays {
		add(store.DateIn(p.PlayedAt, loc), "spotify_minutes", float64(p.MsPlayed)/60000)
	}
	if len(plays) > 0 {
		out.Music = Music(plays, loc)
	}
	var top model.SpotifyTop
	if ok, err := st.Snapshot("spotify_top", &top); ok && err == nil {
		out.SpotifyTop = &top
	}
	var courses model.DuolingoCourses
	if ok, err := st.Snapshot("duolingo_courses", &courses); ok && err == nil {
		out.Duolingo = duolingoCourses(courses, out.Daily)
	}
	for _, m := range out.Daily {
		for k, v := range m {
			m[k] = round(v)
		}
	}
	return out
}

func Write(path string, out Output) error {
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		return err
	}
	b, err := json.Marshal(out)
	if err != nil {
		return err
	}
	return os.WriteFile(path, b, 0o644)
}

// sourcePriority decides which copy wins when the same workout reaches us
// through several services (e.g. Garmin watch -> Garmin Connect -> Strava).
// Lower is better: the watch vendor has the most complete data.
var sourcePriority = map[string]int{"garmin": 0, "coros": 1, "strava": 2, "applehealth": 3, "running_page": 4}

const (
	// copies of one workout synced between services start at (nearly) the same time
	dupWindow = 3 * time.Minute
	// a copy re-synced through another app (e.g. Garmin -> Joyrun) can start a few
	// minutes off; with nearly the same distance it is still the same workout
	dupWindowSameDistance = 15 * time.Minute
	sameDistance          = 0.03
)

// isDup reports whether b (started earlier or at the same time) and a are the
// same workout.
func isDup(a, b model.Activity) bool {
	if !compatible(a.Type, b.Type) {
		return false
	}
	close := b.Distance > 0 && a.Distance > 0 && math.Abs(a.Distance-b.Distance)/math.Max(a.Distance, b.Distance) <= sameDistance
	if a.Source == b.Source {
		// a single service doesn't list a workout twice, except running_page,
		// which merges several apps (Joyrun, Keep, GPX files); require the distance
		return a.Source == "running_page" && a.StartTime.Sub(b.StartTime) <= dupWindow && close
	}
	gap := a.StartTime.Sub(b.StartTime)
	return gap <= dupWindow || (gap <= dupWindowSameDistance && close)
}

// better picks which copy of a workout to keep: the higher-priority source, and
// between equals the one with more detail (split efforts, route).
func better(a, b model.Activity) bool {
	if pa, pb := priority(a.Source), priority(b.Source); pa != pb {
		return pa < pb
	}
	detail := func(x model.Activity) int {
		n := len(x.BestEfforts)
		if x.Polyline != "" {
			n++
		}
		return n
	}
	return detail(a) > detail(b)
}

// Dedupe keeps one copy of each workout that reached us through several
// services or apps. Input must be sorted by start time; output keeps that order.
func Dedupe(acts []model.Activity) []model.Activity {
	var kept []model.Activity
	for _, a := range acts {
		dup := -1
		for j := len(kept) - 1; j >= 0 && a.StartTime.Sub(kept[j].StartTime) <= dupWindowSameDistance; j-- {
			if isDup(a, kept[j]) {
				dup = j
				break
			}
		}
		switch {
		case dup < 0:
			kept = append(kept, a)
		case better(a, kept[dup]):
			kept[dup] = a
		}
	}
	sort.SliceStable(kept, func(i, j int) bool { return kept[i].StartTime.Before(kept[j].StartTime) })
	return kept
}

func compatible(a, b model.SportType) bool {
	return a == b || a == model.Workout || b == model.Workout
}

func priority(source string) int {
	if p, ok := sourcePriority[source]; ok {
		return p
	}
	return 99
}

func round(v float64) float64 { return math.Round(v*100) / 100 }

// routeTolerance is how far (meters) a dropped route point may lie from the
// simplified line. The site's thumbnails and city-level map can't show less,
// and routes are over half of data.json; stored routes keep full detail.
const routeTolerance = 4

func slim(encoded string) string {
	if encoded == "" {
		return ""
	}
	return polyline.Encode(polyline.Simplify(polyline.Decode(encoded), routeTolerance))
}
