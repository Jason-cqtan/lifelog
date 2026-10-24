// Package export turns the raw store into the single data.json the frontend reads.
package export

import (
	"encoding/json"
	"math"
	"os"
	"path/filepath"
	"sort"
	"time"

	"github.com/Jason-cqtan/lifelog/internal/model"
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
			Polyline:      a.Polyline,
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

const dupWindow = 3 * time.Minute

// Dedupe drops activities that start within dupWindow of a higher-priority one of
// a compatible type. Input must be sorted by start time; output keeps that order.
func Dedupe(acts []model.Activity) []model.Activity {
	var kept []model.Activity
	for _, a := range acts {
		dup := -1
		for j := len(kept) - 1; j >= 0 && a.StartTime.Sub(kept[j].StartTime) <= dupWindow; j-- {
			if compatible(a.Type, kept[j].Type) && a.Source != kept[j].Source {
				dup = j
				break
			}
		}
		switch {
		case dup < 0:
			kept = append(kept, a)
		case priority(a.Source) < priority(kept[dup].Source):
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
