// Package runningpage imports history from a running_page / workouts_page
// deployment: `lifelog import running-page src/static/activities.json`.
//
// Records keep source "running_page"; where they overlap with a live source
// (e.g. the same Garmin run), export's dedupe keeps the live copy.
package runningpage

import (
	"encoding/json"
	"fmt"
	"io"
	"regexp"
	"strconv"
	"time"

	"github.com/Jason-cqtan/lifelog/internal/model"
	"github.com/Jason-cqtan/lifelog/internal/store"
)

type activity struct {
	RunID            json.Number `json:"run_id"`
	Name             string      `json:"name"`
	Distance         float64     `json:"distance"`
	MovingTime       string      `json:"moving_time"` // Python timedelta: "1:28:06" or "1 day, 0:03:04"
	Type             string      `json:"type"`
	StartDate        string      `json:"start_date"` // UTC "2006-01-02 15:04:05"
	SummaryPolyline  string      `json:"summary_polyline"`
	AverageHeartrate float64     `json:"average_heartrate"`
}

func Import(r io.Reader, st *store.Store) (int, error) {
	var acts []activity
	if err := json.NewDecoder(r).Decode(&acts); err != nil {
		return 0, err
	}
	added := 0
	for _, a := range acts {
		start, err := time.Parse("2006-01-02 15:04:05", a.StartDate)
		if err != nil {
			return added, fmt.Errorf("run %s: %w", a.RunID, err)
		}
		secs, err := parseDuration(a.MovingTime)
		if err != nil {
			return added, fmt.Errorf("run %s: %w", a.RunID, err)
		}
		if st.UpsertActivity(model.Activity{
			Source:       "running_page",
			SourceID:     a.RunID.String(),
			Type:         model.NormalizeType(a.Type),
			RawType:      a.Type,
			Name:         a.Name,
			StartTime:    start.UTC(),
			Distance:     a.Distance,
			MovingTime:   secs,
			AvgHeartRate: a.AverageHeartrate,
			Polyline:     a.SummaryPolyline,
		}) {
			added++
		}
	}
	return added, nil
}

var durationRe = regexp.MustCompile(`^(?:(\d+) days?, )?(\d+):(\d{2}):(\d{2})(?:\.\d+)?$`)

func parseDuration(s string) (int, error) {
	m := durationRe.FindStringSubmatch(s)
	if m == nil {
		return 0, fmt.Errorf("unrecognized moving_time %q", s)
	}
	n := func(i int) int { v, _ := strconv.Atoi(m[i]); return v }
	return n(1)*86400 + n(2)*3600 + n(3)*60 + n(4), nil
}
