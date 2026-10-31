package applehealth

import (
	"encoding/json"
	"fmt"
	"io"
	"reflect"
	"time"

	"github.com/Jason-cqtan/lifelog/internal/model"
	"github.com/Jason-cqtan/lifelog/internal/polyline"
	"github.com/Jason-cqtan/lifelog/internal/store"
)

// pushTimeLayouts are the dates Health Auto Export sends: yyyy-MM-dd HH:mm:ss Z,
// or with AM/PM on iPhones set to 12-hour time (newer iOS puts U+202F before it).
var pushTimeLayouts = []string{
	timeLayout,
	"2006-01-02 3:04:05 PM -0700",
	"2006-01-02 3:04:05 PM -0700",
}

type quantity struct {
	Qty   float64 `json:"qty"`
	Units string  `json:"units"`
}

// pushWorkout is a workout in Health Auto Export's "Export Version 2" JSON
// (https://help.healthyapps.dev/en/health-auto-export/export-format/workouts/).
// Only id, name, start and duration are always present.
type pushWorkout struct {
	ID           string    `json:"id"`
	Name         string    `json:"name"`
	Start        string    `json:"start"`
	Duration     float64   `json:"duration"` // seconds
	Distance     *quantity `json:"distance"`
	ElevationUp  *quantity `json:"elevationUp"`
	AvgHeartRate *quantity `json:"avgHeartRate"`
	HeartRate    *struct {
		Avg *quantity `json:"avg"`
	} `json:"heartRate"`
	Route []struct {
		Latitude  float64 `json:"latitude"`
		Longitude float64 `json:"longitude"`
	} `json:"route"`
}

// ImportPush stores the workouts of a Health Auto Export REST push: the only way
// to get them from an iPhone automatically. It reports how many arrived and how
// many of them were new or changed; apps push the same workouts over and over.
func ImportPush(r io.Reader, st *store.Store) (received, changed int, err error) {
	var body struct {
		Data struct {
			Workouts []pushWorkout `json:"workouts"`
		} `json:"data"`
	}
	if err := json.NewDecoder(r).Decode(&body); err != nil {
		return 0, 0, fmt.Errorf("decode: %w", err)
	}
	for _, w := range body.Data.Workouts {
		a, err := w.activity()
		if err != nil {
			return received, changed, err
		}
		received++
		if prev, ok := st.Activity(a.Key()); ok {
			// a push without routes must not erase one, or what other steps added
			if a.Polyline == "" {
				a.Polyline = prev.Polyline
			}
			a.Weather, a.BestEfforts = prev.Weather, prev.BestEfforts
			if a.StartTime.Equal(prev.StartTime) {
				a.StartTime = prev.StartTime
			}
			if reflect.DeepEqual(a, prev) {
				continue
			}
		}
		st.UpsertActivity(a)
		changed++
	}
	return received, changed, nil
}

func (w pushWorkout) activity() (model.Activity, error) {
	if w.ID == "" {
		return model.Activity{}, fmt.Errorf("workout %q at %q has no id: use Export Version 2", w.Name, w.Start)
	}
	var start time.Time
	var err error
	for _, layout := range pushTimeLayouts {
		if start, err = time.Parse(layout, w.Start); err == nil {
			break
		}
	}
	if err != nil {
		return model.Activity{}, fmt.Errorf("workout %s: start time %q", w.ID, w.Start)
	}
	a := model.Activity{
		Source:     "applehealth",
		SourceID:   w.ID,
		Type:       model.NormalizeType(w.Name),
		RawType:    w.Name,
		Name:       w.Name,
		StartTime:  start.UTC(),
		MovingTime: int(w.Duration),
	}
	if w.Distance != nil {
		a.Distance = toMeters(w.Distance.Qty, w.Distance.Units)
	}
	if w.ElevationUp != nil {
		a.ElevationGain = toMeters(w.ElevationUp.Qty, w.ElevationUp.Units)
	}
	switch {
	case w.AvgHeartRate != nil:
		a.AvgHeartRate = w.AvgHeartRate.Qty
	case w.HeartRate != nil && w.HeartRate.Avg != nil:
		a.AvgHeartRate = w.HeartRate.Avg.Qty
	}
	if len(w.Route) > 1 {
		pts := make([][2]float64, len(w.Route))
		for i, p := range w.Route {
			pts[i] = [2]float64{p.Latitude, p.Longitude}
		}
		a.Polyline = polyline.Encode(pts)
	}
	return a, nil
}
